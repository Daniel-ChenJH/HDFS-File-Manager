import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../src/client";
import { writableFixture } from "./write-fixture";
import { validateConnection } from "../src/model";
const sig = () => new AbortController().signal;
test("writes: encoded upload, multi-batch enumeration, rename and recursive deletion preserve bytes", async () => {
  const f = await writableFixture();
  const c = new Client({
    id: "test",
    name: "Test",
    endpoint: f.endpoint,
    root: "/",
    auth: "none",
    username: "",
    timeout: 2,
  });
  try {
    await c.mkdir("/isolated/目录", sig());
    for (let i = 0; i < 5; i++) {
      const bytes = Buffer.from(`中文 #?%& ${i}\0binary`);
      await c.upload(
        `/isolated/目录/报告 #?%& ${i}.dat`,
        bytes.length,
        (async function* () {
          yield bytes.subarray(0, 3);
          yield bytes.subarray(3);
        })(),
        sig(),
        () => {},
      );
      assert.deepEqual(f.files.get(`/isolated/目录/报告 #?%& ${i}.dat`), bytes);
    }
    const result = [];
    for await (const entry of c.iterate("/isolated/目录", sig()))
      result.push(entry);
    assert.equal(result.length, 5);
    assert.equal(f.calls.filter((r) => r.op === "LISTSTATUS_BATCH").length, 3);
    await c.rename("/isolated/目录", "/isolated/renamed", sig());
    assert.equal(f.files.size, 5);
    await assert.rejects(
      c.rename("/isolated/renamed", "/isolated/renamed", sig()),
    );
    await c.remove("/isolated/renamed", sig(), true);
    assert.equal(f.files.size, 0);
  } finally {
    await f.close();
  }
});
test("read-only connections reject every mutation before sending a request, while missing flag defaults writable", async () => {
  const f = await writableFixture();
  const config = {
    id: "t",
    name: "Test",
    endpoint: f.endpoint,
    root: "/",
    auth: "none" as const,
    username: "",
    timeout: 2,
  };
  const c = new Client({ ...config, readOnly: true });
  try {
    for (const action of [
      () => c.mkdir("/new", sig()),
      () => c.remove("/file", sig()),
      () => c.rename("/file", "/new", sig()),
      () => c.upload("/file", 0, (async function* () {})(), sig(), () => {}),
    ])
      await assert.rejects(action(), (e: any) => e.code === "readOnly");
    assert.equal(f.calls.length, 0);
    assert.equal(validateConnection(config).readOnly, false);
  } finally {
    await f.close();
  }
});

test("write denial distinguishes HDFS path permissions from an unrecognized gateway rejection", async () => {
  const f = await writableFixture();
  const c = new Client({
    id: "t",
    name: "Test",
    endpoint: f.endpoint,
    root: "/",
    auth: "none",
    username: "",
    timeout: 2,
  });
  try {
    await assert.rejects(
      c.mkdir("/denied/new", sig()),
      (e: any) => e.code === "forbidden",
    );
    await assert.rejects(
      c.mkdir("/gateway-denied/new", sig()),
      (e: any) => e.code === "requestDenied",
    );
  } finally {
    await f.close();
  }
});

test("writes stay direct when an editor replaces the high-level HTTP request function", async () => {
  const { build } = await import("esbuild"),
    { createRequire } = await import("node:module"),
    { join } = await import("node:path"),
    http = await import("node:http");
  const f = await writableFixture();
  const code = (
    await build({
      entryPoints: ["src/client.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
    })
  ).outputFiles[0].text;
  const require = createRequire(join(process.cwd(), "package.json")),
    m: any = { exports: {} };
  const patched = {
    ...http,
    request: () => {
      throw Error("editor proxy override");
    },
    get: () => {
      throw Error("editor proxy override");
    },
  };
  new Function("require", "module", "exports", code)(
    (id: string) => (id === "node:http" ? patched : require(id)),
    m,
    m.exports,
  );
  const c = new m.exports.Client({
    id: "t",
    name: "Test",
    endpoint: f.endpoint,
    root: "/",
    auth: "none",
    username: "",
    timeout: 2,
  });
  try {
    await c.mkdir("/direct", sig());
    const bytes = Buffer.from("direct file");
    await c.upload(
      "/direct/file.txt",
      bytes.length,
      (async function* () {
        yield bytes;
      })(),
      sig(),
      () => {},
    );
    assert.deepEqual(f.files.get("/direct/file.txt"), bytes);
    await c.remove("/direct", sig(), true);
    assert.ok(!f.dirs.has("/direct"));
  } finally {
    await f.close();
  }
});
