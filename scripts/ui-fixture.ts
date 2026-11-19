// Development-only UI fixture. No production endpoints or credentials.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fixture, files, pdfBytes } from "../test/fixture";
import { Client } from "../src/client";
import {
  changePreference,
  defaults,
  PreferenceSettings,
  resolveLanguage,
  validateConnection,
  HdfsError,
} from "../src/model";
import { selectPage } from "../src/listing";
import { errorText } from "../src/i18n";
import { readPreview } from "../src/preview";
import { addStressFiles } from "../test/stress-fixture";
async function main() {
  if (process.env.HDFS_STRESS_FIXTURES === "1") addStressFiles();
  const longName = "示例季度汇总_" + "long-filename-".repeat(10);
  files["/" + longName + ".pdf"] = pdfBytes(40);
  files["/continuous.pdf"] = pdfBytes(40);
  files["/large-preview.pdf"] = pdfBytes(40, 18 * 1048576);
  files["/" + longName + ".csv"] = Buffer.from("name,value\nexample,12\n");
  files["/archive.zip"] = Buffer.from([80, 75, 0, 0]);
  files["/dataset.parquet"] = Buffer.from([80, 65, 82, 49, 0]);
  files["/broken.pdf"] = Buffer.from("Invalid PDF fixture");
  files["/dataset.json"] = Buffer.from(
    '{"name":"Daily observations","records":[{"id":90071992547409931234,"city":"杭州","value":32.50},{"id":104,"city":"杭州","value":28.10},{"id":105,"city":"上海","value":31.25}],"unit":"°C"}',
  );
  files["/large-records.json"] = Buffer.from(
    JSON.stringify({
      records: Array.from({ length: 30000 }, (_, id) => ({
        id,
        text: "示例数据，测试长行自动换行与预览性能。",
        value: "1234567890".repeat(3),
      })),
    }),
  );
  files["/many-lines.log"] = Buffer.from("sample log entry\n".repeat(250000));
  const f = await fixture();
  let connections = [
    validateConnection({
      id: "demo",
      name: "Analytics sandbox",
      endpoint: f.endpoint,
      root: "/",
      auth: "none",
      username: "",
      timeout: 2,
    }),
  ];
  let preferenceSettings: PreferenceSettings = {
    ...defaults,
    language: "auto",
  };
  const editorLocale = process.env.HDFS_UI_LOCALE || "en";
  let preferences = {
      ...defaults,
      language: resolveLanguage("auto", editorLocale),
    },
    listing: any,
    revision = 0;
  const favorites: { path: string; name: string; type: string }[] = [];
  const jobs = [
    {
      id: "example-1",
      name: "dataset.json",
      status: "completed",
      direction: "download",
      target: "local",
      folder: "/Volumes/Downloads/Reports",
      done: 1,
      bytes: 215,
    },
    {
      id: "example-2",
      name: "archive.zip",
      status: "cancelled",
      direction: "download",
      target: "host",
      folder: "/srv/downloads",
      done: 0,
      bytes: 2097152,
    },
    {
      id: "example-3",
      name: "2 items",
      rootCount: 2,
      status: "completed",
      direction: "download",
      target: "local",
      folder: "/Volumes/Downloads/Reports",
      done: 2,
      bytes: 1976,
    },
  ].map((job) => ({
    ...job,
    connection: "demo",
    failed: 0,
    failedFiles: 0,
    skipped: 0,
  }));
  const places = () => ({ demo: { favorites } });
  let navigation = new AbortController();
  let diagnostic = new AbortController();
  let saveCheck = new AbortController();
  const state = (mode?: string) => ({
    type: "state",
    connections,
    preferences,
    languageSetting: preferenceSettings.language,
    host:
      process.env.HDFS_REMOTE_UI === "1"
        ? "Remote host: analytics-ssh"
        : "This computer",
    remote: process.env.HDFS_REMOTE_UI === "1",
    hostName: "analytics-ssh",
    places: places(),
    mode,
  });
  const themes: Record<string, string> = {
    light:
      "--vscode-editor-background:#fff;--vscode-foreground:#24292f;--vscode-descriptionForeground:#586069;--vscode-panel-border:#d8dee4;--vscode-input-background:#fff;--vscode-input-foreground:#24292f;--vscode-button-background:#0969da;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#0759bb;--vscode-button-secondaryBackground:#f0f2f4;--vscode-button-secondaryForeground:#24292f;--vscode-list-hoverBackground:#f3f5f7;--vscode-focusBorder:#0969da;--vscode-errorForeground:#b42318;",
    dark: "--vscode-editor-background:#1f1f1f;--vscode-foreground:#dedede;--vscode-descriptionForeground:#aaa;--vscode-panel-border:#3b3b3b;--vscode-input-background:#292929;--vscode-input-foreground:#dedede;--vscode-button-background:#0078d4;--vscode-button-foreground:#fff;--vscode-button-hoverBackground:#026ec1;--vscode-button-secondaryBackground:#333;--vscode-button-secondaryForeground:#dedede;--vscode-list-hoverBackground:#2b2b2b;--vscode-focusBorder:#6cbbff;--vscode-errorForeground:#ff9c92;",
    hc: "--vscode-editor-background:#000;--vscode-foreground:#fff;--vscode-descriptionForeground:#fff;--vscode-panel-border:#6fc3df;--vscode-input-background:#000;--vscode-input-foreground:#fff;--vscode-button-background:#000;--vscode-button-foreground:#fff;--vscode-button-secondaryBackground:#000;--vscode-button-secondaryForeground:#fff;--vscode-list-hoverBackground:#12364b;--vscode-focusBorder:#f38518;--vscode-contrastBorder:#6fc3df;--vscode-errorForeground:#ff9c92;",
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      if (url.pathname === "/bridge.js") {
        res.setHeader("content-type", "text/javascript");
        res.end(`window.acquireVsCodeApi = () => ({ getState: () => JSON.parse(sessionStorage.getItem('view') || 'null'), setState: value => sessionStorage.setItem('view',JSON.stringify(value)), postMessage: async message => {
        if(message.type === 'preview' && !message.inline) { location.href = '/?preview='+encodeURIComponent(message.path)+'&theme='+new URLSearchParams(location.search).get('theme'); return; }
        if(message.type === 'browse') { history.back(); return; }
        const preview = new URLSearchParams(location.search).get('preview');
        const response = await fetch('/message', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...message,preview})});
        for(const data of await response.json()) window.dispatchEvent(new MessageEvent('message',{data}));
      }});`);
        return;
      }
      if (url.pathname === "/message") {
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 100000) throw new Error();
        }
        const m = JSON.parse(text),
          client = new Client(
            connections.find((c) => c.id === m.connection) || connections[0],
          );
        let messages: any[] = [];
        try {
          if (m.type === "ready" && m.preview) {
            const content = await readPreview(
              client,
              m.preview,
              preferences,
              new AbortController().signal,
              m.encoding,
            );
            messages = [
              {
                ...content,
                language: preferences.language,
                path: m.preview,
                connection: connections[0].name,
                host: "This computer",
              },
            ];
          } else if (m.type === "preview" && m.inline) {
            const content = await readPreview(
              client,
              m.path,
              preferences,
              new AbortController().signal,
              m.encoding,
            );
            messages = [
              {
                type: "previewResult",
                previewRequest: m.previewRequest,
                content: {
                  ...content,
                  path: m.path,
                  language: preferences.language,
                  connection: connections[0].name,
                  host: "This computer",
                },
              },
            ];
          } else if (m.type === "download")
            messages = [
              {
                type: "downloadDialog",
                id: "fixture",
                remote: process.env.HDFS_REMOTE_UI === "1",
                hostName: "analytics-ssh",
                target:
                  process.env.HDFS_REMOTE_UI === "1"
                    ? preferences.downloadTarget
                    : "local",
                name: m.path.split("/").pop(),
                language: preferences.language,
              },
            ];
          else if (m.type === "downloadTarget")
            messages = [
              {
                type: "downloadLocation",
                id: m.id,
                target: m.target,
                request: m.request,
                folder:
                  m.target === "host" ? "/srv/downloads" : "/Volumes/Downloads",
              },
            ];
          else if (m.type === "downloadSubmit" || m.type === "downloadCancel")
            messages = [{ type: "downloadClosed", id: m.id }];
          else if (m.type === "ready") messages = [state()];
          else if (m.type === "place" && m.action === "set") {
            const index = favorites.findIndex((item) => item.path === m.path);
            if (m.active && index < 0)
              favorites.push({
                path: m.path,
                name: m.path.split("/").pop() || "/",
                type: m.entryType,
              });
            if (!m.active && index >= 0) favorites.splice(index, 1);
            messages = [{ type: "places", places: places() }];
          } else if (m.type === "tasks") messages = [{ type: "tasks", jobs }];
          else if (
            m.type === "selectFiltered" &&
            listing?.revision === m.revision
          ) {
            const filter = m.filter.toLocaleLowerCase();
            messages = [
              {
                type: "selection",
                revision: listing.revision,
                filter: m.filter,
                paths: listing.items
                  .filter((item: any) =>
                    item.pathSuffix.toLocaleLowerCase().includes(filter),
                  )
                  .map(
                    (item: any) =>
                      listing.path.replace(/\/$/, "") + "/" + item.pathSuffix,
                  ),
              },
            ];
          } else if (m.type === "savePreference") {
            preferenceSettings = changePreference(
              preferenceSettings,
              m.key,
              m.value,
            );
            preferences = {
              ...preferenceSettings,
              language: resolveLanguage(
                preferenceSettings.language,
                editorLocale,
              ),
            };
            messages = [
              {
                type: "preferenceSaved",
                key: m.key,
                request: m.request,
                preferences,
                languageSetting: preferenceSettings.language,
                host: state().host,
              },
            ];
          } else if (m.type === "save") {
            if (m.connection) {
              const c = validateConnection({
                ...m.connection,
                id: m.connection.id || "connection-" + Date.now(),
              });
              saveCheck.abort();
              saveCheck = new AbortController();
              const checker = new Client(c, m.secret);
              const entries = await checker.list(c.root, saveCheck.signal);
              const file = entries.find(
                (entry) => entry.type === "FILE" && entry.length > 0,
              );
              if (file)
                await checker.read(
                  c.root.replace(/\/$/, "") + "/" + file.pathSuffix,
                  1,
                  saveCheck.signal,
                );
              connections = connections.filter((x) => x.id !== c.id).concat(c);
              messages = [
                state("settings"),
                {
                  type: "saved",
                  kind: "connection",
                  id: c.id,
                  checkedRead: !!file,
                  request: m.request,
                },
              ];
            }
          } else if (m.type === "cancelSave") {
            saveCheck.abort();
          } else if (m.type === "navigate") {
            navigation.abort();
            navigation = new AbortController();
            const signal = navigation.signal;
            const items = await client.list(m.path, signal);
            listing = {
              items,
              path: m.path,
              connection: m.connection,
              revision: ++revision,
            };
            messages = [
              {
                type: "listed",
                ...listing,
                items: undefined,
                total: items.length,
                request: m.request,
              },
            ];
          } else if (m.type === "page" && listing?.revision === m.revision)
            messages = [
              {
                type: "page",
                ...listing,
                ...selectPage(
                  listing.items,
                  m.filter,
                  m.page,
                  m.sort,
                  m.descending,
                  m.pageSize,
                  m.focusName,
                ),
                filter: m.filter,
                pageRequest: m.pageRequest,
              },
            ];
          else if (m.type === "cancel") {
            navigation.abort();
            messages = [{ type: "cancelled", request: m.request }];
          } else if (m.type === "disconnect") {
            navigation.abort();
            listing = undefined;
            messages = [{ type: "disconnected" }];
          } else if (m.type === "diagnose") {
            diagnostic.abort();
            diagnostic = new AbortController();
            const signal = diagnostic.signal;
            const entry = await client.stat(m.path, signal);
            let text;
            if (entry.type === "DIRECTORY") {
              const entries =
                listing?.connection === m.connection && listing.path === m.path
                  ? listing.items
                  : await client.list(m.path, signal);
              const file = entries.find(
                (item: any) => item.type === "FILE" && item.length > 0,
              );
              if (file)
                await client.read(
                  m.path.replace(/\/$/, "") + "/" + file.pathSuffix,
                  1,
                  signal,
                );
              else
                text =
                  preferences.language === "zh-CN"
                    ? "当前目录没有可供检查的非空文件。"
                    : "No non-empty file in this folder to check.";
            } else await client.read(m.path, 1, signal);
            messages = [
              {
                type: "diagnosed",
                request: m.request,
                connection: m.connection,
                text,
              },
            ];
          } else if (m.type === "cancelDiagnose") diagnostic.abort();
        } catch (e) {
          messages = [
            {
              type:
                m.type === "diagnose"
                  ? "diagnosed"
                  : m.type === "savePreference"
                    ? "preferenceError"
                    : "error",
              key: m.key,
              connection: m.connection,
              scope: m.type,
              request: m.request,
              code: e instanceof HdfsError ? e.code : "unknown",
              text: errorText(e, preferences.language),
            },
          ];
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(messages));
        return;
      }
      if (url.pathname === "/") {
        const theme = url.searchParams.get("theme") || "light";
        res.setHeader("content-type", "text/html");
        res.end(
          '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--vscode-font-family:system-ui;--vscode-font-size:13px;--vscode-editor-font-family:monospace;' +
            (themes[theme] || themes.light) +
            '}</style><link rel="stylesheet" href="/web/style.css"></head><body class="' +
            (theme === "hc"
              ? "vscode-high-contrast vscode-dark"
              : theme === "dark"
                ? "vscode-dark"
                : "vscode-light") +
            '" data-mode="' +
            (url.searchParams.has("preview") ? "preview" : "main") +
            '"><main id="app"></main><script src="/bridge.js"></script><script type="module" src="/web/' +
            (url.searchParams.has("preview") ? "preview" : "app") +
            '.js"></script></body></html>',
        );
        return;
      }
      const root = resolve("dist"),
        path = resolve(root, "." + decodeURIComponent(url.pathname));
      if (!path.startsWith(root + "/")) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        "content-type",
        [".js", ".mjs"].includes(extname(path))
          ? "text/javascript"
          : extname(path) === ".css"
            ? "text/css"
            : "application/octet-stream",
      );
      res.end(await readFile(path));
    } catch {
      res.writeHead(500);
      res.end("Fixture request failed");
    }
  });
  server.listen(18791, "127.0.0.1", () =>
    console.log("UI fixture: http://127.0.0.1:18791"),
  );
  for (const event of ["SIGINT", "SIGTERM"])
    process.on(event, () => {
      server.closeAllConnections();
      server.close();
      void f.close().then(() => process.exit());
    });
}
void main();
