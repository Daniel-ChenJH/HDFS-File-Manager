import http from "node:http";
import { once } from "node:events";
import { posix } from "node:path";
export async function writableFixture() {
  const denied = new Set(["/denied"]);
  const files = new Map<string, Buffer>(),
    dirs = new Set(["/"]);
  let clock = 1;
  const times = new Map<string, number>();
  const calls: any[] = [];
  const entry = (path: string) => ({
    pathSuffix: posix.basename(path),
    type: dirs.has(path) ? "DIRECTORY" : "FILE",
    length: files.get(path)?.length || 0,
    modificationTime: times.get(path) || 1,
    owner: "example",
    group: "example",
    permission: "755",
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost"),
      path =
        decodeURIComponent(url.pathname.replace(/^\/webhdfs\/v1/, "")) || "/",
      op = url.searchParams.get("op");
    calls.push({
      method: req.method,
      path,
      op,
      stage: url.searchParams.get("data"),
    });
    const json = (code: number, data: any) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const missing = () =>
      json(404, { RemoteException: { exception: "FileNotFoundException" } });
    if (path.startsWith("/gateway-denied"))
      return json(403, { error: "denied" });
    if ([...denied].some((prefix) => path.startsWith(prefix)))
      return json(403, {
        RemoteException: { exception: "AccessControlException" },
      });
    if (op === "CREATE") {
      if (req.method !== "PUT") return json(405, {});
      if (!url.searchParams.has("data")) {
        url.searchParams.set("data", "1");
        const location =
          endpoint +
          url.pathname.replace(/^\/webhdfs\/v1/, "") +
          "?" +
          url.searchParams;
        return json(200, { Location: location });
      }
      res.writeContinue();
      if (files.has(path) || dirs.has(path)) return json(409, {});
      const chunks = [];
      try {
        for await (const b of req) chunks.push(Buffer.from(b));
        files.set(path, Buffer.concat(chunks));
        times.set(path, ++clock);
        return json(201, {});
      } catch {
        return;
      }
    }
    if (op === "MKDIRS") {
      let p = path;
      while (p !== "/") {
        dirs.add(p);
        p = posix.dirname(p);
      }
      return json(200, { boolean: true });
    }
    if (op === "GETFILESTATUS")
      return files.has(path) || dirs.has(path)
        ? json(200, { FileStatus: entry(path) })
        : missing();
    if (op === "OPEN") {
      const bytes = files.get(path);
      if (!bytes) return missing();
      const offset = Number(url.searchParams.get("offset") || 0),
        length = Number(url.searchParams.get("length") || bytes.length);
      res.writeHead(200);
      res.end(bytes.subarray(offset, offset + length));
      return;
    }
    if (op === "LISTSTATUS" || op === "LISTSTATUS_BATCH") {
      if (!dirs.has(path)) return missing();
      const all = [...dirs, ...files.keys()]
        .filter((p) => p !== path && posix.dirname(p) === path)
        .sort();
      if (op === "LISTSTATUS")
        return json(200, { FileStatuses: { FileStatus: all.map(entry) } });
      const after = url.searchParams.get("startAfter") || "",
        rest = all.filter((p) => posix.basename(p) > after),
        batch = rest.slice(0, 2);
      return json(200, {
        DirectoryListing: {
          partialListing: { FileStatuses: { FileStatus: batch.map(entry) } },
          remainingEntries: Math.max(0, rest.length - 2),
        },
      });
    }
    if (op === "RENAME") {
      const to = url.searchParams.get("destination")!;
      if (!files.has(path) && !dirs.has(path)) return missing();
      if (files.has(to) || dirs.has(to)) return json(200, { boolean: false });
      for (const [p, b] of [...files])
        if (p === path || p.startsWith(path + "/")) {
          files.delete(p);
          files.set(to + p.slice(path.length), b);
          times.set(to + p.slice(path.length), times.get(p) || 1);
        }
      for (const p of [...dirs])
        if (p === path || p.startsWith(path + "/")) {
          dirs.delete(p);
          dirs.add(to + p.slice(path.length));
        }
      return json(200, { boolean: true });
    }
    if (op === "DELETE") {
      if (!files.has(path) && !dirs.has(path)) return missing();
      for (const p of files.keys())
        if (p === path || p.startsWith(path + "/")) files.delete(p);
      for (const p of dirs)
        if (p === path || p.startsWith(path + "/")) dirs.delete(p);
      return json(200, { boolean: true });
    }
    json(400, {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/webhdfs/v1`;
  return {
    endpoint,
    denied,
    files,
    dirs,
    calls,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
