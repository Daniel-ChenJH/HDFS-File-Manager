import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Browser source is bundled without TS declarations.
import { decodeBase64 } from "../web/bytes.js";

test("media decoding preserves every byte across chunk and padding boundaries", async () => {
  for (const length of [0, 1, 2, 3, 49151, 49152, 49153, 2 * 1048576 + 5]) {
    const input = Buffer.alloc(length);
    for (let i = 0; i < input.length; i++) input[i] = i % 256;
    const bytes = await decodeBase64(input.toString("base64"));
    assert.deepEqual(Buffer.from(bytes), input);
  }
});

test("large media decoding yields to cancellation before returning its buffer", async () => {
  let active = true;
  const encoded = Buffer.alloc(4 * 1048576).toString("base64");
  setTimeout(() => {
    active = false;
  }, 0);
  assert.equal(await decodeBase64(encoded, () => active), undefined);
  assert.equal(await decodeBase64("AA==", () => false), undefined);
});

test("decoding completes without chained timers in background tabs", async (t) => {
  t.mock.method(globalThis, "setTimeout", () => {
    throw new Error("Timer queue must not be used for decoding");
  });
  const input = Buffer.alloc(3 * 1048576, 42);
  assert.deepEqual(
    Buffer.from(await decodeBase64(input.toString("base64"))),
    input,
  );
});
