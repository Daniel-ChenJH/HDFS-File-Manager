import * as vscode from "vscode";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  appendFile,
  stat,
  rm,
  readFile,
  writeFile,
  rename as renameFile,
  readdir,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, posix } from "node:path";
import { Client } from "./client";
import { diskService } from "./disk-host";
import { FileAccess } from "./file-access";
import { transferCommand, TransferReply, chunkSize } from "./transfer";
import { Gate, HdfsError, joinPath, downloadName } from "./model";
import { errorText } from "./i18n";

type Target = "local" | "host";
type Root = {
  id: string;
  name: string;
  path: string;
  type: string;
  size: number;
};
type Job = {
  id: string;
  name: string;
  connection: string;
  rootCount?: number;
  identity?: string;
  direction: "upload" | "download";
  target: Target;
  folder: string;
  status: string;
  done: number;
  bytes: number;
  completedBytes?: number;
  failed: number;
  failedFiles?: number;
  skipped: number;
  error?: string;
  current?: string;
  created: number;
  policy: "ask" | "keep" | "skip" | "replace";
  roots: any[];
  destination?: Root;
  failures?: string;
  retryFile?: string;
  plan?: string;
  cursor?: number;
  planned?: number;
};
export class Tasks {
  private files = new FileAccess();
  private disk;
  private jobs: Job[] = [];
  private active = new Map<string, AbortController>();
  private gate = new Gate(2);
  private conflictGate = new Gate(1);
  private ready: Promise<void>;
  private startupError: unknown;
  private closed = false;
  private selection?: { target: Target; roots: Root[] };
  private timer?: NodeJS.Timeout;
  private persistTail = Promise.resolve();
  private dirty = false;
  private recoveryCount = 0;
  private liveJournals = new Set<string>();
  private recovering = false;
  private metadataBytes = 0;
  private work = new Set<Promise<void>>();
  private uploadEpoch = 0;
  private receivers = new Map<string, string>();
  constructor(
    private context: vscode.ExtensionContext,
    private getClient: (id: string) => Promise<Client>,
    private language: () => string,
    private send: (m: any) => void,
    private host: () => string,
    private changed: () => void,
    transferGate?: Gate,
  ) {
    if (transferGate) this.gate = transferGate;
    this.disk = diskService(context, (language) =>
      vscode.env.remoteName
        ? host()
        : language === "zh-CN"
          ? "本机"
          : "This computer",
    );
    this.ready = context.globalStorageUri
      ? this.load().catch((error) => {
          this.startupError = error;
        })
      : Promise.resolve();
  }
  async recordDownload(event: any) {
    if (!this.context.globalStorageUri) return;
    await this.ready;
    if (this.startupError) return;
    let job = this.jobs.find((j) => j.id === event.id);
    if (!job) {
      if (!event.client) return;
      job = {
        id: event.id,
        identity: this.identity(event.client),
        connection: event.client.connection.id,
        name: event.name,
        direction: "download",
        target: event.target,
        folder: event.folder,
        status: "running",
        done: 0,
        failed: 0,
        failedFiles: 0,
        skipped: 0,
        bytes: 0,
        completedBytes: 0,
        created: Date.now(),
        policy: "ask",
        roots: [{ path: event.path }],
      };
      this.jobs.push(job);
      this.active.set(job.id, event.controller);
      await this.prune();
    }
    if (event.bytes !== undefined) job.bytes = event.bytes;
    if (event.status) job.status = event.status;
    if (event.done) {
      job.done = event.done;
      job.completedBytes = job.bytes;
    }
    if (event.error) job.error = event.error;
    if (event.status && event.status !== "running") this.active.delete(job.id);
    this.update(event.status !== undefined);
  }
  private get directory() {
    return join(this.context.globalStorageUri.fsPath, "transfers");
  }
  private async load() {
    await mkdir(this.directory, { recursive: true });
    const names = await readdir(this.directory);
    this.recoveryCount = names.filter((n) => n.startsWith("recovery-")).length;
    for (const name of names)
      if (name !== "history.json")
        this.metadataBytes += (await stat(join(this.directory, name))).size;
    try {
      this.jobs = JSON.parse(
        await readFile(join(this.directory, "history.json"), "utf8"),
      ).slice(-50);
      for (const j of this.jobs)
        if (["running", "queued", "enumerating"].includes(j.status))
          j.status = "interrupted";
    } catch {
      this.jobs = [];
    }
  }
  async snapshot() {
    await this.ready;
    if (this.startupError) {
      this.send({
        type: "taskError",
        text: errorText(this.startupError, this.language() as any),
      });
      return;
    }
    this.emit();
  }
  private emit() {
    this.send({
      type: "tasks",
      recoveryCount: this.recoveryCount - this.liveJournals.size,
      jobs: this.jobs.map(
        ({
          roots,
          destination,
          failures,
          retryFile,
          plan,
          identity,
          ...job
        }) => ({
          ...job,
          rootCount:
            job.rootCount ??
            (roots.length > 1
              ? roots.length
              : (job.planned || 0) > 1
                ? Number(/^(\d+) (?:items|项)$/.exec(job.name)?.[1]) ||
                  undefined
                : undefined),
        }),
      ),
    });
  }
  private update(immediate = false) {
    if (immediate) {
      this.dirty = true;
      clearTimeout(this.timer);
      this.timer = undefined;
      this.emit();
      void this.persist().catch(() => {
        this.cancelAll();
        this.send({
          type: "taskError",
          text:
            this.language() === "zh-CN"
              ? "无法保存任务记录，请检查磁盘空间。"
              : "Could not save task records. Check disk space.",
        });
      });
    } else if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.emit();
      }, 250);
  }
  private persist() {
    if (!this.dirty) return this.persistTail;
    this.dirty = false;
    const data = JSON.stringify(this.jobs);
    this.persistTail = this.persistTail
      .catch(() => {})
      .then(async () => {
        const temporary = join(this.directory, "history.pending");
        await writeFile(temporary, data);
        await renameFile(temporary, join(this.directory, "history.json"));
      });
    return this.persistTail;
  }
  private async access(target: Target, m: any): Promise<any> {
    if (target === "local" && vscode.env.remoteName) {
      const reply: any = await vscode.commands.executeCommand(
        "_hdfsFileManager.files",
        m,
      );
      if (!reply?.ok) throw new HdfsError(reply?.code || "localTransfer");
      return reply.value;
    }
    return this.files.handle(m);
  }
  private async receive(target: Target, m: any): Promise<any> {
    const reply: TransferReply =
      target === "local" && vscode.env.remoteName
        ? await vscode.commands.executeCommand(transferCommand, m)
        : await this.disk.handle(m);
    if (!reply?.ok)
      throw new HdfsError(reply && !reply.ok ? reply.code : "localTransfer");
    return reply.value;
  }
  async message(m: any) {
    await this.ready;
    try {
      if (this.startupError) throw this.startupError;
      if (m.action === "details") {
        const job = this.jobs.find((j) => j.id === m.id);
        if (!job?.failures) return;
        const page = Math.max(0, Math.floor(Number(m.page) || 0)),
          items: any[] = [];
        const input = createReadStream(job.failures),
          lines = createInterface({ input, crlfDelay: Infinity });
        let i = 0;
        try {
          for await (const line of lines) {
            if (i++ < page * 50) continue;
            const e = JSON.parse(line);
            items.push({ name: e.relative, error: e.failure || job.error });
            if (items.length === 50) break;
          }
        } finally {
          lines.close();
          input.destroy();
        }
        this.send({
          type: "taskDetails",
          id: job.id,
          page,
          total: job.failed,
          items,
        });
        return;
      }
      if (m.action === "recover") {
        await this.recover();
        return;
      }
      if (m.action === "releaseSelection") {
        this.uploadEpoch++;
        const selection = this.selection;
        this.selection = undefined;
        if (selection) {
          for (const root of selection.roots)
            await this.access(selection.target, {
              op: "release",
              id: root.id,
            });
        }
        return;
      }
      if (m.action === "chooseUpload") {
        const epoch = ++this.uploadEpoch;
        const previous = this.selection;
        const roots: Root[] = await this.access(m.target, {
          op: "pick",
          kind: m.kind,
        });
        if (epoch !== this.uploadEpoch) {
          for (const root of roots || [])
            await this.access(m.target, { op: "release", id: root.id });
          return;
        }
        if (roots?.length) {
          if (previous)
            for (const root of previous.roots)
              await this.access(previous.target, {
                op: "release",
                id: root.id,
              });
          const targets = this.context.globalState.get<any>(
            "uploadTargets",
            {},
          );
          targets[m.connection] = m.target;
          await this.context.globalState.update("uploadTargets", targets);
          this.selection = { target: m.target, roots };
          this.send({
            type: "uploadSelected",
            roots: roots.map(({ name, type, size }) => ({ name, type, size })),
            target: m.target,
            request: m.request,
          });
        } else this.send({ type: "uploadChoiceCancelled", request: m.request });
      } else if (m.action === "start") {
        const client = await this.getClient(m.connection);
        if (m.direction === "upload" && client.connection.readOnly)
          throw new HdfsError("readOnly");
        let destination: Root | undefined;
        if (m.direction === "download") {
          destination = (
            await this.access(m.target, {
              op: "pick",
              kind: "destination",
              folder: (await this.receive(m.target, { op: "info" })).folder,
            })
          )?.[0];
          if (!destination) {
            this.send({ type: "transferChoiceCancelled", request: m.request });
            return;
          }
        }
        const roots =
          m.direction === "upload"
            ? this.selection?.roots
            : (Array.isArray(m.paths) ? m.paths : []).map((path: string) => ({
                path,
              }));
        if (!roots?.length || roots.length > 200000)
          throw new HdfsError("missing");
        let selectionBytes = 0;
        for (const root of [...roots, ...this.jobs.flatMap((j) => j.roots)])
          selectionBytes += (root.path?.length || 0) * 2 + 256;
        if (selectionBytes > 16 * 1048576)
          throw new HdfsError("selectionLimit");
        if (m.direction === "upload" && this.selection?.target !== m.target)
          throw new HdfsError("changed");
        if (
          this.jobs.filter((j) =>
            ["running", "queued", "enumerating"].includes(j.status),
          ).length >= 20
        )
          throw new HdfsError("busy");
        const job: Job = {
          id: randomUUID(),
          name:
            roots.length === 1
              ? roots[0].name || posix.basename(roots[0].path)
              : `${roots.length} ${this.language() === "zh-CN" ? "项" : "items"}`,
          connection: m.connection,
          rootCount: roots.length,
          identity: this.identity(client),
          direction: m.direction,
          target: m.target,
          folder: m.direction === "upload" ? m.path : destination!.path,
          status: "queued",
          done: 0,
          bytes: 0,
          completedBytes: 0,
          failed: 0,
          failedFiles: 0,
          skipped: 0,
          created: Date.now(),
          policy: "ask",
          roots,
          destination,
        };
        if (m.direction === "upload") this.selection = undefined;
        this.jobs.push(job);
        await this.prune();
        this.update(true);
        this.send({ type: "transferStarted", request: m.request });
        this.start(job, client);
      } else if (m.action === "cancel") {
        this.active.get(m.id)?.abort();
      } else if (m.action === "retry") {
        const job = this.jobs.find((j) => j.id === m.id);
        if (!job || this.active.has(job.id)) return;
        if (job.direction === "download") {
          const destination = (
            await this.access(job.target, {
              op: "pick",
              kind: "destination",
              folder: job.folder,
            })
          )?.[0];
          if (!destination) return;
          if (destination.path !== job.folder) {
            job.cursor = 0;
            job.done = 0;
            job.bytes = 0;
            job.completedBytes = 0;
            job.skipped = 0;
            job.retryFile = undefined;
          }
          job.destination = destination;
          job.folder = destination.path;
        } else {
          const roots: Root[] = await this.access(job.target, {
            op: "pick",
            kind: job.roots.some((r) => r.type === "DIRECTORY")
              ? "folder"
              : "files",
          });
          if (!roots?.length) return;
          if (
            roots.length !== job.roots.length ||
            roots.some((r) => !job.roots.some((old) => old.path === r.path))
          )
            throw new HdfsError("sourceSelection");
          const aliases = new Map(
            job.roots.map((old) => [
              old.id,
              roots.find((r) => r.path === old.path)!.id,
            ]),
          );
          const remaps = new Map<string, string>();
          for (const key of ["plan", "failures", "retryFile"] as const)
            if (job[key]) {
              if (remaps.has(job[key]!)) {
                job[key] = remaps.get(job[key]!);
                continue;
              }
              const original = job[key]!;
              const remapped = original + ".new";
              await writeFile(remapped, "");
              const lines = createInterface({
                input: createReadStream(original),
                crlfDelay: Infinity,
              });
              for await (const line of lines) {
                const e = JSON.parse(line);
                e.root = aliases.get(e.root) || e.root;
                await appendFile(remapped, JSON.stringify(e) + "\n");
              }
              await rm(original, { force: true });
              job[key] = remapped;
              remaps.set(original, remapped);
            }
          job.roots = roots;
        }
        const client = await this.getClient(job.connection);
        if (job.identity && job.identity !== this.identity(client))
          throw new HdfsError("connectionChanged");
        // Upload grants are deliberately not persisted across editor restarts.

        if (
          job.failed &&
          job.failures &&
          !["cancelled", "interrupted"].includes(job.status)
        ) {
          job.retryFile = job.failures;
          job.cursor = 0;
        }
        if (
          job.plan &&
          !job.retryFile &&
          ["cancelled", "interrupted", "failed"].includes(job.status)
        ) {
          const remaining = join(
            this.directory,
            job.id + "-continue-" + randomUUID() + ".plan",
          );
          await writeFile(remaining, "");
          for (const [file, skip] of [
            [job.failures, 0],
            [job.plan, job.cursor || 0],
          ] as const) {
            if (!file) continue;
            const input = createReadStream(file),
              lines = createInterface({ input, crlfDelay: Infinity });
            let index = 0;
            try {
              for await (const line of lines)
                if (index++ >= skip) await appendFile(remaining, line + "\n");
            } finally {
              lines.close();
              input.destroy();
            }
          }
          await rm(job.plan, { force: true });
          if (job.failures) await this.erase(job.failures);
          job.failures = undefined;
          job.plan = remaining;
          job.cursor = 0;
        }
        job.bytes = job.completedBytes || 0;
        job.failed = 0;
        if (job.failedFiles !== undefined) job.failedFiles = 0;
        job.error = undefined;
        job.status = "queued";
        this.update(true);
        this.start(job, client);
      } else if (m.action === "clear") {
        const removed = this.jobs.filter((j) => !this.active.has(j.id));
        for (const j of removed) await this.clean(j);
        this.jobs = this.jobs.filter((j) => this.active.has(j.id));
        this.update(true);
      } else if (m.action === "copyLocation" || m.action === "reveal") {
        const job = this.jobs.find((j) => j.id === m.id);
        if (!job) return;
        if (m.action === "copyLocation") {
          await vscode.env.clipboard.writeText(job.folder);
          this.send({ type: "taskLocationCopied", id: job.id });
          return;
        }
        if (job.direction === "upload") {
          this.send({
            type: "taskNavigate",
            connection: job.connection,
            path: job.folder,
          });
        } else if (job.target === "local" && vscode.env.remoteName)
          await vscode.commands.executeCommand(
            "_hdfsFileManager.reveal",
            job.folder,
          );
        else if (vscode.env.remoteName)
          await vscode.commands.executeCommand(
            "vscode.openFolder",
            vscode.Uri.file(job.folder),
            { forceNewWindow: true },
          );
        else await vscode.env.openExternal(vscode.Uri.file(job.folder));
      }
    } catch (e) {
      this.send({
        type: "taskError",
        text: errorText(e, this.language() as any),
        request: m.request,
      });
    }
  }
  private async prune() {
    while (this.jobs.length > 50) {
      const i = this.jobs.findIndex((j) => !this.active.has(j.id));
      if (i < 0) break;
      await this.clean(this.jobs[i]);
      this.jobs.splice(i, 1);
    }
  }
  private async clean(j: Job) {
    for (const f of [j.failures, j.retryFile, j.plan])
      if (f) await this.erase(f);
  }
  private identity(client: Client) {
    const c = client.connection;
    return createHash("sha256")
      .update(JSON.stringify([c.endpoint, c.auth, c.username]))
      .digest("hex");
  }
  private async erase(path: string) {
    const bytes = (await stat(path).catch(() => undefined))?.size || 0;
    await rm(path, { force: true });
    this.metadataBytes = Math.max(0, this.metadataBytes - bytes);
  }
  private reserve(bytes: number) {
    this.metadataBytes += bytes;
    if (this.metadataBytes > 128 * 1048576)
      throw new HdfsError("manifestLimit");
  }
  private check(signal: AbortSignal) {
    if (signal.aborted) throw new HdfsError("cancelled");
  }
  private async *walkDownload(
    client: Client,
    path: string,
    rel: string,
    signal: AbortSignal,
    depth = 0,
    known?: any,
  ): AsyncGenerator<any> {
    this.check(signal);
    if (depth > 64) throw new HdfsError("depth");
    const entry = known || (await client.stat(path, signal));
    yield {
      path,
      relative: rel,
      type: entry.type,
      size: entry.length,
      stamp: entry.modificationTime,
    };
    if (entry.type === "DIRECTORY")
      for await (const e of client.iterate(path, signal))
        yield* this.walkDownload(
          client,
          joinPath(path, e.pathSuffix),
          rel + "/" + e.pathSuffix,
          signal,
          depth + 1,
          e,
        );
  }
  private async *walkUpload(
    job: Job,
    root: Root,
    rel: string,
    signal: AbortSignal,
    depth = 0,
  ): AsyncGenerator<any> {
    this.check(signal);
    if (depth > 256) throw new HdfsError("depth");
    const info = await this.access(job.target, {
      op: "stat",
      id: root.id,
      relative: rel,
    });
    yield {
      root: root.id,
      source: rel,
      relative: root.name + (rel ? "/" + rel : ""),
      ...info,
    };
    if (info.type === "DIRECTORY") {
      let cursor;
      try {
        do {
          this.check(signal);
          const page = await this.access(job.target, {
            op: "list",
            id: root.id,
            relative: rel,
            cursor,
          });
          cursor = page.cursor;
          for (const e of page.items) {
            if (e.type === "SYMLINK") {
              yield { type: "SYMLINK" };
              continue;
            }
            yield* this.walkUpload(
              job,
              root,
              rel ? rel + "/" + e.name : e.name,
              signal,
              depth + 1,
            );
          }
        } while (cursor);
      } finally {
        if (cursor)
          await this.access(job.target, { op: "closeDir", cursor }).catch(
            () => {},
          );
      }
    }
  }
  private async *entries(
    job: Job,
    client: Client,
    signal: AbortSignal,
  ): AsyncGenerator<any> {
    if (job.retryFile) {
      const lines = createInterface({
        input: createReadStream(job.retryFile),
        crlfDelay: Infinity,
      });
      try {
        for await (const line of lines) {
          this.check(signal);
          yield JSON.parse(line);
        }
      } finally {
        lines.close();
      }
      return;
    }
    const paths = job.roots.map((r) => r.path);
    for (const root of job.roots) {
      this.check(signal);
      if (job.direction === "upload")
        yield* this.walkUpload(job, root, "", signal);
      else if (
        !paths.some(
          (p) =>
            p !== root.path && root.path.startsWith(p.replace(/\/$/, "") + "/"),
        )
      )
        yield* this.walkDownload(
          client,
          root.path,
          posix.basename(root.path) || "hdfs",
          signal,
        );
    }
  }
  private start(job: Job, client: Client) {
    const work = this.run(job, client).catch((error) => {
      job.status = "failed";
      job.error = errorText(error, this.language() as any);
      this.emit();
    });
    this.work.add(work);
    void work.finally(() => this.work.delete(work));
  }
  private async run(job: Job, client: Client) {
    if (this.closed) return;
    const controller = new AbortController(),
      signal = controller.signal;
    this.active.set(job.id, controller);
    const failures = join(
      this.directory,
      job.id + "-" + randomUUID() + ".jsonl",
    );
    let ledgerBytes = 0;
    const conflict: { choice?: Exclude<Job["policy"], "ask"> } = {};
    try {
      await this.gate.run(signal, async () => {
        job.status = "running";
        this.update(true);
        if (!job.plan && !job.retryFile) {
          job.status = "enumerating";
          this.update(true);
          const plan = join(this.directory, job.id + ".plan");
          await writeFile(plan, "");
          let bytes = 0;
          try {
            for await (const entry of this.entries(job, client, signal)) {
              const line = JSON.stringify(entry) + "\n";
              bytes += Buffer.byteLength(line);
              this.reserve(Buffer.byteLength(line));
              if (bytes > 32 * 1048576) throw new HdfsError("manifestLimit");
              await appendFile(plan, line);
              job.planned = (job.planned || 0) + 1;
              this.update();
            }
          } catch (e) {
            await this.erase(plan);
            job.planned = 0;
            throw e;
          }
          job.plan = plan;
          if (job.direction === "download") job.roots = [];
          job.cursor = 0;
          this.dirty = true;
          await this.persist();
        }
        job.status = "running";
        this.update(true);
        const input = createReadStream(job.retryFile || job.plan!);
        const lines = createInterface({ input, crlfDelay: Infinity });
        let position = 0;
        try {
          for await (const line of lines) {
            if (position++ < (job.cursor || 0)) continue;
            this.check(signal);
            const entry = JSON.parse(line);
            if (entry.type === "SYMLINK") {
              job.cursor = position;
              continue;
            }
            job.bytes = job.completedBytes || 0;
            job.current = entry.relative;
            this.update();
            try {
              const result =
                job.direction === "download"
                  ? await this.download(job, client, entry, signal, conflict)
                  : await this.upload(job, client, entry, signal, conflict);
              if (typeof result === "number") {
                job.done++;
                job.completedBytes = (job.completedBytes || 0) + result;
              }
            } catch (e) {
              if (
                signal.aborted ||
                (e instanceof HdfsError &&
                  ["diskSpace", "cancelled"].includes(e.code)) ||
                ["ENOSPC", "EDQUOT"].includes((e as any)?.code)
              )
                throw e;
              job.failed++;
              if (entry.type === "FILE" && job.failedFiles !== undefined)
                job.failedFiles++;
              job.error = errorText(e, this.language() as any);
              const failureLine =
                JSON.stringify({ ...entry, failure: job.error }) + "\n";
              ledgerBytes += Buffer.byteLength(failureLine);
              this.reserve(Buffer.byteLength(failureLine));
              if (ledgerBytes > 4 * 1048576)
                throw new HdfsError("manifestLimit");
              await appendFile(failures, failureLine);
            }
            job.cursor = position;
            this.dirty = true;
            await this.persist();
          }
        } finally {
          lines.close();
          input.destroy();
        }
        job.bytes = job.completedBytes || 0;
        job.status = job.failed ? "partial" : "completed";
      });
    } catch (e) {
      const cancelled =
        signal.aborted || (e instanceof HdfsError && e.code === "cancelled");
      job.status = cancelled ? "cancelled" : "failed";
      if (!cancelled) job.error = errorText(e, this.language() as any);
    } finally {
      this.active.delete(job.id);
      job.current = undefined;
      if (
        job.retryFile &&
        !["cancelled", "interrupted", "failed"].includes(job.status)
      ) {
        await this.erase(job.retryFile);
        job.retryFile = undefined;
        job.cursor = 0;
      }
      if (job.failed) {
        if (job.failures && job.failures !== job.retryFile)
          await this.erase(job.failures);
        job.failures = failures;
      } else await this.erase(failures);
      for (const r of job.roots)
        if (r.id)
          await this.access(job.target, { op: "release", id: r.id }).catch(
            () => {},
          );
      if (job.destination)
        await this.access(job.target, {
          op: "release",
          id: job.destination.id,
        }).catch(() => {});
      if (job.status === "completed") job.roots = [];
      this.update(true);
      if (job.direction === "upload") this.changed();
    }
  }
  private async download(
    job: Job,
    client: Client,
    e: any,
    signal: AbortSignal,
    conflict: { choice?: Exclude<Job["policy"], "ask"> },
  ) {
    // Use the target platform's filename rules. Sanitization conflicts use the same conflict policy.
    const info = await this.receive(job.target, { op: "info" });
    const relative = e.relative
      .split("/")
      .map((s: string) => downloadName("/" + s, info.platform))
      .join("/");
    if (e.type === "DIRECTORY") {
      await this.access(job.target, {
        op: "ensure",
        id: job.destination!.id,
        relative,
      });
      return;
    }
    const fresh = await client.stat(e.path, signal);
    if (fresh.type !== "FILE") throw new HdfsError("changed");
    e = { ...e, size: fresh.length, stamp: fresh.modificationTime };
    const folder = await this.access(job.target, {
      op: "ensure",
      id: job.destination!.id,
      relative: posix.dirname(relative) === "." ? "" : posix.dirname(relative),
    });
    let name = posix.basename(relative),
      prepared = await this.receive(job.target, {
        op: "prepare",
        folder,
        name,
      });
    if (prepared.stamp !== null) {
      const policy = await this.conflictPolicy(job, relative, signal, conflict);
      if (policy === "skip") {
        job.skipped++;
        return false;
      }
      if (policy === "keep") {
        let n = 1;
        const ext = posix.extname(name),
          base = name.slice(0, name.length - ext.length);
        do {
          name = `${base} (${n++})${ext}`;
          prepared = await this.receive(job.target, {
            op: "prepare",
            folder,
            name,
          });
        } while (prepared.stamp !== null);
      }
    }
    const started = await this.receive(job.target, {
      op: "begin",
      folder,
      name,
      stamp: prepared.stamp,
      size: e.size,
      language: this.language(),
      quiet: true,
    });
    this.receivers.set(started.id, job.id);
    try {
      const hash = await client.streamDownload(
        e.path,
        e.size,
        signal,
        async (chunk, offset) => {
          await this.receive(job.target, {
            op: "write",
            id: started.id,
            offset,
            data: chunk.toString("base64"),
          });
          job.bytes += chunk.length;
          this.update();
        },
      );
      this.check(signal);
      const after = await client.stat(e.path, signal);
      if (after.length !== e.size || after.modificationTime !== e.stamp)
        throw new HdfsError("changed");
      await this.receive(job.target, {
        op: "commit",
        id: started.id,
        sha256: hash,
      });
      return e.size as number;
    } catch (e) {
      await this.receive(job.target, { op: "abort", id: started.id }).catch(
        () => {},
      );
      throw e;
    } finally {
      this.receivers.delete(started.id);
    }
  }
  private async conflictPolicy(
    job: Job,
    relative: string,
    signal: AbortSignal,
    conflict: { choice?: Exclude<Job["policy"], "ask"> },
  ) {
    if (job.policy !== "ask") return job.policy;
    if (conflict.choice) return conflict.choice;
    const zh = this.language() === "zh-CN";
    const keep = zh ? "保留两者" : "Keep both";
    const skip = zh ? "跳过" : "Skip";
    const replace = zh ? "替换" : "Replace";
    const answer = await this.conflictGate.run(signal, async () =>
      vscode.window.showWarningMessage(
        zh
          ? "目标位置已有同名文件"
          : "A file already exists at the destination",
        {
          modal: true,
          detail:
            relative +
            "\n\n" +
            (zh
              ? job.direction === "upload"
                ? "此选择适用于本次上传的所有同名文件。"
                : "此选择适用于本次下载的所有同名文件。"
              : job.direction === "upload"
                ? "This choice applies to all conflicts in this upload."
                : "This choice applies to all conflicts in this download."),
        },
        keep,
        skip,
        replace,
      ),
    );
    this.check(signal);
    if (!answer) throw new HdfsError("cancelled");
    return (conflict.choice =
      answer === keep ? "keep" : answer === replace ? "replace" : "skip");
  }
  private async upload(
    job: Job,
    client: Client,
    e: any,
    signal: AbortSignal,
    conflict: { choice?: Exclude<Job["policy"], "ask"> },
  ) {
    const sourceInfo = await this.access(job.target, {
      op: "stat",
      id: e.root,
      relative: e.source,
    });
    if (sourceInfo.type !== e.type) throw new HdfsError("changed");
    e = { ...e, ...sourceInfo };
    const path =
      joinPath(job.folder, e.relative.split("/")[0]) +
      e.relative.slice(
        e.relative.indexOf("/") < 0
          ? e.relative.length
          : e.relative.indexOf("/"),
      );
    if (e.type === "DIRECTORY") {
      await client.mkdir(path, signal);
      return;
    }
    let target = path,
      existing = await client.exists(path, signal);
    if (existing) {
      if (existing.type !== "FILE") throw new HdfsError("exists");
      const policy = await this.conflictPolicy(
        job,
        e.relative,
        signal,
        conflict,
      );
      if (policy === "skip") {
        job.skipped++;
        return false;
      }
      if (policy === "keep") {
        let n = 1;
        const ext = posix.extname(path),
          base = path.slice(0, path.length - ext.length);
        do {
          target = `${base} (${n++})${ext}`;
        } while (await client.exists(target, signal));
        existing = undefined;
      }
    }
    const temporary = joinPath(
      posix.dirname(target),
      ".hdfs-explorer-" + randomUUID() + ".upload",
    );
    const backup = temporary + ".backup";
    const journal = join(this.directory, "recovery-" + randomUUID() + ".json");
    const access = (m: any) => this.access(job.target, m);
    async function* source() {
      let offset = 0;
      while (offset < e.size) {
        const data = Buffer.from(
          await access({
            op: "read",
            id: e.root,
            relative: e.source,
            stamp: e.stamp,
            offset,
          }),
          "base64",
        );
        if (!data.length) throw new HdfsError("changed");
        offset += data.length;
        yield data;
      }
    }
    let previous = 0,
      backed = false,
      phase = "uploading";
    try {
      await writeFile(
        journal,
        JSON.stringify({
          connection: job.connection,
          temporary,
          target,
          backup,
          existing: !!existing,
        }),
      );
      this.recoveryCount++;
      this.liveJournals.add(journal);
      await client.upload(temporary, e.size, source(), signal, (n) => {
        job.bytes += n - previous;
        previous = n;
        this.update();
      });
      const after = await access({
        op: "stat",
        id: e.root,
        relative: e.source,
      });
      if (after.stamp !== e.stamp) throw new HdfsError("changed");
      if (existing) {
        const now = await client.stat(target, signal);
        if (
          now.modificationTime !== existing.modificationTime ||
          now.length !== existing.length
        )
          throw new HdfsError("changed");
        phase = "backup";
        await client.rename(target, backup, signal);
        backed = true;
      }
      phase = "commit";
      await client.rename(temporary, target, signal);
      if (backed) await client.remove(backup, signal);
      await rm(journal, { force: true });
      this.recoveryCount--;
      return e.size as number;
    } catch (error) {
      if (phase === "uploading") {
        const cleanup = new AbortController(),
          timer = setTimeout(() => cleanup.abort(), 10000);
        try {
          if (await client.exists(temporary, cleanup.signal))
            await client.remove(temporary, cleanup.signal);
          await rm(journal, { force: true });
          this.recoveryCount--;
        } catch {
          /* Retain the journal when cleanup cannot be confirmed. */
        } finally {
          clearTimeout(timer);
        }
      }
      throw error;
    } finally {
      this.liveJournals.delete(journal);
    }
  }
  async recover() {
    if (this.recovering) return;
    this.recovering = true;
    try {
      await this.recoverInterrupted();
    } finally {
      this.recovering = false;
      this.update(true);
    }
  }
  private async recoverInterrupted() {
    const zh = this.language() === "zh-CN";
    for (const name of await readdir(this.directory)) {
      if (!/^recovery-[a-f0-9-]+\.json$/.test(name)) continue;
      const file = join(this.directory, name);
      if (this.liveJournals.has(file)) continue;
      const record = JSON.parse(await readFile(file, "utf8"));
      const client = await this.getClient(record.connection);
      if (client.connection.readOnly) throw new HdfsError("readOnly");
      const c = new AbortController();
      let timer = setTimeout(() => c.abort(), 30000);
      try {
        const target = await client.exists(record.target, c.signal),
          backup = await client.exists(record.backup, c.signal),
          temporary = await client.exists(record.temporary, c.signal);
        clearTimeout(timer);
        const label =
          !target && backup
            ? zh
              ? "恢复旧文件"
              : "Restore previous file"
            : zh
              ? "清理临时文件"
              : "Clean temporary files";
        if (
          (await vscode.window.showWarningMessage(
            label,
            { modal: true, detail: record.target },
            label,
          )) !== label
        )
          break;
        timer = setTimeout(() => c.abort(), 30000);
        if (!target && backup)
          await client.rename(record.backup, record.target, c.signal);
        else if (backup) await client.remove(record.backup, c.signal);
        if (temporary) await client.remove(record.temporary, c.signal);
        await rm(file, { force: true });
        this.recoveryCount--;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  cancelReceiver(id: string) {
    const job = this.receivers.get(id);
    if (job) this.active.get(job)?.abort();
  }

  cancelAll() {
    for (const c of this.active.values()) c.abort();
  }
  async settle() {
    await Promise.allSettled([...this.work]);
  }
  async dispose() {
    this.closed = true;
    this.cancelAll();
    await Promise.allSettled([...this.work]);
    clearTimeout(this.timer);
    await this.files.dispose();
    await this.disk.dispose();
    await this.persist();
  }
}
