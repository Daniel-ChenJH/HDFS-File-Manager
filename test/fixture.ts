import http from "node:http";
import { once } from "node:events";
import { Entry } from "../src/model";
export function pdfBytes(pages = 1, paddingBytes = 0): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const content =
    "BT /F1 24 Tf 40 210 Td (HDFS Explorer) Tj 0 -40 Td /F1 12 Tf (Read-only preview fixture) Tj ET";
  objects.push(
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  );
  if (pages > 1) {
    objects.splice(
      0,
      objects.length,
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages} >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    );
    for (let i = 0; i < pages; i++) {
      const landscape = i % 7 === 6;
      const height = landscape ? 450 : 800;
      const text = `BT /F1 24 Tf 40 ${height - 70} Td (HDFS Explorer - Page ${i + 1}) Tj 0 -40 Td /F1 12 Tf (Continuous scroll fixture) Tj ET`;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${landscape ? 800 : 600} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
        `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
      );
    }
  }
  if (paddingBytes) {
    objects.push(
      `<< /Length ${paddingBytes} >>\nstream\n${" ".repeat(paddingBytes)}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
export const files: Record<string, Buffer> = {
  "/encoding-ascii.txt": Buffer.from("name,value\nexample,42\n", "ascii"),
  "/encoding-latin1.csv": Buffer.from("name,value\nCafé,42\n", "latin1"),
  "/encoding-gbk.csv": Buffer.from([
    0x6e, 0x61, 0x6d, 0x65, 0x2c, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x0a, 0xd6,
    0xd0, 0xce, 0xc4, 0x2c, 0x34, 0x32, 0x0a,
  ]),
  "/encoding-utf16le.json": Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from('{"message":"中文示例"}\n', "utf16le"),
  ]),
  "/encoding-utf16be.tsv": Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("name\tvalue\n中文\t42\n", "utf16le"),
  ]).swap16(),
  "/encoding-utf16-no-bom.txt": Buffer.from("Example 中文\n", "utf16le"),
  "/welcome.txt": Buffer.from(
    "Welcome to HDFS Explorer.\nRead-only browsing.\n你好，HDFS。\n",
  ),
  "/报告 空格 #?%&+.json": Buffer.from(
    '{"city":"杭州","message":"spaces # ? % & + are preserved"}\n',
  ),
  "/preview.pdf": pdfBytes(),
  "/image.png": Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ZkAAAAASUVORK5CYII=",
    "base64",
  ),
  "/large.txt": Buffer.alloc(4 * 1024 * 1024, "x"),
  "/slow.bin": Buffer.alloc(2 * 1024 * 1024, 7),
  "/binary.bin": Buffer.from([0, 1, 2, 3]),
  "/nested/hello.txt": Buffer.from("Nested folder\n"),
};
export function entry(path: string, directory = false): Entry {
  return {
    pathSuffix: path.split("/").pop() ?? "",
    type: directory ? "DIRECTORY" : "FILE",
    length: files[path]?.length ?? 17,
    modificationTime: 1735689600000,
    owner: "demo",
    group: "readers",
    permission: directory ? "755" : "644",
  };
}
export async function fixture(port = 0) {
  const requests: {
    path: string;
    op: string;
    authorization?: string;
    user?: string;
    raw: string;
  }[] = [];
  const dataRequests: { authorization?: string; path: string }[] = [];
  const data = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const path = decodeURIComponent(url.pathname.replace("/webhdfs/v1", ""));
    dataRequests.push({ authorization: req.headers.authorization, path });
    if (path === "/stalled-body") {
      res.writeHead(200);
      res.write("prefix");
      return;
    }
    const bytes = files[path] ?? Buffer.from("fixture content\n");
    const limit = Number(url.searchParams.get("length")) || bytes.length;
    if (path === "/slow.bin" || path === "/stress-slow.csv") {
      res.writeHead(200);
      let offset = 0;
      const timer = setInterval(() => {
        if (offset >= Math.min(limit, bytes.length)) {
          clearInterval(timer);
          res.end();
        } else {
          res.write(bytes.subarray(offset, offset + 8192));
          offset += 8192;
        }
      }, 10);
      res.on("close", () => clearInterval(timer));
      return;
    }
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(bytes.subarray(0, limit));
  });
  data.listen(0, "127.0.0.1");
  await once(data, "listening");
  const dataPort = (data.address() as any).port;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const path =
      decodeURIComponent(url.pathname.replace("/webhdfs/v1", "")) || "/";
    const op = url.searchParams.get("op") ?? "";
    requests.push({
      path,
      op,
      authorization: req.headers.authorization,
      user: url.searchParams.get("user.name") ?? undefined,
      raw: req.url!,
    });
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (path === "/timeout") return;
    if (path === "/offline") {
      req.socket.destroy();
      return;
    }
    if (path === "/denied" || path === "/missing" || path === "/unauthorized") {
      res.writeHead(path === "/denied" ? 403 : path === "/missing" ? 404 : 401);
      res.end(
        path === "/denied"
          ? JSON.stringify({
              RemoteException: {
                exception: "AccessControlException",
                message: "private diagnostic MUST NOT LEAK",
              },
            })
          : "private diagnostic MUST NOT LEAK",
      );
      return;
    }
    if (path === "/loop") {
      res.writeHead(307, { location: req.url });
      res.end();
      return;
    }
    if (path === "/malformed") {
      res.end("<html>wrong service</html>");
      return;
    }
    const respond = () => {
      if (op === "OPEN" && path === "/direct.txt") {
        res.writeHead(200);
        res.end("HttpFS direct content");
        return;
      }
      if (op === "OPEN") {
        res.writeHead(307, {
          location: `http://127.0.0.1:${dataPort}${req.url}`,
        });
        res.end();
        return;
      }
      const directories = ["/", "/nested", "/empty", "/many", "/slow-folder"];
      res.setHeader("content-type", "application/json");
      if (op === "GETFILESTATUS") {
        res.end(
          JSON.stringify({
            FileStatus: entry(path, directories.includes(path)),
          }),
        );
        return;
      }
      if (op === "LISTSTATUS") {
        const items =
          path === "/empty"
            ? []
            : path === "/many"
              ? Array.from({ length: 19680 }, (_, i) => ({
                  ...entry("/file"),
                  pathSuffix: `example-${String(i).padStart(5, "0")}.txt`,
                }))
              : path === "/nested"
                ? [entry("/nested/hello.txt")]
                : [
                    ...["/nested", "/empty", "/many", "/slow-folder"].map((p) =>
                      entry(p, true),
                    ),
                    ...Object.keys(files)
                      .filter((p) => p.split("/").length === 2)
                      .map((p) => entry(p)),
                  ];
        res.end(JSON.stringify({ FileStatuses: { FileStatus: items } }));
        return;
      }
      res.writeHead(400);
      res.end();
    };
    if (path === "/slow-folder") {
      const timer = setTimeout(respond, 1500);
      res.on("close", () => clearTimeout(timer));
    } else respond();
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    endpoint: `http://127.0.0.1:${(server.address() as any).port}/webhdfs/v1`,
    requests,
    dataRequests,
    close: async () => {
      server.closeAllConnections();
      data.closeAllConnections();
      await Promise.all([
        new Promise<void>((r) => server.close(() => r())),
        new Promise<void>((r) => data.close(() => r())),
      ]);
    },
  };
}
