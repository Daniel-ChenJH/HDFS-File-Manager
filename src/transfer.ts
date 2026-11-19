import { open, stat, lstat, rename, link, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { downloadName, HdfsError } from "./model";

export const transferCommand = "_hdfsFileManager.localTransfer";
export const chunkSize = 1024 * 1024;
export type TransferReply =
  | { ok: true; value: any }
  | { ok: false; code: string };
export interface TransferHost {
  cancelled?(id: string): void;
  folder(): string;
  remember(folder: string): Promise<void>;
  choose(folder: string): Promise<string | undefined>;
  progress(
    path: string,
    size: number,
    language: string,
    cancel: () => void,
    quiet?: boolean,
  ): {
    update(bytes: number): void;
    close(): void;
  };
}
type Session = {
  file: FileHandle;
  temporary: string;
  path: string;
  key: string;
  stamp: string | null;
  size: number;
  bytes: number;
  hash: ReturnType<typeof createHash>;
  cancelled: boolean;
  tail: Promise<unknown>;
  timer?: NodeJS.Timeout;
  progress: ReturnType<TransferHost["progress"]>;
};

// Each receiver owns its filesystem. Only bounded byte chunks cross hosts.
export class TransferService {
  private sessions = new Map<string, Session>();
  private targets = new Set<string>();
  constructor(
    private host: TransferHost,
    private idleMs = 120_000,
  ) {}
  private folder(value: unknown): string {
    if (typeof value !== "string" || value.includes("\0"))
      throw new HdfsError("destination");
    const expanded =
      value === "~"
        ? homedir()
        : value.startsWith("~/")
          ? join(homedir(), value.slice(2))
          : value;
    if (!isAbsolute(expanded)) throw new HdfsError("destination");
    return resolve(expanded);
  }
  private async stamp(path: string): Promise<string | null> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new HdfsError("save");
      return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  private async prepare(message: any) {
    const folder = this.folder(message.folder);
    const name = message.name;
    if (
      typeof name !== "string" ||
      !name ||
      name === "." ||
      name === ".." ||
      name.includes("\0") ||
      name.includes("/") ||
      basename(name) !== name ||
      downloadName("/" + name) !== name
    )
      throw new HdfsError("filename");
    try {
      if (!(await stat(folder)).isDirectory())
        throw new HdfsError("destination");
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw new HdfsError("destination");
      throw error;
    }
    const path = join(folder, name);
    return { folder, path, stamp: await this.stamp(path) };
  }
  private touch(id: string, session: Session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => void this.abort(id), this.idleMs);
    session.timer.unref();
  }
  private async cleanup(id: string, session: Session) {
    clearTimeout(session.timer);
    await session.file.close().catch(() => {});
    await unlink(session.temporary).catch(() => {});
    session.progress.close();
    this.targets.delete(session.key);
    this.sessions.delete(id);
  }
  private async abort(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.cancelled = true;
    await session.tail.catch(() => {});
    await this.cleanup(id, session);
  }
  async handle(message: any): Promise<TransferReply> {
    try {
      return { ok: true, value: await this.dispatch(message) };
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof HdfsError
            ? error.code
            : ["ENOSPC", "EDQUOT"].includes((error as any)?.code)
              ? "diskSpace"
              : "save",
      };
    }
  }
  private async dispatch(message: any): Promise<any> {
    switch (message?.op) {
      case "info":
        return { folder: this.host.folder(), platform: process.platform };
      case "choose":
        return { folder: await this.host.choose(this.folder(message.folder)) };
      case "prepare":
        return this.prepare(message);
      case "begin": {
        if (!Number.isSafeInteger(message.size) || message.size < 0)
          throw new HdfsError("changed");
        const target = await this.prepare(message);
        if (target.stamp !== message.stamp)
          throw new HdfsError("destinationChanged");
        const key =
          process.platform === "win32"
            ? target.path.toLowerCase()
            : target.path;
        if (this.targets.has(key) || this.sessions.size >= 4)
          throw new HdfsError("destinationBusy");
        this.targets.add(key);
        const id = randomUUID(),
          temporary = join(target.folder, `.hdfs-${id}.part`);
        let file: FileHandle;
        try {
          file = await open(temporary, "wx", 0o600);
        } catch (error) {
          this.targets.delete(key);
          throw error;
        }
        const session: Session = {
          file,
          temporary,
          path: target.path,
          key,
          stamp: target.stamp,
          size: message.size,
          bytes: 0,
          hash: createHash("sha256"),
          cancelled: false,
          tail: Promise.resolve(),
          progress: { update() {}, close() {} },
        };
        this.sessions.set(id, session);
        session.progress = this.host.progress(
          target.path,
          message.size,
          message.language,
          () => {
            this.host.cancelled?.(id);
            void this.abort(id);
          },
          message.quiet === true,
        );
        this.touch(id, session);
        // Remembering a folder is convenience; persistence failure must not orphan a transfer.
        await this.host.remember(target.folder).catch(() => {});
        return { id, path: target.path };
      }
      case "abort":
        await this.abort(message.id);
        return {};
      case "write":
      case "commit": {
        const session = this.sessions.get(message.id);
        if (!session || session.cancelled) throw new HdfsError("cancelled");
        this.touch(message.id, session);
        const operation = session.tail.then(async () => {
          if (session.cancelled) throw new HdfsError("cancelled");
          if (message.op === "write") {
            if (
              typeof message.data !== "string" ||
              message.data.length > Math.ceil(chunkSize / 3) * 4 ||
              message.offset !== session.bytes
            )
              throw new HdfsError("changed");
            const data = Buffer.from(message.data, "base64");
            if (
              data.length > chunkSize ||
              session.bytes + data.length > session.size
            )
              throw new HdfsError("changed");
            await session.file.writeFile(data);
            session.hash.update(data);
            session.bytes += data.length;
            session.progress.update(session.bytes);
            return {};
          }
          if (
            session.bytes !== session.size ||
            session.hash.digest("hex") !== message.sha256
          )
            throw new HdfsError("changed");
          if ((await this.stamp(session.path)) !== session.stamp)
            throw new HdfsError("destinationChanged");
          await session.file.close();
          if (session.cancelled) throw new HdfsError("cancelled");
          // link is exclusive: a new file appearing during a download is never overwritten.
          if (session.stamp === null)
            await link(session.temporary, session.path);
          else await rename(session.temporary, session.path);
          await this.cleanup(message.id, session);
          return { path: session.path };
        });
        session.tail = operation;
        try {
          return await operation;
        } catch (error) {
          await this.cleanup(message.id, session);
          throw error;
        }
      }
      default:
        throw new HdfsError("save");
    }
  }
  async dispose() {
    await Promise.all([...this.sessions.keys()].map((id) => this.abort(id)));
  }
}
