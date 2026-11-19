import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "../src/client";
import {
  Connection,
  Gate,
  HdfsError,
  Latest,
  normalizePath,
  validateConnection,
  validatePreferences,
  defaults,
  joinPath,
  downloadName,
} from "../src/model";
import { errorText } from "../src/i18n";
import { fixture, files } from "./fixture";
let server: Awaited<ReturnType<typeof fixture>>,
  connection: Connection,
  client: Client,
  directory: string;
const signal = () => new AbortController().signal;
test("stopped local endpoint produces an actionable refusal without exposing its URL", async () => {
  const stopped = await fixture();
  const endpoint = stopped.endpoint;
  await stopped.close();
  const c = new Client({ ...connection, endpoint });
  await assert.rejects(c.list("/", signal()), (e: any) => {
    assert.equal(e.code, "loopbackRefused");
    const text = errorText(e, "en");
    assert.match(text, /No service is listening/);
    assert.match(text, /connection address/);
    assert.ok(!text.includes(endpoint));
    return true;
  });
});
before(async () => {
  server = await fixture();
  connection = {
    id: "demo",
    name: "Fixture",
    endpoint: server.endpoint,
    auth: "simple",
    username: "demo",
    root: "/",
    timeout: 2,
  };
  client = new Client(connection);
  directory = await mkdtemp(join(tmpdir(), "hdfs-tests-"));
});
after(async () => {
  await server.close();
  await rm(directory, { recursive: true, force: true });
});
test("Unicode, spaces and reserved characters survive list and DataNode redirect", async () => {
  const path = "/报告 空格 #?%&+.json";
  const list = await client.list("/", signal());
  assert.ok(list.some((item) => item.pathSuffix === path.slice(1)));
  assert.deepEqual(await client.read(path, 1024, signal()), files[path]);
  assert.equal(server.dataRequests.at(-1)?.path, path);
  assert.equal(server.requests.at(-1)?.user, "demo");
});
test("all reads use GET and encoded paths", async () => {
  const url = client.url("/a #?%&+/中文", "OPEN");
  assert.equal(
    url.pathname,
    "/webhdfs/v1/a%20%23%3F%25%26%2B/%E4%B8%AD%E6%96%87",
  );
  assert.equal(url.searchParams.get("op"), "OPEN");
});
test("empty and large directories", async () => {
  assert.equal((await client.list("/empty", signal())).length, 0);
  assert.equal((await client.list("/many", signal())).length, 19680);
});
test("bounded preview reads first bytes of large file", async () => {
  assert.equal((await client.read("/large.txt", 4096, signal())).length, 4096);
});
test("PDF is actual PDF bytes", async () => {
  assert.equal(
    (await client.read("/preview.pdf", 4096, signal()))
      .subarray(0, 5)
      .toString(),
    "%PDF-",
  );
});
test("HttpFS direct OPEN without a redirect", async () => {
  assert.equal(
    (await client.read("/direct.txt", 1024, signal())).toString(),
    "HttpFS direct content",
  );
});
test("stalled DataNode body reports a file-read timeout", async () => {
  await assert.rejects(
    client.read("/stalled-body", 1024, signal()),
    (e: HdfsError) => {
      assert.equal(e.code, "timeout");
      assert.equal(e.stage, "datanode");
      return true;
    },
  );
});
test("a complete preview prefix succeeds even when the server keeps the body open", async () => {
  assert.equal(
    (await client.read("/stalled-body", 6, signal())).toString(),
    "prefix",
  );
});
test("downloads are byte identical after redirect", async () => {
  const path = "/报告 空格 #?%&+.json",
    target = join(directory, "download.json");
  await client.download(path, target, files[path].length, signal());
  assert.deepEqual(await readFile(target), files[path]);
});
test("size mismatch preserves existing destination and clears partial file", async () => {
  const target = join(directory, "preserve");
  await writeFile(target, "original");
  await assert.rejects(
    client.download("/welcome.txt", target, 1, signal()),
    (e: HdfsError) => e.code === "changed",
  );
  assert.equal(await readFile(target, "utf8"), "original");
  assert.ok(!(await readdir(directory)).some((x) => x.endsWith(".part")));
});
test("cancel streaming download removes partial file", async () => {
  const controller = new AbortController();
  const work = client.download(
    "/slow.bin",
    join(directory, "cancelled"),
    files["/slow.bin"].length,
    controller.signal,
  );
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(work, (e: HdfsError) => e.code === "cancelled");
  assert.ok(!(await readdir(directory)).some((x) => x.includes("cancelled")));
});
test("a growing download is stopped before reading the rest of a slow stream", async () => {
  const started = Date.now();
  await assert.rejects(
    client.download("/slow.bin", join(directory, "growing"), 1, signal()),
    (e: HdfsError) => e.code === "changed",
  );
  assert.ok(
    Date.now() - started < 1500,
    "must not consume the full 2.5 second stream",
  );
  assert.ok(!(await readdir(directory)).some((x) => x.includes("growing")));
});
test("cancel pending metadata and retry successfully", async () => {
  const controller = new AbortController();
  const work = client.list("/slow-folder", controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(work, (e: HdfsError) => e.code === "cancelled");
  assert.ok((await client.list("/", signal())).length > 0);
});
for (const [path, expected] of [
  ["/timeout", "timeout"],
  ["/offline", "network"],
  ["/denied", "forbidden"],
  ["/unauthorized", "unauthorized"],
  ["/missing", "missing"],
  ["/malformed", "response"],
  ["/loop", "redirect"],
])
  test(path + " classified without server body leakage", async () => {
    await assert.rejects(client.list(path, signal()), (error: HdfsError) => {
      assert.equal(error.code, expected);
      assert.ok(!errorText(error, "en").includes("MUST NOT LEAK"));
      return true;
    });
  });
test("Basic credentials are never forwarded to DataNode", async () => {
  const basic = new Client(
    { ...connection, auth: "basic" },
    "sensitive-secret",
  );
  await basic.read("/welcome.txt", 10, signal());
  assert.match(server.requests.at(-1)?.authorization ?? "", /^Basic /);
  assert.equal(server.dataRequests.at(-1)?.authorization, undefined);
});
test("Bearer credentials are never forwarded to DataNode", async () => {
  const bearer = new Client(
    { ...connection, auth: "bearer" },
    "sensitive-secret",
  );
  await bearer.read("/welcome.txt", 10, signal());
  assert.equal(
    server.requests.at(-1)?.authorization,
    "Bearer sensitive-secret",
  );
  assert.equal(server.dataRequests.at(-1)?.authorization, undefined);
});
test("connection projection excludes credentials and unexpected properties", () => {
  const saved = validateConnection({
    ...connection,
    secret: "MUST NOT SAVE",
    password: "MUST NOT SAVE",
  } as Connection);
  assert.ok(!JSON.stringify(saved).includes("MUST NOT SAVE"));
});
test("invalid endpoints and auth config rejected", () => {
  for (const endpoint of [
    "file:///tmp",
    "https://user:secret@example.org",
    "http://example.org?token=x",
    "http://example.org#x",
  ])
    assert.throws(() => validateConnection({ ...connection, endpoint }));
  assert.throws(() => validateConnection({ ...connection, timeout: 0 }));
  assert.throws(() => validateConnection({ ...connection, username: "" }));
});
test("normalization and safe joining", () => {
  assert.equal(normalizePath("/a//b/../中文/"), "/a/中文");
  assert.equal(joinPath("/", "a #?.txt"), "/a #?.txt");
  assert.throws(() => joinPath("/", "../x"));
  assert.throws(() => normalizePath("relative"));
  assert.throws(() => normalizePath("/x\n"));
});
test("Windows download suggestions preserve Unicode and replace unsupported filenames", () => {
  assert.equal(downloadName("/报告 #?*:a.txt", "win32"), "报告 #___a.txt");
  assert.equal(downloadName("/CON.txt", "win32"), "_CON.txt");
  assert.equal(downloadName("/trailing. ", "win32"), "trailing");
  assert.equal(downloadName("/a\\b.txt", "win32"), "a_b.txt");
  assert.equal(downloadName("/报告 #?.txt", "darwin"), "报告 #?.txt");
});
test("preferences are validated and projected", () => {
  assert.deepEqual(validatePreferences(defaults), defaults);
  assert.throws(() =>
    validatePreferences({ ...defaults, mediaLimit: Infinity }),
  );
});
test("latest cancels old operation and rejects its stale result", () => {
  const latest = new Latest();
  const first = latest.next(),
    second = latest.next();
  assert.ok(first.signal.aborted);
  assert.equal(latest.isCurrent(first), false);
  assert.equal(latest.isCurrent(second), true);
  latest.cancel();
  assert.equal(latest.isCurrent(second), false);
});
test("gate limits concurrency and removes cancelled waiters", async () => {
  const gate = new Gate(2);
  let active = 0,
    maximum = 0;
  const action = async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
  };
  const jobs = Array.from({ length: 12 }, () => gate.run(signal(), action));
  const controller = new AbortController();
  const cancelled = gate.run(controller.signal, action);
  controller.abort();
  await assert.rejects(cancelled);
  await Promise.all(jobs);
  assert.equal(maximum, 2);
  await gate.run(signal(), action);
});
