import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir, hostname, homedir } from "node:os";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { defaults, PreferenceSettings } from "../src/model";
import { fixture, files } from "./fixture";
import { TransferService, transferCommand } from "../src/transfer";

let source: string, f: Awaited<ReturnType<typeof fixture>>, directory: string;
before(async () => {
  source = (
    await build({
      entryPoints: ["src/extension.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["vscode", "undici"],
      write: false,
    })
  ).outputFiles[0].text;
  f = await fixture();
  directory = await mkdtemp(join(tmpdir(), "hdfs-host-tests-"));
});
after(async () => {
  await f.close();
  await rm(directory, { recursive: true, force: true });
});

const connection = () => ({
  id: "demo",
  name: "Fixture",
  endpoint: f.endpoint,
  root: "/",
  auth: "none",
  username: "",
  timeout: 2,
});

test("save and open checks the draft and actual file read before committing; failure and cancellation retain prior settings", async () => {
  const h = host();
  try {
    const before = f.requests.length;
    await h.panel.receive({
      type: "save",
      check: true,
      request: 1,
      connection: { ...connection(), name: "Checked" },
    });
    const reads = f.requests.slice(before);
    assert.ok(reads.some((r) => r.op === "LISTSTATUS"));
    assert.ok(
      reads.some((r) => r.op === "OPEN" && /length=1(?:&|$)/.test(r.raw)),
    );
    assert.equal(h.panel.messages.at(-1).checkedRead, true);
    assert.equal(h.config.get("connections:local")[0].name, "Checked");
    await h.panel.receive({
      type: "save",
      check: true,
      request: 2,
      connection: {
        ...connection(),
        endpoint: f.endpoint.replace("/v1", "/v"),
        name: "Wrong address",
      },
    });
    assert.equal(h.panel.messages.at(-1).code, "endpointPrefix");
    assert.equal(h.config.get("connections:local")[0].name, "Checked");
    await h.panel.receive({
      type: "save",
      check: true,
      request: 3,
      connection: { ...connection(), root: "/denied" },
    });
    assert.equal(h.panel.messages.at(-1).code, "forbidden");
    assert.equal(h.config.get("connections:local")[0].root, "/");
    const pending = h.panel.receive({
      type: "save",
      check: true,
      request: 4,
      connection: { ...connection(), root: "/timeout" },
    });
    await until(() => f.requests.some((r) => r.path === "/timeout"));
    await h.panel.receive({ type: "cancelSave" });
    await pending;
    assert.equal(h.panel.messages.at(-1).code, "cancelled");
    assert.equal(h.config.get("connections:local")[0].name, "Checked");
    await h.panel.receive({
      type: "save",
      check: true,
      request: 5,
      connection: { ...connection(), root: "/empty" },
    });
    assert.equal(h.panel.messages.at(-1).type, "saved");
    assert.equal(h.panel.messages.at(-1).checkedRead, false);
  } finally {
    h.dispose();
  }
});

test("diagnostics reuse the loaded listing, only read one byte, and distinguish empty folders from errors", async () => {
  const h = host();
  try {
    await h.panel.receive({
      type: "navigate",
      connection: "demo",
      path: "/",
      request: 1,
    });
    const before = f.requests.length;
    await h.panel.receive({
      type: "diagnose",
      connection: "demo",
      path: "/",
      request: 2,
    });
    const reads = f.requests.slice(before);
    assert.equal(reads.filter((r) => r.op === "LISTSTATUS").length, 0);
    assert.equal(reads.filter((r) => r.op === "OPEN").length, 1);
    assert.match(reads.find((r) => r.op === "OPEN")!.raw, /length=1(?:&|$)/);
    assert.equal(h.panel.messages.at(-1).type, "diagnosed");
    assert.equal(h.panel.messages.at(-1).text, undefined);
    await h.panel.receive({
      type: "diagnose",
      connection: "demo",
      path: "/empty",
      request: 3,
    });
    assert.match(h.panel.messages.at(-1).text, /No non-empty file/);
    assert.equal(h.panel.messages.at(-1).code, undefined);
    await h.panel.receive({
      type: "diagnose",
      connection: "demo",
      path: "/denied",
      request: 4,
    });
    assert.equal(h.panel.messages.at(-1).code, "forbidden");
    const pending = h.panel.receive({
      type: "diagnose",
      connection: "demo",
      path: "/timeout",
      request: 5,
    });
    await h.panel.receive({ type: "cancelDiagnose" });
    await pending;
    assert.equal(
      h.panel.messages.some(
        (m: any) => m.type === "diagnosed" && m.request === 5,
      ),
      false,
    );
  } finally {
    h.dispose();
  }
});

test("cancelling replacement navigation keeps the previous listing available for paging", async () => {
  const h = host();
  try {
    await h.panel.receive({
      type: "navigate",
      connection: "demo",
      path: "/",
      request: 1,
    });
    const listing = h.panel.messages.at(-1);
    const start = f.requests.length;
    const pending = h.panel.receive({
      type: "navigate",
      connection: "demo",
      path: "/timeout",
      request: 2,
    });
    await until(() =>
      f.requests.slice(start).some((r) => r.path === "/timeout"),
    );
    await h.panel.receive({ type: "cancel", request: 3 });
    await pending;
    await h.panel.receive({
      type: "page",
      revision: listing.revision,
      page: 0,
      pageSize: 10,
      pageRequest: 1,
    });
    assert.equal(h.panel.messages.at(-1).type, "page");
    assert.equal(h.panel.messages.at(-1).path, "/");
    assert.equal(h.panel.messages.at(-1).items.length, 10);
  } finally {
    h.dispose();
  }
});

test("standalone preview hands settings an exact return target and categorized failures", async () => {
  const h = host();
  try {
    const loading = h.panel.receive({
      type: "preview",
      connection: "demo",
      path: "/missing",
    });
    const preview = h.panels.at(-1);
    await preview.receive({ type: "ready" });
    await loading;
    assert.equal(preview.messages.at(-1).code, "missing");
    await preview.receive({ type: "settings", focus: "mediaLimit" });
    const state = h.panel.messages.at(-1);
    assert.deepEqual(state.previewReturn, {
      connection: "demo",
      path: "/missing",
      encoding: "auto",
    });
    assert.equal(state.settingsFocus, "mediaLimit");
    assert.equal(state.editConnection, "demo");
  } finally {
    h.dispose();
  }
});
test("encoding correction works inline and reuses the standalone panel", async () => {
  const h = host();
  const path = "/encoded.csv";
  files[path] = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x2c, 0x34, 0x32, 0x0a]);
  try {
    await h.panel.receive({
      type: "preview",
      inline: true,
      previewRequest: 1,
      connection: "demo",
      path,
    });
    assert.equal(h.panel.messages.at(-1).content.type, "encoding");
    await h.panel.receive({
      type: "preview",
      inline: true,
      previewRequest: 2,
      connection: "demo",
      path,
      encoding: "gbk",
    });
    assert.equal(h.panel.messages.at(-1).content.data, "中文,42\n");
    const loading = h.panel.receive({
      type: "preview",
      connection: "demo",
      path,
    });
    const panel = h.panels.at(-1);
    await panel.receive({ type: "ready" });
    await loading;
    const panelCount = h.panels.length;
    await panel.receive({ type: "encoding", encoding: "gbk" });
    await until(() => panel.messages.at(-1)?.type === "content");
    assert.equal(panel.messages.at(-1).data, "中文,42\n");
    assert.equal(h.panels.length, panelCount);
    await panel.receive({ type: "settings", focus: "textLimit" });
    assert.equal(h.panel.messages.at(-1).previewReturn.encoding, "gbk");
    await panel.receive({ type: "encoding", encoding: "ascii" });
    await until(() => panel.messages.at(-1)?.type === "encoding");
    assert.equal(panel.messages.at(-1).encodingSelection, "ascii");
  } finally {
    h.dispose();
    delete files[path];
  }
});
test("page size persists outside settings and paging does not repeat the directory request", async () => {
  const h = host();
  try {
    await h.panel.receive({
      type: "navigate",
      connection: "demo",
      path: "/",
      request: 1,
    });
    const revision = h.panel.messages.at(-1).revision;
    const count = f.requests.length;
    await h.panel.receive({
      type: "page",
      revision,
      page: 0,
      pageSize: 10,
      pageRequest: 1,
    });
    assert.equal(h.panel.messages.at(-1).pageSize, 10);
    assert.equal(h.config.get("pageSize"), 10);
    assert.equal(f.requests.length, count);
    await h.panel.receive({ type: "ready" });
    assert.equal(
      h.panel.messages.findLast((message: any) => message.type === "state")
        .pageSize,
      10,
    );
  } finally {
    h.dispose();
  }
});
const disposable = () => ({ dispose() {} });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
async function until(check: () => Promise<boolean> | boolean) {
  for (let i = 0; i < 600; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("download did not finish");
}
async function chooseDownload(
  h: ReturnType<typeof host>,
  path = "/welcome.txt",
) {
  await h.panel.receive({ type: "download", connection: "demo", path });
  const dialog = h.panel.messages.findLast(
    (m: any) => m.type === "downloadDialog",
  );
  assert.ok(dialog);
  return dialog;
}

function host(
  options: {
    remote?: boolean;
    missingLocalTransfer?: boolean;
    auth?: string;
    savedSecret?: string;
    locale?: string;
    preferences?: Partial<PreferenceSettings>;
  } = {},
) {
  const scope = options.remote ? "remote:" + hostname() : "local";
  const config = new Map<string, any>([
    [
      "connections:" + scope,
      [
        {
          ...connection(),
          auth: options.auth || "none",
          username: options.auth === "basic" ? "demo" : "",
        },
      ],
    ],
  ]);
  if (options.preferences) config.set("preferences", options.preferences);
  const secrets = new Map<string, string>();
  if (options.savedSecret)
    secrets.set("connection." + scope + ".demo", options.savedSecret);
  const commands = new Map<string, Function>(),
    panels: any[] = [],
    errors: string[] = [],
    notices: string[] = [],
    clipboard: string[] = [],
    progress: any[] = [];
  const hooks = {
    transfer: async (_message: any): Promise<any> => undefined,
    save: async (_options: any): Promise<any> => undefined,
    error: async (
      _message: string,
      ..._actions: any[]
    ): Promise<string | undefined> => undefined,
    failPersist: false,
    failSecretGet: false,
  };
  const uri = (p: string) => ({
    scheme: "file",
    fsPath: p,
    toString: () => pathToFileURL(p).href,
  });
  let tree: any;
  const api = {
    EventEmitter: class {
      event = () => disposable();
      fire() {}
      dispose() {}
    },
    Uri: {
      file: uri,
      joinPath: (base: any, ...segments: string[]) =>
        uri(join(base.fsPath, ...segments)),
    },
    ViewColumn: { One: 1, Active: -1 },
    ProgressLocation: { Notification: 15 },
    env: {
      language: options.locale || "en",
      remoteName: options.remote ? "ssh-remote" : undefined,
      clipboard: {
        writeText: async (value: string) => {
          clipboard.push(value);
        },
      },
    },
    commands: {
      executeCommand: async (name: string, message: any) => {
        if (name === "_hdfsFileManager.remoteLabel") {
          if (options.missingLocalTransfer)
            throw new Error("Command not found");
          return "example-ssh";
        }
        return name === transferCommand
          ? hooks.transfer(message)
          : commands.get(name)?.(message);
      },
      registerCommand: (name: string, fn: Function) => {
        commands.set(name, fn);
        return disposable();
      },
    },
    window: {
      registerWebviewViewProvider: () => disposable(),
      createTreeView: (_name: string, opts: any) => {
        tree = opts.treeDataProvider;
        return disposable();
      },
      createWebviewPanel: (type: string, title: string) => {
        let receiver: Function, onDispose: Function;
        const messages: any[] = [];
        const panel: any = {
          type,
          title,
          messages,
          reveals: 0,
          disposed: false,
          webview: {
            cspSource: "vscode-webview:",
            asWebviewUri: (u: any) => u,
            postMessage: async (m: any) => {
              messages.push(m);
              return true;
            },
            onDidReceiveMessage: (fn: Function) => {
              receiver = fn;
              return disposable();
            },
          },
          onDidDispose: (fn: Function) => {
            onDispose = fn;
            return disposable();
          },
          reveal() {
            panel.reveals++;
          },
          dispose() {
            if (!panel.disposed) {
              panel.disposed = true;
              onDispose?.();
            }
          },
          receive: (m: any) => receiver(m),
        };
        panels.push(panel);
        return panel;
      },
      showSaveDialog: (o: any) => hooks.save(o),
      showErrorMessage: async (m: string, ...actions: any[]) => {
        errors.push(m);
        return hooks.error(m, ...actions);
      },
      showWarningMessage: async () => undefined,
      showInformationMessage: async (m: string) => {
        notices.push(m);
      },
      withProgress: async (options: any, fn: Function) => {
        progress.push(options);
        return fn(
          { report() {} },
          {
            isCancellationRequested: false,
            onCancellationRequested: () => disposable(),
          },
        );
      },
    },
  };
  const context: any = {
    subscriptions: [],
    extensionUri: uri(process.cwd()),
    globalState: {
      get: (key: string, fallback: any) =>
        config.has(key) ? config.get(key) : fallback,
      update: async (key: string, value: any) => {
        if (hooks.failPersist) {
          hooks.failPersist = false;
          throw new Error("disk unavailable");
        }
        config.set(key, value);
      },
    },
    secrets: {
      get: async (key: string) => {
        if (hooks.failSecretGet) {
          hooks.failSecretGet = false;
          throw new Error("secure storage temporarily unavailable");
        }
        return secrets.get(key);
      },
      store: async (key: string, value: string) => {
        secrets.set(key, value);
      },
      delete: async (key: string) => {
        secrets.delete(key);
      },
    },
  };
  const module = { exports: {} as any },
    nodeRequire = createRequire(__filename);
  new Function("require", "module", "exports", source)(
    (name: string) => (name === "vscode" ? api : nodeRequire(name)),
    module,
    module.exports,
  );
  module.exports.activate(context);
  commands.get("hdfsLite.open")!();
  const panel = panels[0];
  return {
    panel,
    panels,
    config,
    secrets,
    hooks,
    errors,
    notices,
    clipboard,
    progress,
    uri,
    scope,
    commands,
    tree,
    dispose: () => context.subscriptions.forEach((x: any) => x.dispose()),
  };
}

test("a missing Local Transfer companion overrides the effective download target on SSH", async () => {
  const h = host({
    remote: true,
    missingLocalTransfer: true,
    preferences: { downloadTarget: "local" },
  });
  try {
    const dialog = await chooseDownload(h);
    assert.equal(dialog.localTransfer, false);
    assert.equal(dialog.target, "host");
    assert.equal(h.config.get("preferences").downloadTarget, "local");
  } finally {
    h.dispose();
  }
});

test("download defaults follow the host; local choice streams through the local companion and persists only the explicit preference", async () => {
  const h = host({ remote: true });
  const localFolder = await mkdtemp(join(directory, "local-"));
  const local = new TransferService({
    folder: () => localFolder,
    choose: async () => localFolder,
    remember: async () => {},
    progress: () => ({ update() {}, close() {} }),
  });
  const calls: any[] = [];
  h.hooks.transfer = async (message) => {
    calls.push(JSON.parse(JSON.stringify(message)));
    return local.handle(message);
  };
  try {
    const first = await chooseDownload(h);
    assert.equal(first.target, "host");
    assert.equal(first.hostName, "example-ssh");
    await h.panel.receive({
      type: "downloadTarget",
      id: first.id,
      target: "local",
      request: 1,
    });
    assert.equal(h.panel.messages.at(-1).folder, localFolder);
    await h.panel.receive({
      type: "downloadSubmit",
      id: first.id,
      target: "local",
      folder: localFolder,
      name: "local.txt",
    });
    await until(
      async () =>
        !!(await readFile(join(localFolder, "local.txt")).catch(
          () => undefined,
        )),
    );
    assert.deepEqual(
      await readFile(join(localFolder, "local.txt")),
      files["/welcome.txt"],
    );
    assert.ok(calls.some((m) => m.op === "write"));
    assert.ok(calls.every((m) => !m.endpoint && !m.secret && !m.username));
    const second = await chooseDownload(h);
    assert.equal(second.target, "host");
    await h.panel.receive({ type: "downloadCancel", id: second.id });
    await h.panel.receive({
      type: "savePreference",
      key: "downloadTarget",
      value: "local",
      request: 1,
    });
    assert.equal(h.config.get("preferences").downloadTarget, "local");
    const third = await chooseDownload(h);
    assert.equal(third.target, "local");
    assert.equal(h.notices.length, 0);
  } finally {
    h.dispose();
    await local.dispose();
  }
});

test("ordinary windows default to local; invalid destinations retain the chooser and can be corrected", async () => {
  const h = host();
  try {
    const dialog = await chooseDownload(h);
    assert.equal(dialog.target, "local");
    h.config.set("downloadFolder", "/legacy/remote/path");
    h.config.set("downloadFolder:remote:" + hostname(), "/remote/path");
    await h.panel.receive({
      type: "downloadTarget",
      id: dialog.id,
      target: "local",
      request: 1,
    });
    assert.equal(h.panel.messages.at(-1).folder, homedir());
    await h.panel.receive({
      type: "downloadSubmit",
      id: dialog.id,
      target: "local",
      folder: join(directory, "nonexistent"),
      name: "fixed.txt",
    });
    assert.equal(h.panel.messages.at(-1).type, "downloadError");
    await h.panel.receive({
      type: "downloadSubmit",
      id: dialog.id,
      target: "local",
      folder: directory,
      name: "fixed.txt",
    });
    await until(
      async () =>
        !!(await readFile(join(directory, "fixed.txt")).catch(() => undefined)),
    );
    assert.deepEqual(
      await readFile(join(directory, "fixed.txt")),
      files["/welcome.txt"],
    );
    assert.equal(h.notices.length, 0);
    assert.equal(h.config.get("downloadFolder:local"), directory);
    assert.equal(
      h.config.get("downloadFolder:remote:" + hostname()),
      "/remote/path",
    );
  } finally {
    h.dispose();
  }
});
test("secure-store failure before the download dialog offers a working retry", async () => {
  const h = host();
  try {
    h.hooks.failSecretGet = true;
    h.hooks.error = async () => "Retry";
    await chooseDownload(h);
    assert.equal(h.errors.length, 1);
    assert.equal(
      h.panel.messages.filter((m: any) => m.type === "downloadDialog").length,
      1,
    );
  } finally {
    h.dispose();
  }
});

test("connection changes close a pending chooser and stale submit cannot read the new endpoint", async () => {
  const h = host();
  try {
    const dialog = await chooseDownload(h),
      before = f.requests.length;
    await h.panel.receive({
      type: "save",
      connection: {
        ...connection(),
        endpoint: "http://127.0.0.1:1/webhdfs/v1",
      },
    });
    await h.panel.receive({
      type: "downloadSubmit",
      id: dialog.id,
      target: "local",
      folder: directory,
      name: "stale.txt",
    });
    assert.equal(f.requests.length, before);
    assert.ok(!(await readdir(directory)).includes("stale.txt"));
    assert.ok(
      h.panel.messages.some(
        (m: any) => m.type === "downloadClosed" && m.id === dialog.id,
      ),
    );
  } finally {
    h.dispose();
  }
});

test("concurrent downloads to the same destination keep the second chooser open with a useful error", async () => {
  const h = host();
  try {
    const first = await chooseDownload(h, "/slow.bin");
    await h.panel.receive({
      type: "downloadSubmit",
      id: first.id,
      target: "local",
      folder: directory,
      name: "locked.bin",
    });
    const second = await chooseDownload(h);
    await h.panel.receive({
      type: "downloadSubmit",
      id: second.id,
      target: "local",
      folder: directory,
      name: "locked.bin",
    });
    assert.match(h.panel.messages.at(-1).text, /already running/);
    await until(
      async () =>
        !!(await readFile(join(directory, "locked.bin")).catch(
          () => undefined,
        )),
    );
    assert.deepEqual(
      await readFile(join(directory, "locked.bin")),
      files["/slow.bin"],
    );
  } finally {
    h.dispose();
  }
});

test("context commands reject stale listings and route live menu targets; copying names uses basename only", async () => {
  const h = host();
  try {
    await h.panel.receive({ type: "navigate", connection: "demo", path: "/" });
    const revision = h.panel.messages.at(-1).revision;
    const target = {
      webview: "hdfsLite.explorer",
      hdfsConnection: "demo",
      hdfsPath: "/",
      hdfsRevision: revision,
    };
    await h.commands.get("hdfsLite.refresh")!(target);
    assert.equal(h.panel.messages.at(-1).type, "contextAction");
    const before = h.panel.messages.length;
    await h.commands.get("hdfsLite.refresh")!({ ...target, hdfsRevision: -1 });
    await h.commands.get("hdfsLite.copy")!({
      ...target,
      hdfsPath: "/not-in-list",
    });
    assert.equal(h.panel.messages.length, before);
    await h.panel.receive({
      type: "copy",
      path: "/unicode/报告 #?.pdf",
      nameOnly: true,
    });
    assert.equal(h.clipboard.at(-1), "报告 #?.pdf");
    await h.commands.get("hdfsLite.copyName")!({
      connection: connection(),
      path: "/nested/report.pdf",
    });
    assert.equal(h.clipboard.at(-1), "report.pdf");
    await h.commands.get("hdfsLite.connectionSettings")!({
      connection: connection(),
      path: "/",
    });
    assert.equal(h.panel.messages.at(-1).editConnection, "demo");
  } finally {
    h.dispose();
  }
});

test("host saves preferences independently and retains persisted connection scope", async () => {
  const h = host({ remote: true });
  try {
    await h.panel.receive({
      type: "savePreference",
      key: "language",
      value: "zh-CN",
      request: 1,
    });
    assert.equal(h.config.get("preferences").language, "zh-CN");
    assert.equal(h.config.get("connections:" + h.scope)[0].id, "demo");
    assert.equal(h.config.get("connections:local"), undefined);
    assert.equal(h.panel.messages.at(-1).type, "preferenceSaved");
  } finally {
    h.dispose();
  }
});
test("Auto follows the editor locale and queued preferences retain independent changes", async () => {
  const chinese = host({ locale: "zh-tw", remote: true });
  const other = host({ locale: "ja", preferences: { language: "auto" } });
  const override = host({ locale: "zh-cn", preferences: { language: "en" } });
  try {
    for (const h of [chinese, other, override])
      await h.panel.receive({ type: "ready" });
    const latestState = (h: ReturnType<typeof host>) =>
      h.panel.messages.findLast((m: any) => m.type === "state");
    assert.equal(latestState(chinese).languageSetting, "auto");
    assert.equal(latestState(chinese).preferences.language, "zh-CN");
    assert.equal(latestState(other).preferences.language, "en");
    assert.equal(latestState(override).languageSetting, "en");
    assert.equal(latestState(override).preferences.language, "en");
    await Promise.all([
      override.panel.receive({
        type: "savePreference",
        key: "language",
        value: "auto",
        request: 1,
      }),
      override.panel.receive({
        type: "savePreference",
        key: "mediaLimit",
        value: 40 * 1048576,
        request: 2,
      }),
      override.panel.receive({
        type: "savePreference",
        key: "mediaLimit",
        value: -1,
        request: 3,
      }),
    ]);
    assert.equal(override.config.get("preferences").language, "auto");
    assert.equal(override.config.get("preferences").mediaLimit, 40 * 1048576);
    assert.equal(override.panel.messages.at(-2).preferences.language, "zh-CN");
    assert.equal(override.panel.messages.at(-1).type, "preferenceError");
  } finally {
    for (const h of [chinese, other, override]) h.dispose();
  }
});
test("failed connection persistence restores its old secret, and retry commits without leaking it", async () => {
  const h = host({ auth: "basic", savedSecret: "previous-secret" });
  try {
    const update = {
      type: "save",
      connection: {
        ...connection(),
        auth: "basic",
        username: "demo",
        name: "Changed",
      },
      secret: "replacement-secret",
    };
    h.hooks.failPersist = true;
    await h.panel.receive(update);
    assert.equal(h.panel.messages.at(-1).type, "error");
    assert.equal([...h.secrets.values()][0], "previous-secret");
    assert.equal(h.config.get("connections:local")[0].name, "Fixture");
    await h.panel.receive(update);
    assert.equal(h.panel.messages.at(-1).type, "saved");
    assert.equal([...h.secrets.values()][0], "replacement-secret");
    assert.ok(!JSON.stringify([...h.config]).includes("secret"));
    assert.ok(!JSON.stringify(h.panel.messages).includes("replacement-secret"));
  } finally {
    h.dispose();
  }
});
test("changing connection identity requires a fresh credential and leaves the previous one intact", async () => {
  const h = host({ auth: "basic", savedSecret: "previous-secret" });
  try {
    await h.panel.receive({
      type: "save",
      connection: { ...connection(), auth: "basic", username: "other" },
      secret: "",
    });
    assert.equal(h.panel.messages.at(-1).code, "secret");
    assert.equal(h.config.get("connections:local")[0].username, "demo");
    assert.equal([...h.secrets.values()][0], "previous-secret");
  } finally {
    h.dispose();
  }
});
test("JSON preview preserves large integer bytes and does not reset the existing file panel", async () => {
  const path = "/报告 #?%&+\\精度.json";
  files[path] = Buffer.from('{"id":9007199254740993123,"value":1.2300}\n');
  const h = host();
  try {
    await h.panel.receive({
      type: "navigate",
      connection: "demo",
      path: "/",
      request: 1,
    });
    const before = h.panel.messages.length,
      reveals = h.panel.reveals;
    const work = h.panel.receive({ type: "preview", connection: "demo", path });
    const p = h.panels[1];
    assert.equal(p.title, path.slice(1));
    await p.receive({ type: "ready" });
    await work;
    const content = p.messages.at(-1);
    assert.equal(content.type, "content");
    assert.equal(content.data, files[path].toString());
    assert.equal(h.panel.messages.length, before);
    assert.equal(h.panel.reveals, reveals);
    p.receive({ type: "browse" });
    assert.equal(h.panel.reveals, reveals + 1);
    assert.equal(h.panel.messages.at(-1).type, "focusFiles");
  } finally {
    h.dispose();
    delete files[path];
  }
});
test("truncated UTF-8 text preview drops an incomplete code point", async () => {
  const path = "/boundary.txt";
  files[path] = Buffer.concat([Buffer.alloc(1023, "a"), Buffer.from("中文")]);
  const h = host();
  try {
    await h.panel.receive({
      type: "savePreference",
      key: "textLimit",
      value: 1024,
      request: 1,
    });
    const work = h.panel.receive({ type: "preview", connection: "demo", path });
    const p = h.panels[1];
    await p.receive({ type: "ready" });
    await work;
    assert.equal(p.messages.at(-1).data, "a".repeat(1023));
    assert.equal(p.messages.at(-1).truncated, true);
  } finally {
    h.dispose();
    delete files[path];
  }
});
test("inline preview uses the existing panel and suppresses cancelled or superseded reads", async () => {
  const h = host();
  try {
    const first = h.panel.receive({
      type: "preview",
      inline: true,
      previewRequest: 1,
      connection: "demo",
      path: "/slow.bin",
    });
    await h.panel.receive({
      type: "preview",
      inline: true,
      previewRequest: 2,
      connection: "demo",
      path: "/welcome.txt",
    });
    await first;
    assert.equal(h.panels.length, 1);
    const results = h.panel.messages.filter(
      (m: any) => m.type === "previewResult" && m.content.type !== "loading",
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].previewRequest, 2);
    assert.equal(results[0].content.data, files["/welcome.txt"].toString());
    const cancelled = h.panel.receive({
      type: "preview",
      inline: true,
      previewRequest: 3,
      connection: "demo",
      path: "/slow.bin",
    });
    await h.panel.receive({ type: "cancelPreview" });
    await cancelled;
    assert.equal(
      h.panel.messages.filter(
        (m: any) => m.previewRequest === 3 && m.content.type !== "loading",
      ).length,
      0,
    );
  } finally {
    h.dispose();
  }
});
test("preview limits skip oversized media reads and allow correcting undecodable text", async () => {
  const h = host();
  const large = "/oversized.pdf",
    binary = "/invalid.txt";
  files[large] = Buffer.alloc(2048, "x");
  files[binary] = Buffer.from([0xff, 0xfe, 0xff]);
  try {
    await h.panel.receive({
      type: "savePreference",
      key: "mediaLimit",
      value: 1024,
      request: 1,
    });
    const before = f.dataRequests.length;
    await h.panel.receive({
      type: "preview",
      inline: true,
      previewRequest: 1,
      connection: "demo",
      path: large,
    });
    const content = h.panel.messages.at(-1).content;
    assert.equal(content.type, "limited");
    assert.equal(content.limit, 1024);
    assert.equal(f.dataRequests.length, before);
    await h.panel.receive({
      type: "preview",
      inline: true,
      previewRequest: 2,
      connection: "demo",
      path: binary,
    });
    assert.equal(h.panel.messages.at(-1).content.type, "encoding");
    await h.panel.receive({
      type: "preview",
      inline: true,
      previewRequest: 3,
      connection: "demo",
      path: "/large.txt",
    });
    assert.equal(h.panel.messages.at(-1).content.bytesRead, defaults.textLimit);
    assert.equal(h.panel.messages.at(-1).content.truncated, true);
  } finally {
    h.dispose();
    delete files[large];
    delete files[binary];
  }
});
