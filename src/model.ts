export type Language = "en" | "zh-CN";
export type LanguageSetting = "auto" | Language;
export type Auth = "none" | "simple" | "basic" | "bearer" | "delegation";
export interface Connection {
  id: string;
  name: string;
  endpoint: string;
  root: string;
  auth: Auth;
  username: string;
  timeout: number;
  readOnly?: boolean;
}
export interface Preferences {
  language: Language;
  textLimit: number;
  mediaLimit: number;
  downloadTarget?: "host" | "local";
}
export type PreferenceSettings = Omit<Preferences, "language"> & {
  language: LanguageSetting;
};
export interface Entry {
  pathSuffix: string;
  type: "DIRECTORY" | "FILE" | "SYMLINK";
  length: number;
  modificationTime: number;
  owner: string;
  group: string;
  permission: string;
}
export const defaults: Preferences = {
  language: "en",
  textLimit: 1024 * 1024,
  mediaLimit: 20 * 1024 * 1024,
  downloadTarget: "host",
};
export function resolveLanguage(
  setting: LanguageSetting,
  editorLocale: string,
): Language {
  if (setting === "en" || setting === "zh-CN") return setting;
  return /^zh(?:[-_]|$)/i.test(editorLocale) ? "zh-CN" : "en";
}
export function downloadName(
  path: string,
  platform = process.platform,
): string {
  const name = normalizePath(path).split("/").pop() || "download";
  if (platform !== "win32") return name;
  let safe = name.replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe))
    safe = "_" + safe;
  return safe || "download";
}
export class HdfsError extends Error {
  constructor(
    public code: string,
    public stage = "namenode",
  ) {
    super(code);
  }
}
export function normalizePath(value: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new HdfsError("path");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}
export function joinPath(parent: string, name: string): string {
  if (
    !name ||
    name.includes("/") ||
    name === "." ||
    name === ".." ||
    /[\x00-\x1f\x7f]/.test(name)
  )
    throw new HdfsError("response");
  return normalizePath(parent + "/" + name);
}
export function validateConnection(input: Connection): Connection {
  let url: URL;
  try {
    url = new URL(input.endpoint.trim());
  } catch {
    throw new HdfsError("endpoint");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HdfsError("endpoint");
  if (
    /\/webhdfs(?:\/.*)?$/.test(url.pathname) &&
    !url.pathname.replace(/\/$/, "").endsWith("/webhdfs/v1")
  )
    throw new HdfsError("endpointPrefix");
  if (!["none", "simple", "basic", "bearer", "delegation"].includes(input.auth))
    throw new HdfsError("auth");
  if (!input.name.trim()) throw new HdfsError("name");
  if (
    (input.auth === "simple" || input.auth === "basic") &&
    !input.username.trim()
  )
    throw new HdfsError("username");
  if (
    !Number.isInteger(input.timeout) ||
    input.timeout < 2 ||
    input.timeout > 300
  )
    throw new HdfsError("timeoutSetting");
  if (
    input.username.includes("\n") ||
    input.username.includes("\r") ||
    input.username.includes(":")
  )
    throw new HdfsError("username");
  // Explicit property projection keeps arbitrary webview fields (including secrets) out of persistent state.
  return {
    id: input.id,
    name: input.name.trim().slice(0, 120),
    endpoint: url.href.replace(/\/$/, ""),
    root: normalizePath(input.root),
    auth: input.auth,
    username: input.username.trim(),
    timeout: input.timeout,
    readOnly: input.readOnly === true,
  };
}
export function validatePreferences(
  input: PreferenceSettings,
): PreferenceSettings {
  if (
    !["auto", "en", "zh-CN"].includes(input.language) ||
    (input.downloadTarget !== undefined &&
      !["host", "local"].includes(input.downloadTarget)) ||
    !Number.isInteger(input.textLimit) ||
    input.textLimit < 1024 ||
    input.textLimit > 4 * 1024 * 1024 ||
    !Number.isInteger(input.mediaLimit) ||
    input.mediaLimit < 1024 ||
    input.mediaLimit > 50 * 1024 * 1024
  )
    throw new HdfsError("preferences");
  return {
    language: input.language,
    textLimit: input.textLimit,
    mediaLimit: input.mediaLimit,
    downloadTarget: input.downloadTarget ?? "host",
  };
}
export function changePreference(
  current: PreferenceSettings,
  key: unknown,
  value: unknown,
): PreferenceSettings {
  if (
    key !== "language" &&
    key !== "downloadTarget" &&
    key !== "textLimit" &&
    key !== "mediaLimit"
  )
    throw new HdfsError("preferences");
  return validatePreferences({ ...current, [key]: value });
}
export class Latest {
  private current?: AbortController;
  next(): AbortController {
    this.current?.abort();
    return (this.current = new AbortController());
  }
  isCurrent(controller: AbortController): boolean {
    return controller === this.current && !controller.signal.aborted;
  }
  cancel(): void {
    this.current?.abort();
  }
}
export class Gate {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private limit = 4) {}
  async run<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw new HdfsError("cancelled");
    if (this.active >= this.limit)
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          this.queue = this.queue.filter((x) => x !== ready);
          reject(new HdfsError("cancelled"));
        };
        this.queue.push(ready);
        signal.addEventListener("abort", abort, { once: true });
      });
    else this.active++;
    try {
      if (signal.aborted) throw new HdfsError("cancelled");
      return await action();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
