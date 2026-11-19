import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("source grants enforce selected roots, reject symlinks and enumerate bounded pages", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "hdfs-source-grants-")),
  );
  let selected = join(root, "source");
  await mkdir(selected);
  for (let i = 0; i < 260; i++)
    await writeFile(join(selected, `${i}.txt`), "example");
  await symlink(root, join(selected, "escape"), "junction");
  const mock = {
    window: {
      showOpenDialog: async () => [{ scheme: "file", fsPath: selected }],
    },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
  };
  const code = (
    await build({
      entryPoints: ["src/file-access.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      external: ["vscode"],
    })
  ).outputFiles[0].text;
  const m: any = { exports: {} };
  const require = createRequire(join(process.cwd(), "package.json"));
  new Function("require", "module", "exports", code)(
    (id: string) => (id === "vscode" ? mock : require(id)),
    m,
    m.exports,
  );
  const access = new m.exports.FileAccess();
  try {
    const [grant] = await access.handle({ op: "pick", kind: "folder" });
    for (const relative of ["../outside", "/outside", "escape/anything"])
      await assert.rejects(
        access.handle({ op: "stat", id: grant.id, relative }),
      );
    await assert.rejects(
      access.handle({ op: "ensure", id: grant.id, relative: "new" }),
      (e: any) => e.code === "readOnly",
    );
    let cursor,
      count = 0,
      symlinks = 0;
    do {
      const page: any = await access.handle({
        op: "list",
        id: grant.id,
        cursor,
      });
      assert.ok(page.items.length <= 128);
      count += page.items.length;
      symlinks += page.items.filter((i: any) => i.type === "SYMLINK").length;
      cursor = page.cursor;
    } while (cursor);
    assert.equal(count, 261);
    assert.equal(symlinks, 1);
    const info = await access.handle({
      op: "stat",
      id: grant.id,
      relative: "0.txt",
    });
    assert.equal(
      Buffer.from(
        await access.handle({
          op: "read",
          id: grant.id,
          relative: "0.txt",
          stamp: info.stamp,
          offset: 0,
        }),
        "base64",
      ).toString(),
      "example",
    );
    await writeFile(join(selected, "0.txt"), "changed");
    await assert.rejects(
      access.handle({
        op: "read",
        id: grant.id,
        relative: "0.txt",
        stamp: info.stamp,
        offset: 0,
      }),
      (e: any) => e.code === "changed",
    );
    const reply = await access.reply({
      op: "read",
      id: grant.id,
      relative: "0.txt",
      stamp: info.stamp,
      offset: 0,
    });
    assert.equal(reply.ok, false);
    assert.equal(reply.code, "changed");
    assert.ok(!JSON.stringify(reply).includes(root));
    await access.handle({ op: "release", id: grant.id });
    await assert.rejects(
      access.handle({ op: "stat", id: grant.id }),
      (e: any) => e.code === "missing",
    );
  } finally {
    await access.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
