import { homedir } from "node:os";
import * as vscode from "vscode";
import { lstat, open, opendir, mkdir, realpath, stat } from "node:fs/promises";
import type { Dir } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { HdfsError } from "./model";
import { chunkSize } from "./transfer";

// Paths are authorized by a picker, then addressed through opaque grants.
export class FileAccess {
  private lastSource = "";
  private grants = new Map<string, { path: string; write: boolean }>();
  private dirs = new Map<string, Dir>();
  async reply(message: any) {
    try {
      return { ok: true, value: await this.handle(message) };
    } catch (error) {
      const codes: Record<string, string> = {
        ENOENT: "sourceMissing",
        EACCES: "localPermission",
        EPERM: "localPermission",
        ENOSPC: "diskSpace",
        EDQUOT: "diskSpace",
      };
      return {
        ok: false,
        code:
          error instanceof HdfsError
            ? error.code
            : codes[(error as any)?.code] || "unknown",
      };
    }
  }
  async handle(m: any): Promise<any> {
    if (m.op === "pick") {
      const uris = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(m.folder || this.lastSource || homedir()),
        canSelectFiles: m.kind === "files",
        canSelectFolders: m.kind !== "files",
        canSelectMany: m.kind !== "destination",
      });
      if (uris && uris.length > 10000) throw new HdfsError("selectionLimit");
      const result = [];
      for (const uri of uris || []) {
        if (uri.scheme !== "file") throw new HdfsError("destinationHost");
        this.lastSource = dirname(uri.fsPath);
        const info = await lstat(uri.fsPath);
        if (info.isSymbolicLink()) throw new HdfsError("sourceLink");
        if (!info.isFile() && !info.isDirectory())
          throw new HdfsError("filename");
        const id = randomUUID();
        this.grants.set(id, {
          path: await realpath(uri.fsPath),
          write: m.kind === "destination",
        });
        result.push({
          id,
          name: basename(uri.fsPath),
          path: await realpath(uri.fsPath),
          type: info.isDirectory() ? "DIRECTORY" : "FILE",
          size: info.size,
        });
      }
      return result;
    }
    if (m.op === "closeDir") {
      const d = this.dirs.get(m.cursor);
      this.dirs.delete(m.cursor);
      await d?.close().catch(() => {});
      return;
    }
    if (m.op === "release") {
      this.grants.delete(m.id);
      return;
    }
    const grant = this.grants.get(m.id);
    if (!grant) throw new HdfsError("missing");
    const rel = m.relative || "";
    if (
      typeof rel !== "string" ||
      isAbsolute(rel) ||
      rel.split(/[\\/]/).some((p: string) => p === "..") ||
      rel.includes("\0")
    )
      throw new HdfsError("filename");
    const path = join(grant.path, ...rel.split("/"));
    // Reject symlink traversal, including a replaced grant root.
    const check = m.op === "ensure" ? dirname(path) : path;
    let ancestor = check;
    while (true) {
      try {
        const actual = await realpath(ancestor);
        if (actual !== ancestor) throw new HdfsError("filename");
        break;
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
        const next = dirname(ancestor);
        if (next === ancestor) throw e;
        ancestor = next;
      }
    }
    const within = relative(grant.path, path);
    if (within.startsWith(".." + sep) || isAbsolute(within))
      throw new HdfsError("filename");
    if (m.op === "ensure") {
      if (!grant.write) throw new HdfsError("readOnly");
      await mkdir(path, { recursive: true });
      return path;
    }
    if (m.op === "list") {
      if (this.dirs.size >= 256 && !m.cursor) throw new HdfsError("busy");
      let cursor = m.cursor,
        d = this.dirs.get(cursor);
      if (!d) {
        cursor = randomUUID();
        d = await opendir(path);
        this.dirs.set(cursor, d);
      }
      const items = [];
      let ended = false;
      while (items.length < 128) {
        const entry = await d.read();
        if (!entry) {
          ended = true;
          break;
        }
        if (
          entry.isSymbolicLink() ||
          (!entry.isFile() && !entry.isDirectory())
        ) {
          items.push({ name: entry.name, type: "SYMLINK" });
          continue;
        }
        const info = await lstat(join(path, entry.name));
        items.push({
          name: entry.name,
          type: info.isDirectory() ? "DIRECTORY" : "FILE",
          size: info.size,
          stamp: `${info.size}:${info.mtimeMs}`,
        });
      }
      if (ended) {
        this.dirs.delete(cursor);
        await d.close();
      }
      return { items, cursor: ended ? undefined : cursor };
    }
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new HdfsError("filename");
    const stamp = `${info.size}:${info.mtimeMs}`;
    if (m.op === "stat")
      return {
        size: info.size,
        stamp,
        type: info.isDirectory() ? "DIRECTORY" : "FILE",
      };
    if (m.op === "read") {
      if (
        !info.isFile() ||
        m.stamp !== stamp ||
        !Number.isSafeInteger(m.offset) ||
        m.offset < 0 ||
        m.offset > info.size
      )
        throw new HdfsError("changed");
      const f = await open(path, "r");
      try {
        const buffer = Buffer.alloc(Math.min(chunkSize, info.size - m.offset));
        const { bytesRead } = await f.read(buffer, 0, buffer.length, m.offset);
        const after = await f.stat();
        if (`${after.size}:${after.mtimeMs}` !== stamp)
          throw new HdfsError("changed");
        return buffer.subarray(0, bytesRead).toString("base64");
      } finally {
        await f.close();
      }
    }
    throw new HdfsError("unknown");
  }
  async dispose() {
    for (const d of this.dirs.values()) await d.close().catch(() => {});
    this.dirs.clear();
    this.grants.clear();
  }
}
