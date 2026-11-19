import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
let format: any;
before(async () => {
  const code = (
    await build({
      entryPoints: ["web/json-format.js"],
      bundle: true,
      write: false,
      format: "cjs",
    })
  ).outputFiles[0].text;
  const m = { exports: {} };
  new Function("module", "exports", code)(m, m.exports);
  format = (m.exports as any).formatJson;
});
test("JSON formatting preserves precision, duplicate keys, escaped text and key order", async () => {
  const value =
    '{"id":900719925474099312345,"id":1.2300,"z":[true,null,{"x":"a\\n\\\"b"}],"empty":{}}';
  const result = await format(value);
  assert.ok(result.includes("900719925474099312345"));
  assert.ok(result.includes("1.2300"));
  assert.equal((result.match(/"id"/g) || []).length, 2);
  assert.deepEqual(JSON.parse(result), JSON.parse(value));
});
test("invalid and deeply nested JSON is rejected; large format work cancels", async () => {
  for (const s of [
    "",
    '{"a":}',
    "[1,]",
    '{"a" 1}',
    "true false",
    "[01]",
    "{,}",
    "[".repeat(150) + "0" + "]".repeat(150),
  ])
    await assert.rejects(format(s));
  await assert.rejects(
    format("[" + "0,".repeat(50000) + "0]", () => true),
    /cancelled/,
  );
});
