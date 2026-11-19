import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
  symlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "../src/client";
import { writableFixture } from "./write-fixture";
test("task engine uploads and recursively downloads real disk bytes, handles conflicts and never follows symlinks", async () => {
  const f = await writableFixture(),
    base = await realpath(await mkdtemp(join(tmpdir(), "hdfs-task-tests-"))),
    messages: any[] = [];
  let picks: string[] = [];
  let conflictChoice: string | undefined;
  let conflictPrompts = 0;
  let clipboard = "";
  const context: any = {
    globalStorageUri: { fsPath: join(base, "storage") },
    globalState: {
      get: (_: string, defaultValue: any) => defaultValue,
      update: async () => {},
    },
  };
  const mock: any = {
    env: {
      clipboard: {
        writeText: async (text: string) => {
          clipboard = text;
        },
      },
    },
    Uri: { file: (path: string) => ({ fsPath: path, scheme: "file" }) },
    ProgressLocation: { Notification: 1 },
    window: {
      showWarningMessage: async (_message: string, options: any) => {
        assert.equal(options.modal, true);
        conflictPrompts++;
        return conflictChoice;
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
  };
  const code = (
    await build({
      entryPoints: ["src/tasks.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      external: ["vscode", "undici"],
    })
  ).outputFiles[0].text;
  const module: any = { exports: {} };
  const require = createRequire(join(process.cwd(), "package.json"));
  new Function("require", "module", "exports", code)(
    (id: string) => (id === "vscode" ? mock : require(id)),
    module,
    module.exports,
  );
  const client = new Client({
    id: "fixture",
    name: "Fixture",
    endpoint: f.endpoint,
    root: "/",
    auth: "none",
    username: "",
    timeout: 2,
  });
  const tasks = new module.exports.Tasks(
    context,
    async () => client,
    () => "en",
    (m: any) => messages.push(m),
    () => "example-ssh",
    () => {},
  );
  const waitJob = async () => {
    for (let i = 0; i < 500; i++) {
      const job = messages
        .filter((m) => m.type === "tasks")
        .at(-1)
        ?.jobs.at(-1);
      if (job && !["running", "queued", "enumerating"].includes(job.status))
        return job;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("task timeout");
  };
  try {
    await mkdir(join(base, "source", "empty"), { recursive: true });
    await mkdir(join(base, "out"));
    const bytes = Buffer.alloc(3 * 1048576 + 7);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    await writeFile(join(base, "source", "报告 #%&.bin"), bytes);
    await writeFile(join(base, "source", "tiny.txt"), "hello");
    await symlink(
      join(base, "source"),
      join(base, "source", "loop"),
      "junction",
    );
    picks = [join(base, "source")];
    await tasks.message({
      action: "chooseUpload",
      target: "host",
      kind: "folder",
    });
    await tasks.message({
      action: "start",
      direction: "upload",
      target: "host",
      connection: "fixture",
      path: "/",
      policy: "keep",
    });
    let job = await waitJob();
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.done, 2);
    assert.equal(job.skipped, 0);
    assert.deepEqual(f.files.get("/source/报告 #%&.bin"), bytes);
    assert.ok(f.dirs.has("/source/empty"));
    picks = [join(base, "out")];
    await tasks.message({
      action: "start",
      direction: "download",
      target: "host",
      connection: "fixture",
      paths: ["/source", "/source/tiny.txt"],
      policy: "keep",
    });
    job = await waitJob();
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.done, 2);
    assert.deepEqual(
      await readFile(join(base, "out", "source", "报告 #%&.bin")),
      bytes,
    );
    await tasks.message({
      action: "copyLocation",
      id: job.id,
      path: "/ignored-input",
    });
    assert.equal(clipboard, join(base, "out"));
    assert.deepEqual(messages.at(-1), {
      type: "taskLocationCopied",
      id: job.id,
    });
    assert.ok((await readdir(join(base, "out", "source"))).includes("empty"));
    assert.equal(conflictPrompts, 0);
    const downloaded = join(base, "out", "source", "tiny.txt");
    await writeFile(downloaded, "local edit");
    for (const choice of ["Keep both", "Skip", "Replace", undefined]) {
      conflictChoice = choice;
      await tasks.message({
        action: "start",
        direction: "download",
        target: "host",
        connection: "fixture",
        paths: ["/source"],
      });
      job = await waitJob();
      assert.equal(job.status, choice ? "completed" : "cancelled", job.error);
      assert.equal(
        await readFile(downloaded, "utf8"),
        choice === "Keep both" || choice === "Skip" ? "local edit" : "hello",
      );
      assert.equal(
        await readFile(join(base, "out", "source", "tiny (1).txt"), "utf8"),
        "hello",
      );
      if (choice === "Skip") {
        assert.equal(job.bytes, 0);
        assert.equal(job.done, 0);
        assert.equal(job.skipped, 2);
      }
    }
    assert.equal(conflictPrompts, 4);
    picks = [join(base, "source", "empty")];
    await tasks.message({
      action: "chooseUpload",
      target: "host",
      kind: "folder",
    });
    await tasks.message({
      action: "start",
      direction: "upload",
      target: "host",
      connection: "fixture",
      path: "/",
    });
    job = await waitJob();
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.done, 0);
    assert.ok(f.dirs.has("/empty"));
    picks = [join(base, "out")];
    await tasks.message({
      action: "start",
      direction: "download",
      target: "host",
      connection: "fixture",
      paths: ["/empty"],
    });
    job = await waitJob();
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.done, 0);
    assert.deepEqual(await readdir(join(base, "out", "empty")), []);
    await writeFile(join(base, "source", "tiny.txt"), "replacement");
    conflictChoice = "Replace";
    picks = [join(base, "source", "tiny.txt")];
    await tasks.message({
      action: "chooseUpload",
      target: "host",
      kind: "files",
    });
    await tasks.message({
      action: "start",
      direction: "upload",
      target: "host",
      connection: "fixture",
      path: "/source",
      policy: "replace",
    });
    job = await waitJob();
    assert.equal(job.status, "completed", job.error);
    assert.equal(f.files.get("/source/tiny.txt")?.toString(), "replacement");
    conflictChoice = "Keep both";
    picks = [join(base, "source", "tiny.txt")];
    await tasks.message({
      action: "chooseUpload",
      target: "host",
      kind: "files",
    });
    await tasks.message({
      action: "start",
      direction: "upload",
      target: "host",
      connection: "fixture",
      path: "/source",
      policy: "keep",
    });
    job = await waitJob();
    assert.equal(job.status, "completed", job.error);
    assert.equal(
      f.files.get("/source/tiny (1).txt")?.toString(),
      "replacement",
    );
    await writeFile(join(base, "source", "tiny.txt"), "skip-content");
    conflictChoice = "Skip";
    await tasks.message({
      action: "chooseUpload",
      target: "host",
      kind: "files",
    });
    await tasks.message({
      action: "start",
      direction: "upload",
      target: "host",
      connection: "fixture",
      path: "/source",
      policy: "skip",
    });
    job = await waitJob();
    assert.equal(job.skipped, 1);
    assert.equal(job.done, 0);
    assert.equal(f.files.get("/source/tiny.txt")?.toString(), "replacement");
    // Cancel through the same task action as the UI, then continue without
    // leaving an unfinished HDFS object or retransferring completed items.
    const originalUpload = client.upload.bind(client);
    let cancelOnce = true;
    client.upload = async (path, size, source, signal, progress) =>
      originalUpload(path, size, source, signal, (n) => {
        progress(n);
        if (cancelOnce && n >= 1048576) {
          cancelOnce = false;
          const id = messages
            .filter((m) => m.type === "tasks")
            .at(-1)
            .jobs.at(-1).id;
          void tasks.message({ action: "cancel", id });
        }
      });
    picks = [join(base, "source", "报告 #%&.bin")];
    await tasks.message({
      action: "chooseUpload",
      target: "host",
      kind: "files",
    });
    await tasks.message({
      action: "start",
      direction: "upload",
      target: "host",
      connection: "fixture",
      path: "/cancel-check",
      policy: "keep",
    });
    job = await waitJob();
    assert.equal(job.status, "cancelled");
    assert.equal(
      messages.filter((m) => m.type === "tasks").at(-1).recoveryCount,
      0,
    );
    assert.ok([...f.files.keys()].every((p) => !p.includes(".upload")));
    const resumed = Buffer.concat([bytes, Buffer.from("new")]);
    await writeFile(join(base, "source", "报告 #%&.bin"), resumed);
    await tasks.message({ action: "retry", id: job.id });
    job = await waitJob();
    assert.equal(job.status, "completed", job.error);
    assert.deepEqual(f.files.get("/cancel-check/报告 #%&.bin"), resumed);
    assert.equal(
      job.bytes,
      resumed.length,
      "cancelled upload bytes must not inflate a successful retry",
    );
    // Permission recovery retries only the failed manifest using fresh grants.
    picks = [join(base, "source")];
    await tasks.message({
      action: "chooseUpload",
      target: "host",
      kind: "folder",
    });
    await tasks.message({
      action: "start",
      direction: "upload",
      target: "host",
      connection: "fixture",
      path: "/denied",
      policy: "keep",
    });
    job = await waitJob();
    assert.equal(job.status, "partial");
    assert.equal(job.failed, 4);
    assert.equal(job.failedFiles, 2);
    f.denied.clear();
    await tasks.message({ action: "retry", id: job.id });
    job = await waitJob();
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.failed, 0);
    assert.equal(job.failedFiles, 0);
    assert.deepEqual(f.files.get("/denied/source/报告 #%&.bin"), resumed);
    assert.ok(
      [...f.files.keys()].every(
        (p) => !p.includes(".upload") && !p.includes(".backup"),
      ),
    );
  } finally {
    await tasks.dispose();
    await f.close();
    await rm(base, { recursive: true, force: true });
  }
});
