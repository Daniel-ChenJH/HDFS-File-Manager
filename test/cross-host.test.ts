import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "../src/client";
import { TransferService } from "../src/transfer";
import { writableFixture } from "./write-fixture";
test("SSH task routing streams local sources and destinations through the companion without exposing credentials", async () => {
  const base = await realpath(
      await mkdtemp(join(tmpdir(), "hdfs-cross-host-")),
    ),
    f = await writableFixture(),
    messages: any[] = [],
    bridge: any[] = [];
  let picks: string[] = [];
  let full = false;
  let conflicts = 0;
  const mock: any = {
    env: { remoteName: "ssh-remote" },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    ProgressLocation: { Notification: 1 },
    window: {
      showWarningMessage: async (
        _message: string,
        options: any,
        keep: string,
      ) => {
        assert.equal(options.modal, true);
        conflicts++;
        return keep;
      },
      showOpenDialog: async () =>
        picks.map((fsPath) => ({ fsPath, scheme: "file" })),
      withProgress: async (_: any, fn: any) =>
        fn(
          { report() {} },
          {
            onCancellationRequested: () => ({ dispose() {} }),
            isCancellationRequested: false,
          },
        ),
    },
    commands: {},
  };
  const require = createRequire(join(process.cwd(), "package.json"));
  async function load(file: string) {
    const code = (
      await build({
        ...(file === "src/tasks.ts"
          ? {
              stdin: {
                contents:
                  "export {Tasks} from './src/tasks'; export {Client} from './src/client';",
                resolveDir: process.cwd(),
                loader: "ts" as const,
              },
            }
          : { entryPoints: [file] }),
        bundle: true,
        platform: "node",
        format: "cjs",
        write: false,
        external: ["vscode", "undici"],
      })
    ).outputFiles[0].text;
    const m: any = { exports: {} };
    new Function("require", "module", "exports", code)(
      (id: string) => (id === "vscode" ? mock : require(id)),
      m,
      m.exports,
    );
    return m.exports;
  }
  const access = new (await load("src/file-access.ts")).FileAccess();
  const disk = new TransferService({
    folder: () => join(base, "out"),
    remember: async () => {},
    choose: async () => join(base, "out"),
    progress: () => ({ update() {}, close() {} }),
  });
  mock.commands.executeCommand = async (name: string, m: any) => {
    bridge.push({ name, message: m });
    if (name === "_hdfsFileManager.files") return access.reply(m);
    if (name === "_hdfsFileManager.localTransfer") {
      if (full && m.op === "write") return { ok: false, code: "diskSpace" };
      return disk.handle(m);
    }
    throw Error("unexpected bridge command");
  };
  const api = await load("src/tasks.ts");
  const client = new api.Client(
    {
      id: "fixture",
      name: "Fixture",
      endpoint: f.endpoint,
      root: "/",
      auth: "bearer",
      username: "",
      timeout: 2,
    },
    "fictional-private-token",
  );
  const tasks = new api.Tasks(
    {
      globalStorageUri: { fsPath: join(base, "state") },
      globalState: {
        get: (_: string, value: any) => value,
        update: async () => {},
      },
    },
    async () => client,
    () => "en",
    (m: any) => messages.push(m),
    () => "example-ssh",
    () => {},
  );
  const wait = async () => {
    for (let n = 0; n < 500; n++) {
      const job = messages
        .filter((m) => m.type === "tasks")
        .at(-1)
        ?.jobs.at(-1);
      if (job && !["running", "queued", "enumerating"].includes(job.status))
        return job;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error("timeout");
  };
  try {
    await mkdir(join(base, "out"));
    const bytes = Buffer.alloc(2 * 1048576 + 13, 0x8f);
    await writeFile(join(base, "local.bin"), bytes);
    picks = [join(base, "local.bin")];
    await tasks.message({
      action: "chooseUpload",
      target: "local",
      kind: "files",
      connection: "fixture",
    });
    await tasks.message({
      action: "start",
      direction: "upload",
      target: "local",
      connection: "fixture",
      path: "/",
      policy: "keep",
    });
    let job = await wait();
    assert.equal(job.status, "completed", job.error);
    assert.deepEqual(f.files.get("/local.bin"), bytes);
    picks = [join(base, "out")];
    await tasks.message({
      action: "start",
      direction: "download",
      target: "local",
      connection: "fixture",
      paths: ["/local.bin"],
      policy: "keep",
    });
    job = await wait();
    assert.equal(job.status, "completed", job.error);
    assert.deepEqual(await readFile(join(base, "out", "local.bin")), bytes);
    assert.equal(conflicts, 0);
    // A cancelled file restarts from byte zero; its old progress must not
    // be counted a second time after the retry commits.
    await mkdir(join(base, "cancel-out"));
    picks = [join(base, "cancel-out")];
    const originalDownload = client.streamDownload.bind(client);
    let cancelOnce = true;
    client.streamDownload = async (
      path: any,
      size: any,
      signal: any,
      consume: any,
    ) =>
      originalDownload(path, size, signal, async (chunk: any, offset: any) => {
        await consume(chunk, offset);
        if (cancelOnce) {
          cancelOnce = false;
          const id = messages
            .filter((m) => m.type === "tasks")
            .at(-1)
            .jobs.at(-1).id;
          await tasks.message({ action: "cancel", id });
        }
      });
    await tasks.message({
      action: "start",
      direction: "download",
      target: "local",
      connection: "fixture",
      paths: ["/local.bin"],
      policy: "keep",
    });
    job = await wait();
    assert.equal(job.status, "cancelled");
    assert.ok(job.bytes > 0);
    await tasks.message({ action: "retry", id: job.id });
    job = await wait();
    assert.equal(job.status, "completed", job.error);
    assert.equal(
      job.bytes,
      bytes.length,
      "cancelled bytes must not inflate the successful retry",
    );
    assert.deepEqual(
      await readFile(join(base, "cancel-out", "local.bin")),
      bytes,
    );
    client.streamDownload = originalDownload;
    assert.ok(
      bridge.some(
        (e) => e.name === "_hdfsFileManager.files" && e.message.op === "read",
      ),
    );
    assert.ok(
      bridge.some(
        (e) =>
          e.name === "_hdfsFileManager.localTransfer" &&
          e.message.op === "write",
      ),
    );
    assert.ok(
      bridge
        .filter((e) => e.message.data)
        .every((e) => e.message.data.length <= Math.ceil(1048576 / 3) * 4),
    );
    assert.ok(!JSON.stringify(bridge).includes("fictional-private-token"));
    assert.ok(!JSON.stringify(bridge).includes(f.endpoint));
    f.files.set("/another.bin", bytes);
    full = true;
    picks = [join(base, "out")];
    const before = f.calls.filter((c) => c.op === "OPEN").length;
    await tasks.message({
      action: "start",
      direction: "download",
      target: "local",
      connection: "fixture",
      paths: ["/local.bin", "/another.bin"],
      policy: "keep",
    });
    job = await wait();
    assert.equal(job.status, "failed");
    assert.match(job.error, /disk space/);
    assert.equal(f.calls.filter((c) => c.op === "OPEN").length - before, 1);
    full = false;
    const updated = Buffer.from("updated after a failed download");
    f.files.set("/another.bin", updated);
    await tasks.message({ action: "retry", id: job.id });
    job = await wait();
    assert.equal(job.status, "completed", job.error);
    assert.deepEqual(await readFile(join(base, "out", "another.bin")), updated);
    assert.equal(
      conflicts,
      2,
      "only prompt when the chosen destination contains a same-name file",
    );
    assert.equal(
      job.bytes,
      bytes.length + updated.length,
      "failed download bytes must not inflate successful retry",
    );
  } finally {
    await tasks.dispose();
    await access.dispose();
    await disk.dispose();
    await f.close();
    await rm(base, { recursive: true, force: true });
  }
});
