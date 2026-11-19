// Fictional production-shaped data. This module is used only by development
// fixture servers and tests, never shipped in the extension.
import { deflateSync } from "node:zlib";
import { files, pdfBytes } from "./fixture";

function repeated(line: string, bytes: number) {
  return Buffer.from(line.repeat(Math.ceil(bytes / Buffer.byteLength(line))));
}

function png(width: number, height: number) {
  const crc = (data: Buffer) => {
    let value = 0xffffffff;
    for (const byte of data) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++)
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, body: Buffer) => {
    const data = Buffer.concat([Buffer.from(type), body]);
    const result = Buffer.alloc(data.length + 8);
    result.writeUInt32BE(body.length);
    data.copy(result, 4);
    result.writeUInt32BE(crc(data), data.length + 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, 180);
  for (let y = 0; y < height; y++) pixels[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function addStressFiles() {
  const MiB = 1048576;
  files["/stress.csv"] = Buffer.concat([
    Buffer.from("id,name,note,value\r\n"),
    repeated(
      '9007199254740993,示例企业,"comma, quote "" and\nsecond line",12.50\r\n',
      6 * MiB,
    ),
  ]);
  files["/stress.tsv"] = repeated(
    "9007199254740993\t示例企业\t\t-12.50\t2025-01-02T03:04:05Z\r\n",
    6 * MiB,
  );
  files["/stress.jsonl"] = repeated(
    '{"id":9007199254740993,"text":"中文 # % & +","value":1.25,"empty":null}\n',
    6 * MiB,
  );
  files["/stress.json"] = Buffer.from(
    JSON.stringify({
      rows: Array.from({ length: 50000 }, (_, id) => ({
        id,
        name: "示例企业",
        value: 12.5,
        tags: ["a", "b"],
      })),
    }),
  );
  files["/stress-pretty.json"] = Buffer.from(
    JSON.stringify(
      {
        rows: Array.from({ length: 20000 }, (_, id) => ({
          id,
          name: "示例企业",
          value: 12.5,
        })),
      },
      null,
      2,
    ),
  );
  files["/stress.py"] = repeated(
    '# 示例代码；预览不会执行\ndef summarize(rows):\n    return sum(row["value"] for row in rows)\n\n',
    3 * MiB,
  );
  files["/stress.sql"] = repeated(
    "-- Example query, shown as source\nSELECT region, SUM(amount) FROM demo_events GROUP BY region;\n",
    3 * MiB,
  );
  files["/stress.ts"] = repeated(
    'export const sample = { id: "9007199254740993", label: "中文", amount: 12.5 };\n',
    3 * MiB,
  );
  files["/stress.log"] = repeated(
    "2025-01-02T03:04:05Z INFO sample event complete\n",
    6 * MiB,
  );
  files["/stress-slow.csv"] = repeated("1,example,12.50\r\n", 32 * MiB);
  files["/stress-long-line.txt"] = Buffer.alloc(8 * MiB, "x");
  files["/stress-empty.jsonl"] = Buffer.alloc(0);
  files["/stress.html"] = Buffer.from(
    '<!doctype html><script>document.body.dataset.executed="unsafe"</script><p>Source only</p>',
  );
  files["/stress-legacy.csv"] = Buffer.from([
    0xc4, 0xe3, 0xba, 0xc3, 0x2c, 0x31, 0x0a,
  ]);
  files["/stress-small.pdf"] = pdfBytes(40);
  files["/stress-pages.pdf"] = pdfBytes(600);
  files["/stress-large.pdf"] = pdfBytes(40, 18 * MiB);
  files["/stress-limit.pdf"] = pdfBytes(40, 48 * MiB);
  files["/stress-broken.pdf"] = Buffer.from("Invalid PDF fixture");
  files["/stress-image.png"] = png(5000, 4000);
  files["/stress-download.bin"] = Buffer.alloc(96 * MiB, 0x61);
}
