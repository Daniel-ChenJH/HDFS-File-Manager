import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run outside the test runner: an HTTP parser assertion is an uncaught socket
// event, so assert.rejects in the parent would not safely exercise the regression.
test("bundled transport survives peer FIN under backpressure and rejects truncated bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hdfs-transport-"));
  const target = join(directory, "check.cjs");
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          const { Client } = require('undici');
          const { createServer } = require('node:net');
          const { once } = require('node:events');
          const assert = require('node:assert/strict');
          (async () => {
            const body = Buffer.alloc(64 * 1024, 97);
            for (const mode of ['length', 'eof', 'short-length', 'short-chunked']) {
              const server = createServer(socket => socket.once('data', () => {
                const framing = mode === 'eof' ? '' : mode === 'short-chunked'
                  ? 'Transfer-Encoding: chunked\\r\\n'
                  : 'Content-Length: ' + (body.length + (mode === 'short-length' ? 1 : 0)) + '\\r\\n';
                const payload = mode === 'short-chunked' ? Buffer.concat([Buffer.from(body.length.toString(16) + '\\r\\n'), body]) : body;
                socket.end(Buffer.concat([Buffer.from('HTTP/1.1 200 OK\\r\\nConnection: close\\r\\n' + framing + '\\r\\n'), payload]));
              }));
              server.listen(0, '127.0.0.1'); await once(server, 'listening');
              const client = new Client('http://127.0.0.1:' + server.address().port, { pipelining: 0 });
              try {
                const response = await client.request({ method: 'GET', path: '/' });
                response.body.on('error', () => {});
                await new Promise(resolve => setTimeout(resolve, 100));
                const consume = async () => {
                  const chunks = [];
                  for await (const chunk of response.body) chunks.push(chunk);
                  return Buffer.concat(chunks);
                };
                if (mode.startsWith('short')) await assert.rejects(consume());
                else assert.deepEqual(await consume(), body);
              } finally { await client.destroy(); await new Promise(resolve => server.close(resolve)); }
            }
            console.log('four framing cases passed');
          })().catch(error => { console.error(error); process.exitCode = 1; });
        `,
      },
      bundle: true,
      platform: "node",
      outfile: target,
    });
    const result = await promisify(execFile)(process.execPath, [target], {
      timeout: 10000,
    });
    assert.match(result.stdout, /four framing cases passed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
