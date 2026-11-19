// Opt-in, isolated soak test. No user connection or HDFS cluster is used.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "../src/client";
import { defaults, HdfsError } from "../src/model";
import { readPreview } from "../src/preview";
import { files, fixture } from "../test/fixture";
import { addStressFiles } from "../test/stress-fixture";

async function main() {
  addStressFiles();
  const server = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "hdfs-stress-"));
  const client = new Client({
    id: "stress",
    name: "Fictional stress fixture",
    endpoint: server.endpoint,
    root: "/",
    auth: "none",
    username: "",
    timeout: 10,
  });
  const signal = () => new AbortController().signal;
  const preferences = {
    ...defaults,
    textLimit: 4 * 1048576,
    mediaLimit: 50 * 1048576,
  };
  const textFiles = [
    "csv",
    "tsv",
    "jsonl",
    "json",
    "py",
    "sql",
    "ts",
    "log",
    "pretty.json",
    "long-line.txt",
    "empty.jsonl",
    "html",
  ].map((extension) =>
    extension.includes(".") ? `/stress-${extension}` : `/stress.${extension}`,
  );
  const hash = (data: Buffer) =>
    createHash("sha256").update(data).digest("hex");
  async function fileHash(path: string) {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    return digest.digest("hex");
  }
  async function cancelled(work: (signal: AbortSignal) => Promise<unknown>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30);
    try {
      await assert.rejects(
        work(controller.signal),
        (error: HdfsError) => error.code === "cancelled",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  const report: object[] = [];
  try {
    for (let round = 1; round <= 5; round++) {
      const start = performance.now();
      for (const path of textFiles) {
        const preview = await readPreview(client, path, preferences, signal());
        assert.equal(preview.type, "content");
        assert.equal(preview.kind, "text");
        const prefix = files[path].subarray(0, preferences.textLimit);
        const expected = new TextDecoder("utf-8", { fatal: true }).decode(
          prefix,
          { stream: prefix.length < files[path].length },
        );
        assert.equal(preview.data, expected);
        assert.equal(preview.bytesRead, prefix.length);
        assert.equal(preview.truncated, prefix.length < files[path].length);
      }
      for (const path of [
        "/stress-small.pdf",
        "/stress-pages.pdf",
        "/stress-large.pdf",
        "/stress-limit.pdf",
        "/stress-image.png",
      ]) {
        const preview = await readPreview(client, path, preferences, signal());
        assert.equal(preview.type, "content");
        assert.equal(
          hash(Buffer.from(preview.data!, "base64")),
          hash(files[path]),
        );
      }
      assert.equal(
        (await readPreview(client, "/stress-legacy.csv", preferences, signal()))
          .type,
        "encoding",
      );
      assert.equal(
        (
          await readPreview(
            client,
            "/stress-legacy.csv",
            preferences,
            signal(),
            "gbk",
          )
        ).data,
        "你好,1\n",
      );
      assert.equal(
        (await readPreview(client, "/stress-limit.pdf", defaults, signal()))
          .type,
        "limited",
      );
      for (let i = 0; i < 10; i++)
        await cancelled((s) =>
          readPreview(client, "/stress-slow.csv", preferences, s),
        );
      await cancelled((s) =>
        client.download(
          "/stress-slow.csv",
          join(directory, "cancelled.csv"),
          files["/stress-slow.csv"].length,
          s,
        ),
      );
      assert.deepEqual(await readdir(directory), []);
      for (const name of [
        "stress.csv",
        "stress.jsonl",
        "stress-download.bin",
      ]) {
        const path = "/" + name,
          destination = join(directory, name);
        let last = 0;
        await client.download(
          path,
          destination,
          files[path].length,
          signal(),
          (bytes) => {
            assert.ok(bytes >= last && bytes <= files[path].length);
            last = bytes;
          },
        );
        assert.equal(last, files[path].length);
        assert.equal(await fileHash(destination), hash(files[path]));
        await rm(destination);
      }
      assert.ok((await client.list("/", signal())).length > 0);
      global.gc?.();
      const sample = {
        round,
        elapsedMs: Math.round(performance.now() - start),
        memory: process.memoryUsage(),
        activeResources: process.getActiveResourcesInfo(),
      };
      report.push(sample);
      console.log(JSON.stringify(sample));
    }
    assert.ok(
      server.requests.every((request) =>
        ["OPEN", "GETFILESTATUS", "LISTSTATUS"].includes(request.op),
      ),
    );
    console.log(
      JSON.stringify({
        passed: true,
        rounds: report.length,
        completedPreviews: 95,
        cancelledPreviews: 50,
        cancellations: 55,
        verifiedDownloads: 15,
      }),
    );
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}
void main();
