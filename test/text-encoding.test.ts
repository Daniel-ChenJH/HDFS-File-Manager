import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeText } from "../src/text-encoding";

test("automatic text decoding recognizes UTF-8, ASCII and UTF-16 BOMs", () => {
  for (const text of ["plain ASCII\n", "中文，空格 & Unicode 😀"]) {
    assert.equal(decodeText(Buffer.from(text), "auto", false).text, text);
    const little = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(text, "utf16le"),
    ]);
    assert.equal(decodeText(little, "auto", false).text, text);
    const big = Buffer.from(little).swap16();
    assert.equal(decodeText(big, "auto", false).text, text);
  }
});

test("explicit encodings preserve bytes and never substitute Windows-1252 for Latin-1", () => {
  assert.equal(
    decodeText(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), "gbk", false).text,
    "中文",
  );
  assert.equal(
    decodeText(Buffer.from("Café", "latin1"), "iso-8859-1", false).text,
    "Café",
  );
  assert.equal(
    decodeText(Buffer.from([0x80, 0x91, 0xa3]), "iso-8859-1", false).text,
    "\u0080\u0091£",
  );
  assert.equal(
    decodeText(Buffer.from("ASCII only"), "ascii", false).text,
    "ASCII only",
  );
  assert.equal(
    decodeText(Buffer.from([0xe9]), "ascii", false).type,
    "encoding",
  );
  const manual = decodeText(Buffer.from("name,value"), "gbk", false);
  assert.equal(manual.encoding, "gbk");
  assert.equal(manual.automaticEncoding, "utf-8");
  const little = Buffer.from("name\n中文", "utf16le");
  assert.equal(decodeText(little, "utf-16le", false).text, "name\n中文");
  assert.equal(
    decodeText(Buffer.from(little).swap16(), "utf-16be", false).text,
    "name\n中文",
  );
  assert.equal(decodeText(little, "auto", false).type, "encoding");
  // A wrong manual choice must keep the encoding selector available.
  assert.equal(decodeText(little, "utf-8", false).type, "encoding");
  assert.equal(decodeText(little, "ascii", false).type, "encoding");
});

test("bounded previews omit partial characters but reject malformed complete data", () => {
  for (const [encoding, bytes, text] of [
    ["utf-8", Buffer.from([0x41, 0xe4, 0xb8]), "A"],
    ["gbk", Buffer.from([0x41, 0xd6]), "A"],
    ["utf-16le", Buffer.from([0x41, 0, 0x2d]), "A"],
    ["utf-16be", Buffer.from([0, 0x41, 0x4e]), "A"],
  ] as const) {
    assert.equal(decodeText(bytes, encoding, true).text, text);
    assert.equal(decodeText(bytes, encoding, false).type, "encoding");
  }
  assert.equal(
    decodeText(Buffer.from([0x50, 0x4b, 3, 4, 0, 0]), "auto", false).type,
    "binary",
  );
  assert.equal(
    decodeText(Buffer.from("safe"), "unknown-label", false).encoding,
    "utf-8",
  );
});
