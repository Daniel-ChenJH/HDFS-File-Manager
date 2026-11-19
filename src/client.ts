import * as http from "node:http";
import * as https from "node:https";
import { Client as DirectClient } from "undici";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Connection, Entry, HdfsError, normalizePath } from "./model";
import { chunkSize } from "./transfer";

export class Client {
  private stages = new WeakMap<Readable, string>();
  constructor(
    readonly connection: Connection,
    private secret = "",
  ) {}
  url(path: string, op: string, parameters: Record<string, string> = {}): URL {
    const url = new URL(this.connection.endpoint);
    url.pathname =
      url.pathname.replace(/\/$/, "") +
      normalizePath(path).split("/").map(encodeURIComponent).join("/");
    url.searchParams.set("op", op);
    if (this.connection.auth === "simple")
      url.searchParams.set("user.name", this.connection.username);
    if (this.connection.auth === "delegation")
      url.searchParams.set("delegation", this.secret);
    for (const [key, value] of Object.entries(parameters))
      url.searchParams.set(key, value);
    return url;
  }
  private async request(
    url: URL,
    signal: AbortSignal,
    redirects = 0,
  ): Promise<Readable> {
    const stage = redirects ? "datanode" : "namenode";
    if (signal.aborted) throw new HdfsError("cancelled", stage);
    if (redirects > 5) throw new HdfsError("redirect", stage);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new HdfsError("redirect", stage);
    const headers: Record<string, string> = {
      accept: "*/*",
      "accept-encoding": "identity",
    };
    // Credentials belong only to the configured gateway, never to a redirected host.
    if (url.origin === new URL(this.connection.endpoint).origin) {
      if (this.connection.auth === "basic")
        headers.authorization =
          "Basic " +
          Buffer.from(this.connection.username + ":" + this.secret).toString(
            "base64",
          );
      if (this.connection.auth === "bearer")
        headers.authorization = "Bearer " + this.secret;
    }
    // Bundle this client rather than using the editor-patched global http/fetch APIs.
    // Routing is explicitly direct from this extension host, including remote windows.
    const timeout = this.connection.timeout * 1000;
    const transport = new DirectClient(url.origin, {
      connectTimeout: timeout,
      headersTimeout: timeout,
      bodyTimeout: timeout,
      pipelining: 0,
    });
    let result;
    try {
      result = await transport.request({
        path: url.pathname + url.search,
        method: "GET",
        headers,
        signal,
      });
    } catch (error) {
      await transport.destroy();
      throw this.safeError(error, signal, stage);
    }
    const response = result.body;
    response.once("close", () => {
      void transport.destroy();
    });
    // Keep stream errors handled even while callers are deciding how to consume it.
    response.on("error", () => {});
    if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
      const location = result.headers.location;
      response.destroy();
      if (typeof location !== "string") throw new HdfsError("redirect", stage);
      let target: URL;
      try {
        target = new URL(location, url);
      } catch {
        throw new HdfsError("redirect", stage);
      }
      if (url.protocol === "https:" && target.protocol !== "https:")
        throw new HdfsError("downgrade", stage);
      return this.request(target, signal, redirects + 1);
    }
    if (result.statusCode !== 200) {
      const code = result.statusCode;
      let accessDenied = false;
      if (code === 403) {
        try {
          const parts: Buffer[] = [];
          let length = 0;
          for await (const chunk of response) {
            length += chunk.length;
            if (length > 8192) break;
            parts.push(Buffer.from(chunk));
          }
          accessDenied =
            JSON.parse(Buffer.concat(parts).toString("utf8"))?.RemoteException
              ?.exception === "AccessControlException";
        } catch {
          /* Unrecognized gateway errors must not be presented as HDFS path permissions. */
        }
      }
      response.destroy();
      throw new HdfsError(
        code === 401
          ? "unauthorized"
          : code === 403
            ? accessDenied
              ? "forbidden"
              : "requestDenied"
            : code === 404
              ? "missing"
              : `http${code}`,
        stage,
      );
    }
    this.stages.set(response, stage);
    return response;
  }
  private writable() {
    if (this.connection.readOnly) throw new HdfsError("readOnly");
  }
  private async mutation(
    url: URL,
    method: "PUT" | "DELETE",
    signal: AbortSignal,
    body?: Readable,
    size?: number,
  ): Promise<{ status: number; location?: string; data: any }> {
    this.writable();
    const headers: Record<string, string> = {
      "X-XSRF-HEADER": "1",
      "content-type": "application/octet-stream",
    };
    if (url.origin === new URL(this.connection.endpoint).origin) {
      if (this.connection.auth === "basic")
        headers.authorization =
          "Basic " +
          Buffer.from(this.connection.username + ":" + this.secret).toString(
            "base64",
          );
      if (this.connection.auth === "bearer")
        headers.authorization = "Bearer " + this.secret;
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (new URL(this.connection.endpoint).protocol === "https:" &&
        url.protocol !== "https:")
    )
      throw new HdfsError("redirect");
    if (size !== undefined) headers["content-length"] = String(size);
    const timeout = this.connection.timeout * 1000;
    // DataNodes may send an interim 100 Continue response even for a
    // redirected CREATE. Node's HTTP parser supports these informational
    // responses; the read transport intentionally remains separate.

    const agent =
      url.protocol === "https:"
        ? new https.Agent({ keepAlive: false })
        : new http.Agent({ keepAlive: false });
    let request: http.ClientRequest | undefined;
    let headerTimer: NodeJS.Timeout | undefined;
    try {
      const incoming = await new Promise<http.IncomingMessage>(
        (resolve, reject) => {
          request = new http.ClientRequest(
            {
              protocol: url.protocol,
              hostname: url.hostname.replace(/^\[|\]$/g, ""),
              port: url.port || undefined,
              path: url.pathname + url.search,
              method,
              headers,
              agent,
              signal,
            },
            resolve,
          );
          request.once("error", reject);
          headerTimer = setTimeout(
            () =>
              request?.destroy(
                Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
              ),
            timeout,
          );
          request.setTimeout(timeout, () =>
            request?.destroy(
              Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
            ),
          );
          if (body) {
            body.once("error", (error) => request?.destroy(error));
            body.pipe(request);
          } else request.end();
        },
      );
      clearTimeout(headerTimer);
      const response = {
        statusCode: incoming.statusCode || 0,
        headers: incoming.headers,
        body: incoming,
      };
      const parts: Buffer[] = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 65536) throw new HdfsError("response");
        parts.push(Buffer.from(chunk));
      }
      let data: any = {};
      try {
        data = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
      } catch {
        /* May be an empty response. */
      }
      if (![200, 201, 307].includes(response.statusCode)) {
        const code = response.statusCode;
        const quota = /QuotaExceededException|DiskOutOfSpaceException/.test(
          data?.RemoteException?.exception || "",
        );
        throw new HdfsError(
          quota
            ? "diskSpace"
            : code === 401
              ? "unauthorized"
              : code === 403
                ? data?.RemoteException?.exception === "AccessControlException"
                  ? "forbidden"
                  : "requestDenied"
                : code === 405 || code === 501
                  ? "writeUnsupported"
                  : code === 404
                    ? "missing"
                    : code === 409
                      ? "exists"
                      : `http${code}`,
        );
      }
      if (data.boolean === false) throw new HdfsError("operationFailed");
      return {
        status: response.statusCode,
        location:
          typeof response.headers.location === "string"
            ? response.headers.location
            : data.Location,
        data,
      };
    } catch (error) {
      throw this.safeError(error, signal, "namenode");
    } finally {
      clearTimeout(headerTimer);
      body?.destroy();
      request?.destroy();
      agent.destroy();
    }
  }

  async mkdir(path: string, signal: AbortSignal) {
    await this.mutation(this.url(path, "MKDIRS"), "PUT", signal);
  }
  async remove(path: string, signal: AbortSignal, recursive = false) {
    if (normalizePath(path) === "/") throw new HdfsError("path");
    await this.mutation(
      this.url(path, "DELETE", { recursive: String(recursive) }),
      "DELETE",
      signal,
    );
  }
  async rename(source: string, destination: string, signal: AbortSignal) {
    this.writable();
    if (normalizePath(source) === "/" || normalizePath(destination) === "/")
      throw new HdfsError("path");
    if (await this.exists(destination, signal)) throw new HdfsError("exists");
    await this.mutation(
      this.url(source, "RENAME", { destination: normalizePath(destination) }),
      "PUT",
      signal,
    );
  }
  async exists(path: string, signal: AbortSignal): Promise<Entry | undefined> {
    try {
      return await this.stat(path, signal);
    } catch (e) {
      if (e instanceof HdfsError && e.code === "missing") return;
      throw e;
    }
  }
  async upload(
    path: string,
    size: number,
    source: AsyncIterable<Buffer>,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ) {
    this.writable();
    const first = await this.mutation(
      this.url(path, "CREATE", { overwrite: "false", noredirect: "true" }),
      "PUT",
      signal,
    );
    if (!first.location) throw new HdfsError("redirect");
    let bytes = 0;
    async function* counted() {
      for await (const chunk of source) {
        if (signal.aborted) throw new HdfsError("cancelled");
        bytes += chunk.length;
        if (bytes > size) throw new HdfsError("changed");
        yield chunk;
        progress(bytes);
      }
      if (bytes !== size) throw new HdfsError("changed");
    }
    const result = await this.mutation(
      new URL(first.location, this.connection.endpoint),
      "PUT",
      signal,
      Readable.from(counted(), { objectMode: false, highWaterMark: chunkSize }),
      size,
    );
    if (result.status !== 201) throw new HdfsError("response");
  }
  async *iterate(path: string, signal: AbortSignal): AsyncGenerator<Entry> {
    let after = "";
    while (true) {
      let data;
      try {
        data = JSON.parse(
          (
            await this.bytes(path, "LISTSTATUS_BATCH", 32 * 1048576, signal, {
              startAfter: after,
            })
          ).toString("utf8"),
        );
      } catch (e) {
        if (
          !after &&
          e instanceof HdfsError &&
          ["http400", "http405", "http501"].includes(e.code)
        ) {
          yield* await this.list(path, signal);
          return;
        }
        throw e;
      }
      const page = data.DirectoryListing;
      const entries = page?.partialListing?.FileStatuses?.FileStatus;
      if (!Array.isArray(entries)) throw new HdfsError("response");
      for (const item of entries) yield this.entry(item);
      if (!page.remainingEntries) return;
      const next = entries.at(-1)?.pathSuffix;
      if (!next || next === after) throw new HdfsError("response");
      after = next;
    }
  }
  private safeError(
    error: unknown,
    signal: AbortSignal,
    stage: string,
  ): HdfsError {
    if (signal.aborted) return new HdfsError("cancelled", stage);
    if (error instanceof HdfsError) return error;
    const code = (error as NodeJS.ErrnoException).code ?? "";
    return new HdfsError(
      /TIMEOUT/.test(code)
        ? "timeout"
        : /CERT|TLS|SSL/.test(code)
          ? "tls"
          : code === "ENOTFOUND" || code === "EAI_AGAIN"
            ? "dns"
            : code === "ECONNREFUSED"
              ? stage === "namenode" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(
                  new URL(this.connection.endpoint).hostname,
                )
                ? "loopbackRefused"
                : "refused"
              : "network",
      stage,
    );
  }
  private async bytes(
    path: string,
    op: string,
    limit: number,
    signal: AbortSignal,
    parameters: Record<string, string> = {},
    prefix = false,
  ): Promise<Buffer> {
    const response = await this.request(this.url(path, op, parameters), signal);
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const raw of response) {
        const chunk = Buffer.from(raw);
        if (size + chunk.length > limit) {
          if (!prefix) throw new HdfsError("limit");
          chunks.push(chunk.subarray(0, limit - size));
          size = limit;
          response.destroy();
          break;
        }
        chunks.push(chunk);
        size += chunk.length;
        if (prefix && size >= limit) {
          response.destroy();
          break;
        }
      }
      return Buffer.concat(chunks, size);
    } catch (error) {
      throw this.safeError(
        error,
        signal,
        this.stages.get(response) ?? "namenode",
      );
    } finally {
      response.destroy();
    }
  }
  async list(path: string, signal: AbortSignal): Promise<Entry[]> {
    const data = await this.bytes(path, "LISTSTATUS", 32 * 1024 * 1024, signal);
    try {
      const items = JSON.parse(data.toString("utf8")).FileStatuses.FileStatus;
      if (!Array.isArray(items) || items.length > 200000) throw new Error();
      return items
        .map((e: Entry) => this.entry(e))
        .sort(
          (a, b) =>
            Number(b.type === "DIRECTORY") - Number(a.type === "DIRECTORY") ||
            a.pathSuffix.localeCompare(b.pathSuffix),
        );
    } catch {
      throw new HdfsError("response");
    }
  }
  private entry(e: Entry): Entry {
    if (
      !e ||
      typeof e.pathSuffix !== "string" ||
      e.pathSuffix.includes("/") ||
      e.pathSuffix === ".." ||
      e.pathSuffix === "." ||
      /[\x00-\x1f\x7f]/.test(e.pathSuffix) ||
      !["FILE", "DIRECTORY", "SYMLINK"].includes(e.type) ||
      !Number.isSafeInteger(e.length) ||
      e.length < 0 ||
      !Number.isFinite(e.modificationTime)
    )
      throw new HdfsError("response");
    return {
      pathSuffix: e.pathSuffix,
      type: e.type,
      length: e.length,
      modificationTime: e.modificationTime,
      owner: String(e.owner ?? ""),
      group: String(e.group ?? ""),
      permission: String(e.permission ?? ""),
    };
  }
  async stat(path: string, signal: AbortSignal): Promise<Entry> {
    const bytes = await this.bytes(path, "GETFILESTATUS", 1024 * 1024, signal);
    try {
      return this.entry(JSON.parse(bytes.toString("utf8")).FileStatus);
    } catch {
      throw new HdfsError("response");
    }
  }
  async read(
    path: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<Buffer> {
    return this.bytes(
      path,
      "OPEN",
      limit,
      signal,
      { length: String(limit) },
      true,
    );
  }
  async streamDownload(
    path: string,
    expectedSize: number,
    signal: AbortSignal,
    write: (data: Buffer, offset: number) => Promise<void>,
  ): Promise<string> {
    let response: Readable | undefined;
    try {
      response = await this.request(this.url(path, "OPEN"), signal);
      const hash = createHash("sha256");
      let buffer = Buffer.allocUnsafe(chunkSize),
        used = 0,
        bytes = 0;
      for await (const value of response) {
        const chunk = Buffer.from(value);
        if (bytes + used + chunk.length > expectedSize)
          throw new HdfsError("changed");
        let cursor = 0;
        while (cursor < chunk.length) {
          if (signal.aborted) throw new HdfsError("cancelled");
          const length = Math.min(chunkSize - used, chunk.length - cursor);
          chunk.copy(buffer, used, cursor, cursor + length);
          used += length;
          cursor += length;
          if (used === chunkSize) {
            hash.update(buffer);
            await write(buffer, bytes);
            bytes += used;
            used = 0;
          }
        }
      }
      if (used) {
        hash.update(buffer.subarray(0, used));
        await write(buffer.subarray(0, used), bytes);
        bytes += used;
      }
      if (signal.aborted) throw new HdfsError("cancelled");
      if (bytes !== expectedSize) throw new HdfsError("changed");
      return hash.digest("hex");
    } catch (error) {
      throw this.safeError(error, signal, "datanode");
    } finally {
      response?.destroy();
    }
  }
  async download(
    path: string,
    destination: string,
    expectedSize: number,
    signal: AbortSignal,
    progress: (bytes: number) => void = () => {},
  ): Promise<void> {
    const temporary = join(
      dirname(destination),
      "." + basename(destination) + "." + randomUUID() + ".part",
    );
    let response: Readable | undefined;
    try {
      response = await this.request(this.url(path, "OPEN"), signal);
      let size = 0;
      const counter = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > expectedSize) {
            callback(new HdfsError("changed"));
            return;
          }
          progress(size);
          callback(null, chunk);
        },
      });
      await pipeline(
        response,
        counter,
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      if (size !== expectedSize) throw new HdfsError("changed");
      if (signal.aborted) throw new HdfsError("cancelled");
      await rename(temporary, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        ["EACCES", "ENOSPC", "ENOENT", "EISDIR", "EPERM"].includes(code ?? "")
      )
        throw new HdfsError("save");
      throw this.safeError(error, signal, "datanode");
    } finally {
      response?.destroy();
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}
