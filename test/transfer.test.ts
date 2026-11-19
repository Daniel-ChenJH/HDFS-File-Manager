import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { TransferService, chunkSize } from "../src/transfer";
import { Client } from "../src/client";
import { downloadName } from "../src/model";
import { fixture, files } from "./fixture";

async function receiver(idleMs = 120000) {
  const folder = await mkdtemp(join(tmpdir(), "hdfs-transfer-"));
  const cancellations: (() => void)[] = [];
  let completed = 0;
  const service = new TransferService(
    {
      folder: () => folder,
      remember: async () => {},
      choose: async () => folder,
      progress: (_path, _size, _language, cancel) => {
        cancellations.push(cancel);
        return {
          update() {},
          close() {
            completed++;
          },
        };
      },
    },
    idleMs,
  );
  const call = async (message: any) => {
    const result = await service.handle(JSON.parse(JSON.stringify(message)));
    if (!result.ok) throw new Error(result.code);
    return result.value;
  };
  const begin = async (name: string, size: number) => {
    const prepared = await call({ op: "prepare", folder, name });
    return call({ op: "begin", folder, name, size, stamp: prepared.stamp });
  };
  return {
    folder,
    service,
    call,
    begin,
    cancellations,
    completed: () => completed,
    async close() {
      await service.dispose();
      await rm(folder, { recursive: true, force: true });
    },
  };
}
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

test("cross-host JSON chunks preserve redirected bytes, Unicode names, and the original until commit", async () => {
  const r = await receiver(),
    f = await fixture();
  const path = "/报告 空格 #?%&+.json",
    name = downloadName(path),
    previous = Buffer.from("existing local file");
  try {
    await writeFile(join(r.folder, name), previous);
    const { id } = await r.begin(name, files[path].length);
    const client = new Client({
      id: "demo",
      name: "demo",
      endpoint: f.endpoint,
      auth: "none",
      root: "/",
      username: "",
      timeout: 2,
    });
    const digest = await client.streamDownload(
      path,
      files[path].length,
      new AbortController().signal,
      async (data, offset) => {
        assert.ok(data.length <= chunkSize);
        assert.deepEqual(await readFile(join(r.folder, name)), previous);
        await r.call({
          op: "write",
          id,
          offset,
          data: data.toString("base64"),
        });
      },
    );
    await r.call({ op: "commit", id, sha256: digest });
    assert.deepEqual(await readFile(join(r.folder, name)), files[path]);
    assert.equal((await readdir(r.folder)).length, 1);
    assert.ok(f.dataRequests.length > 0);
  } finally {
    await r.close();
    await f.close();
  }
});

test("cancel, invalid chunk offset, wrong hash, and idle disconnect remove partial files and preserve originals", async () => {
  for (const mode of ["cancel", "offset", "digest", "disconnect"]) {
    const r = await receiver(mode === "disconnect" ? 25 : 120000),
      name = "existing.txt",
      bytes = Buffer.from("new content");
    try {
      await writeFile(join(r.folder, name), "original");
      const { id } = await r.begin(name, bytes.length);
      if (mode === "offset")
        await assert.rejects(
          r.call({
            op: "write",
            id,
            offset: 2,
            data: bytes.toString("base64"),
          }),
          /changed/,
        );
      else {
        await r.call({
          op: "write",
          id,
          offset: 0,
          data: bytes.toString("base64"),
        });
        if (mode === "cancel") {
          r.cancellations[0]();
          await r.call({ op: "abort", id });
        }
        if (mode === "digest")
          await assert.rejects(
            r.call({ op: "commit", id, sha256: "wrong" }),
            /changed/,
          );
        if (mode === "disconnect")
          await new Promise((resolve) => setTimeout(resolve, 80));
      }
      assert.equal(await readFile(join(r.folder, name), "utf8"), "original");
      assert.deepEqual(await readdir(r.folder), [name]);
    } finally {
      await r.close();
    }
  }
});

test("destinations are locked; files created or changed after confirmation are preserved", async () => {
  const r = await receiver();
  try {
    const { id } = await r.begin("race.txt", 0);
    await assert.rejects(r.begin("race.txt", 0), /destinationBusy/);
    await writeFile(join(r.folder, "race.txt"), "created while downloading");
    await assert.rejects(
      r.call({ op: "commit", id, sha256: hash(Buffer.alloc(0)) }),
      /destinationChanged/,
    );
    assert.equal(
      await readFile(join(r.folder, "race.txt"), "utf8"),
      "created while downloading",
    );
    assert.deepEqual(await readdir(r.folder), ["race.txt"]);
    const prepared = await r.call({
      op: "prepare",
      folder: r.folder,
      name: "race.txt",
    });
    await writeFile(join(r.folder, "race.txt"), "modified after prompt");
    await assert.rejects(
      r.call({
        op: "begin",
        folder: r.folder,
        name: "race.txt",
        stamp: prepared.stamp,
        size: 0,
      }),
      /destinationChanged/,
    );
  } finally {
    await r.close();
  }
});

test("bad folders and filenames are rejected before writing, empty files commit", async () => {
  const r = await receiver();
  try {
    for (const name of ["", "../escape", ".", "..", "null\0byte"])
      await assert.rejects(r.begin(name, 0));
    await assert.rejects(
      r.call({ op: "prepare", folder: "relative", name: "safe" }),
      /destination/,
    );
    await assert.rejects(
      r.call({
        op: "prepare",
        folder: join(r.folder, "missing"),
        name: "safe",
      }),
    );
    const { id } = await r.begin("empty.txt", 0);
    await r.call({ op: "commit", id, sha256: hash(Buffer.alloc(0)) });
    assert.equal((await readFile(join(r.folder, "empty.txt"))).length, 0);
  } finally {
    await r.close();
  }
});

test("large downloads await each receiver write with bounded chunks; cancelled streams stop", async () => {
  const r = await receiver(),
    f = await fixture();
  const path = "/transfer-large.bin",
    bytes = Buffer.alloc(16 * 1048576 + 53, 71);
  files[path] = bytes;
  try {
    const client = new Client({
      id: "demo",
      name: "demo",
      endpoint: f.endpoint,
      auth: "none",
      root: "/",
      username: "",
      timeout: 2,
    });
    const { id } = await r.begin("large.bin", bytes.length);
    let inFlight = 0,
      writes = 0;
    const digest = await client.streamDownload(
      path,
      bytes.length,
      new AbortController().signal,
      async (data, offset) => {
        assert.equal(++inFlight, 1);
        assert.ok(data.length <= chunkSize);
        writes++;
        await new Promise((resolve) => setTimeout(resolve, 2));
        await r.call({
          op: "write",
          id,
          offset,
          data: data.toString("base64"),
        });
        inFlight--;
      },
    );
    await r.call({ op: "commit", id, sha256: digest });
    assert.equal(writes, 17);
    assert.equal(
      hash(await readFile(join(r.folder, "large.bin"))),
      hash(bytes),
    );
    const controller = new AbortController();
    let count = 0;
    await assert.rejects(
      client.streamDownload(path, bytes.length, controller.signal, async () => {
        count++;
        controller.abort();
      }),
      /cancelled/,
    );
    assert.equal(count, 1);
  } finally {
    delete files[path];
    await r.close();
    await f.close();
  }
});
