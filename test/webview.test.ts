import { before, test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { defaults } from "../src/model";
let source: string;
before(async () => {
  const result = await build({
    entryPoints: ["web/app.js"],
    bundle: true,
    format: "iife",
    write: false,
    external: ["./pdf.mjs"],
    define: {
      "import.meta.url": '"https://fixture.invalid/web/preview-content.js"',
    },
  });
  source = result.outputFiles[0].text;
});
const connections = [
  {
    id: "first",
    name: "Demo",
    endpoint: "https://hdfs.example.org/webhdfs/v1",
    root: "/",
    auth: "simple",
    username: "demo",
    timeout: 30,
  },
  {
    id: "second",
    name: "Second",
    endpoint: "https://other.example.org/webhdfs/v1",
    root: "/data",
    auth: "none",
    username: "",
    timeout: 30,
  },
];
test("download pills retain per-host paths, ignore stale responses, preserve defaults, and submit the visible location", () => {
  const u = ui();
  try {
    u.receive({
      type: "downloadDialog",
      id: "one",
      target: "host",
      remote: true,
      hostName: "example-ssh",
      name: "报告 #%.pdf",
      language: "en",
    });
    const request = u.messages.at(-1).request;
    u.receive({
      type: "downloadLocation",
      id: "one",
      target: "host",
      request,
      folder: "/srv/downloads",
      name: "报告 #%.pdf",
    });
    u.fill("downloadFolder", "/srv/chosen");
    u.click("This computer");
    const localRequest = u.messages.at(-1).request;
    u.receive({
      type: "downloadLocation",
      id: "one",
      target: "host",
      request,
      folder: "/stale",
      name: "stale",
    });
    assert.equal(
      (u.doc.getElementById("downloadFolder") as HTMLInputElement).value,
      "",
    );
    u.receive({
      type: "downloadLocation",
      id: "one",
      target: "local",
      request: localRequest,
      folder: "/local/downloads",
      name: "报告 #%.pdf",
    });
    u.fill("downloadFolder", "/local/chosen");
    u.click("example-ssh");
    assert.equal(
      (u.doc.getElementById("downloadFolder") as HTMLInputElement).value,
      "/srv/chosen",
    );
    u.click("This computer");
    assert.equal(
      (u.doc.getElementById("downloadFolder") as HTMLInputElement).value,
      "/local/chosen",
    );
    u.doc
      .querySelector(".download-dialog form")!
      .dispatchEvent(new u.dom.window.Event("submit", { cancelable: true }));
    assert.equal(u.messages.at(-1).target, "local");
    assert.equal(u.messages.at(-1).folder, "/local/chosen");
    assert.equal(u.messages.at(-1).name, "报告 #%.pdf");
    u.receive({
      type: "downloadError",
      id: "one",
      text: "Choose another folder",
    });
    assert.equal(
      (u.doc.getElementById("downloadFolder") as HTMLInputElement).value,
      "/local/chosen",
    );
    u.doc
      .querySelector("dialog")!
      .dispatchEvent(new u.dom.window.Event("cancel", { cancelable: true }));
    assert.equal(u.messages.at(-1).type, "downloadCancel");
    assert.equal(u.doc.querySelector("dialog"), null);
    assert.ok(u.messages.every((m) => m.type !== "save"));
  } finally {
    u.dom.window.close();
  }
});

test("settings expose the remote default and persist it separately from temporary download switches", () => {
  const u = ui("settings");
  try {
    u.receive({
      type: "state",
      mode: "settings",
      connections,
      preferences: defaults,
      host: "Remote host",
      remote: true,
      hostName: "example-ssh",
    });
    const target = u.doc.getElementById("downloadTarget") as HTMLSelectElement;
    assert.equal(target.value, "host");
    assert.equal(target.options[0].textContent, "example-ssh");
    u.fill("downloadTarget", "local");
    assert.equal(u.messages.at(-1).type, "savePreference");
    assert.equal(u.messages.at(-1).key, "downloadTarget");
    assert.equal(u.messages.at(-1).value, "local");
  } finally {
    u.dom.window.close();
  }
});
test("Remote SSH only offers the host when Local Transfer is unavailable", () => {
  const u = ui();
  const state = {
    type: "state",
    connections,
    remote: true,
    localTransfer: false,
    preferences: { ...defaults, downloadTarget: "local" },
    hostName: "example-ssh",
    host: "Remote host",
  };
  try {
    u.receive(state);
    loadRows(u);
    for (const label of ["Upload", "Download: nested"]) {
      u.click(label);
      assert.deepEqual(
        [...u.doc.querySelectorAll('dialog [role="radio"]')].map(
          (button) => button.textContent,
        ),
        ["example-ssh"],
      );
      u.click(label === "Upload" ? "Choose files" : "Choose destination");
      assert.equal(u.messages.at(-1).target, "host");
      u.click("Cancel");
    }
    u.receive({
      type: "downloadDialog",
      id: "remote-only",
      target: "host",
      remote: true,
      localTransfer: false,
      hostName: "example-ssh",
      name: "one.txt",
      language: "en",
    });
    assert.deepEqual(
      [...u.doc.querySelectorAll('dialog [role="radio"]')].map(
        (button) => button.textContent,
      ),
      ["example-ssh"],
    );
    u.click("Cancel");
    u.receive({ ...state, mode: "settings" });
    const target = u.doc.getElementById("downloadTarget") as HTMLSelectElement;
    assert.equal(target.disabled, true);
    assert.deepEqual(
      [...target.options].map((option) => option.value),
      ["host"],
    );
  } finally {
    u.dom.window.close();
  }
});
function ui(mode = "browse") {
  const dom = new JSDOM('<main id="app"></main>', {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.Range.prototype.getClientRects = () =>
    [] as unknown as DOMRectList;
  dom.window.Range.prototype.getBoundingClientRect = () =>
    new dom.window.DOMRect(0, 0, 400, 20);
  const messages: any[] = [];
  let persisted: any;
  (dom.window as any).acquireVsCodeApi = () => ({
    postMessage: (m: any) => messages.push(m),
    getState: () => persisted,
    setState: (s: any) => {
      persisted = s;
    },
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.dispatchEvent(new dom.window.Event("close"));
  };
  dom.window.eval(source);
  const receive = (data: any) =>
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data }));
  receive({
    type: "state",
    mode,
    connections,
    preferences: defaults,
    host: "This computer",
  });
  const doc = dom.window.document;
  const click = (label: string) => {
    const b = [...doc.querySelectorAll("button")].find(
      (b) => b.textContent === label || b.getAttribute("aria-label") === label,
    );
    assert.ok(b, label);
    b.click();
  };
  const fill = (id: string, value: string) => {
    const input = doc.getElementById(id) as HTMLInputElement;
    assert.ok(input, id);
    input.value = value;
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  const savePreference = (id: string) =>
    doc
      .getElementById(id)!
      .dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  const ackPreference = (
    preferences: typeof defaults,
    languageSetting: string = preferences.language,
  ) => {
    const { key, request } = messages
      .filter((m) => m.type === "savePreference")
      .at(-1);
    receive({
      type: "preferenceSaved",
      key,
      request,
      preferences,
      languageSetting,
      host: "This computer",
    });
  };
  return {
    dom,
    doc,
    messages,
    savePreference,
    ackPreference,
    receive,
    click,
    fill,
    persisted: () => persisted,
  };
}
test("webview settings failures preserve input and permit retry", () => {
  const u = ui("settings");
  u.fill("name", "Edited");
  u.doc
    .querySelector("form")!
    .dispatchEvent(new u.dom.window.Event("submit", { cancelable: true }));
  assert.equal(u.messages.at(-1).connection.name, "Edited");
  u.receive({ type: "error", scope: "save", text: "Invalid endpoint" });
  assert.equal(
    (u.doc.getElementById("name") as HTMLInputElement).value,
    "Edited",
  );
  assert.equal(
    (u.doc.getElementById("saveOpen") as HTMLButtonElement).disabled,
    false,
  );
  u.dom.window.close();
});

test("adding and switching connections retain independent unsaved global preferences", () => {
  const u = ui("settings");
  try {
    u.fill("textLimit", "2");
    u.click("Add connection");
    assert.equal(u.doc.querySelector("dialog"), null);
    assert.equal(
      (u.doc.getElementById("textLimit") as HTMLInputElement).value,
      "2",
    );
    u.fill("name", "Unfinished connection");
    u.fill("editConnection", "second");
    u.doc
      .getElementById("editConnection")!
      .dispatchEvent(new u.dom.window.Event("change"));
    u.click("Discard changes");
    assert.equal(
      (u.doc.getElementById("name") as HTMLInputElement).value,
      "Second",
    );
    assert.equal(
      (u.doc.getElementById("textLimit") as HTMLInputElement).value,
      "2",
    );
  } finally {
    u.dom.window.close();
  }
});

test("download target keyboard navigation keeps focus when a delayed location arrives", () => {
  const u = ui();
  try {
    u.receive({
      type: "downloadDialog",
      id: "keyboard",
      target: "host",
      remote: true,
      hostName: "example-ssh",
      name: "sample.csv",
      language: "en",
    });
    const key = (node: Element, value: string) =>
      node.dispatchEvent(
        new u.dom.window.KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
        }),
      );
    const host = u.doc.querySelector<HTMLButtonElement>(
      '[data-target="host"]',
    )!;
    host.focus();
    key(host, "Home");
    assert.equal(u.doc.querySelector('[aria-checked="true"]'), host);
    key(host, "End");
    const local = u.doc.querySelector<HTMLButtonElement>(
      '[data-target="local"]',
    )!;
    assert.equal(u.doc.activeElement, local);
    const request = u.messages.at(-1).request;
    u.receive({
      type: "downloadLocation",
      id: "keyboard",
      target: "local",
      request,
      folder: "/local/downloads",
      name: "sample.csv",
    });
    assert.equal(u.doc.activeElement, local);
    key(local, "End");
    assert.equal(u.doc.querySelector('[aria-checked="true"]'), local);
    key(local, "Home");
    assert.equal(u.doc.querySelector('[aria-checked="true"]'), host);
  } finally {
    u.dom.window.close();
  }
});

test("cancelled folder navigation restores the current rows, path and paging context", () => {
  const u = ui();
  try {
    loadRows(u);
    u.doc.getElementById("files")!.scrollTop = 65;
    u.fill("path", "/timeout");
    u.doc
      .querySelector("form")!
      .dispatchEvent(new u.dom.window.Event("submit", { cancelable: true }));
    u.click("Cancel");
    u.receive({ type: "cancelled", request: u.messages.at(-1).request });
    assert.equal(u.doc.querySelectorAll(".file-row").length, 3);
    assert.equal((u.doc.getElementById("path") as HTMLInputElement).value, "/");
    assert.equal(u.doc.getElementById("files")!.scrollTop, 65);
    u.click("Refresh");
    assert.equal(u.messages.at(-1).path, "/");
  } finally {
    u.dom.window.close();
  }
});

test("network recovery focuses an existing setting instead of a removed diagnostics entry", () => {
  const u = ui();
  try {
    u.click("Open connection");
    u.receive({
      type: "error",
      scope: "navigate",
      request: u.messages.at(-1).request,
      code: "network",
      text: "Connection interrupted.",
    });
    [...u.doc.querySelectorAll<HTMLButtonElement>("#notice button")]
      .find((button) => button.textContent === "Connection settings")!
      .click();
    assert.equal(u.doc.activeElement?.id, "endpoint");
  } finally {
    u.dom.window.close();
  }
});

test("removing a failed connection does not carry its error into the remaining connection", () => {
  const u = ui();
  try {
    u.click("Open connection");
    u.receive({
      type: "error",
      scope: "navigate",
      request: u.messages.at(-1).request,
      code: "network",
      text: "Old connection failed.",
    });
    [...u.doc.querySelectorAll<HTMLButtonElement>("#notice button")]
      .find((button) => button.textContent === "Connection settings")!
      .click();
    u.receive({
      type: "state",
      mode: "settings",
      connections: [connections[1]],
      preferences: defaults,
      host: "This computer",
    });
    u.click("Back to files");
    assert.equal(u.doc.getElementById("notice")?.textContent, "");
    assert.match(
      u.doc.getElementById("connectionControl")!.textContent!,
      /Second/,
    );
    assert.equal(
      (u.doc.getElementById("path") as HTMLInputElement).value,
      "/data",
    );
  } finally {
    u.dom.window.close();
  }
});

test("a delayed filename tooltip cannot replace an open menu", async () => {
  const u = ui();
  try {
    loadRows(u);
    const name = u.doc.querySelector(".file-label")!;
    name.dispatchEvent(new u.dom.window.MouseEvent("mouseenter"));
    u.doc.getElementById("connectionControl")!.click();
    name.dispatchEvent(new u.dom.window.MouseEvent("mouseenter"));
    await new Promise((resolve) => setTimeout(resolve, 420));
    assert.ok(u.doc.querySelector('[role="listbox"]'));
    assert.equal(u.doc.getElementById("filenameTooltip"), null);
  } finally {
    u.dom.window.close();
  }
});

test("removing the last connection clears its identity so a new connection can be created", () => {
  const u = ui("settings");
  try {
    u.receive({
      type: "state",
      mode: "settings",
      connections: [],
      preferences: defaults,
      host: "This computer",
    });
    u.fill("name", "New connection");
    u.fill("endpoint", "https://hdfs.example.org/webhdfs/v1");
    u.click("Save & open");
    assert.equal(u.messages.at(-1).connection.id, "");
  } finally {
    u.dom.window.close();
  }
});
test("webview ignores old directory response after newer navigation", () => {
  const u = ui();
  u.click("Open connection");
  const first = u.messages.at(-1);
  u.fill("path", "/new");
  u.doc
    .querySelector("form")!
    .dispatchEvent(new u.dom.window.Event("submit", { cancelable: true }));
  const second = u.messages.at(-1);
  u.receive({
    type: "listed",
    connection: "first",
    path: "/new",
    request: second.request,
  });
  u.receive({
    type: "listed",
    connection: "first",
    path: "/old",
    request: first.request,
  });
  assert.equal(
    (u.doc.getElementById("path") as HTMLInputElement).value,
    "/new",
  );
  u.dom.window.close();
});
test("filter sends current-folder paging only, and renders hostile filename as text", async () => {
  const u = ui();
  u.receive({ type: "listed", connection: "first", path: "/", revision: 1 });
  const hostile = "<img src=x onerror=alert(1)>.txt";
  u.receive({
    type: "page",
    revision: 1,
    pageRequest: u.messages.at(-1).pageRequest,
    connection: "first",
    path: "/",
    items: [
      { pathSuffix: hostile, type: "FILE", length: 5, modificationTime: 0 },
    ],
    total: 1,
    count: 1,
    page: 0,
    filter: "",
  });
  assert.equal(u.doc.querySelectorAll("img").length, 0);
  assert.ok(u.doc.body.textContent?.includes(hostile));
  u.fill("filter", "needle");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(JSON.parse(JSON.stringify(u.messages.at(-1))), {
    type: "page",
    filter: "needle",
    page: 0,
    pageSize: 50,
    sort: "name",
    descending: false,
    revision: 1,
    pageRequest: 2,
  });
  u.dom.window.close();
});
test("switching saved connections does not create spurious unsaved dialog", () => {
  const u = ui("settings");
  u.fill("editConnection", "second");
  u.doc
    .getElementById("editConnection")!
    .dispatchEvent(new u.dom.window.Event("change", { bubbles: true }));
  assert.equal(u.doc.querySelectorAll("dialog").length, 0);
  assert.equal(
    (u.doc.getElementById("name") as HTMLInputElement).value,
    "Second",
  );
  u.dom.window.close();
});
test("newly saved connection remains selected and language updates", () => {
  const u = ui("settings");
  u.receive({
    type: "state",
    mode: "settings",
    connections,
    preferences: { ...defaults, language: "zh-CN" },
    host: "本机",
  });
  u.receive({ type: "saved", id: "second" });
  assert.equal(
    (u.doc.getElementById("editConnection") as HTMLSelectElement).value,
    "second",
  );
  assert.equal(u.doc.documentElement.lang, "zh-CN");
  assert.equal(u.doc.getElementById("notice")!.hidden, true);
  u.dom.window.close();
});
test("settings command cannot silently discard unfinished input", () => {
  const u = ui("settings");
  u.fill("name", "Unsaved");
  u.receive({
    type: "state",
    mode: "settings",
    connections,
    preferences: defaults,
    host: "This computer",
  });
  assert.equal(
    (u.doc.getElementById("name") as HTMLInputElement).value,
    "Unsaved",
  );
  u.click("Back to files");
  assert.ok(u.doc.querySelector("dialog[open]"));
  u.click("Keep editing");
  assert.equal(
    (u.doc.getElementById("name") as HTMLInputElement).value,
    "Unsaved",
  );
  u.dom.window.close();
});
test("late directory results cannot replace an open settings form", () => {
  const u = ui("settings");
  u.fill("name", "Unsaved");
  u.receive({ type: "listed", connection: "first", path: "/" });
  assert.equal(
    (u.doc.getElementById("name") as HTMLInputElement).value,
    "Unsaved",
  );
  u.dom.window.close();
});
test("failed connection switch exposes no old file action on the new host", () => {
  const u = ui();
  u.receive({ type: "listed", connection: "first", path: "/", revision: 1 });
  u.receive({
    type: "page",
    revision: 1,
    pageRequest: u.messages.at(-1).pageRequest,
    connection: "first",
    path: "/",
    items: [
      { pathSuffix: "old.txt", type: "FILE", length: 5, modificationTime: 0 },
    ],
    total: 1,
    count: 1,
    page: 0,
    filter: "",
  });
  u.receive({ type: "loading", scope: "navigate" });
  u.receive({ type: "error", scope: "navigate", text: "Unreachable" });
  assert.equal(u.doc.querySelectorAll(".file-name").length, 0);
  assert.equal(
    u.doc.querySelector('[role="alert"] span')?.textContent,
    "Unreachable",
  );
  assert.equal(u.doc.getElementById("counts")?.textContent, "");
  assert.ok(!u.doc.body.textContent?.includes("This folder is empty."));
  u.dom.window.close();
});
test("every English UI string has a Chinese translation", async () => {
  const result = await build({
    entryPoints: ["web/strings.js"],
    bundle: true,
    format: "cjs",
    write: false,
  });
  const module = { exports: {} as any };
  new Function("module", "exports", result.outputFiles[0].text)(
    module,
    module.exports,
  );
  assert.deepEqual(
    Object.keys(module.exports.en).sort(),
    Object.keys(module.exports.zh).sort(),
  );
});

test("anonymous connection can submit without an invisible required username", () => {
  const u = ui("settings");
  u.fill("editConnection", "second");
  u.doc
    .getElementById("editConnection")!
    .dispatchEvent(new u.dom.window.Event("change"));
  assert.equal(
    (u.doc.getElementById("connectionForm") as HTMLFormElement).checkValidity(),
    true,
  );
  u.click("Save & open");
  assert.equal(u.messages.at(-1).connection.auth, "none");
  u.receive({
    type: "state",
    connections,
    preferences: defaults,
    host: "This computer",
    mode: "settings",
  });
  u.receive({ type: "saved", kind: "connection", id: "second" });
  assert.ok(u.doc.querySelector(".connection-dialog[open]"));
  u.doc
    .querySelector<HTMLButtonElement>(".connection-dialog .primary")!
    .click();
  assert.equal(u.messages.at(-1).type, "navigate");
  assert.equal(u.messages.at(-1).path, "/data");
  u.dom.window.close();
});

test("applying language works with an unfinished connection and preserves its secret only in memory", () => {
  const u = ui("settings");
  u.fill("name", "Draft");
  u.fill("endpoint", "");
  u.fill("secret", "temporary-private");
  u.fill("language", "zh-CN");
  assert.equal(u.messages.at(-1).key, "language");
  assert.equal(u.messages.at(-1).value, "zh-CN");
  assert.equal(u.messages.at(-1).connection, undefined);
  assert.equal(u.messages.at(-1).secret, undefined);
  u.ackPreference({ ...defaults, language: "zh-CN" });
  assert.equal(
    (u.doc.getElementById("name") as HTMLInputElement).value,
    "Draft",
  );
  assert.equal(
    (u.doc.getElementById("secret") as HTMLInputElement).value,
    "temporary-private",
  );
  assert.equal(u.doc.documentElement.lang, "zh-CN");
  assert.ok(!JSON.stringify(u.persisted() || {}).includes("temporary-private"));
  u.dom.window.close();
});

test("old errors and page responses cannot replace a refreshed listing of the same path", () => {
  const u = ui();
  u.click("Open connection");
  const first = u.messages.at(-1).request;
  u.receive({
    type: "listed",
    connection: "first",
    path: "/",
    revision: 1,
    request: first,
  });
  const oldPage = u.messages.at(-1).pageRequest;
  u.click("Refresh");
  const second = u.messages.at(-1).request;
  u.receive({
    type: "listed",
    connection: "first",
    path: "/",
    revision: 2,
    request: second,
  });
  assert.ok(!u.doc.body.textContent?.includes("This folder is empty"));
  const common = {
    type: "page",
    connection: "first",
    path: "/",
    filter: "",
    total: 1,
    count: 1,
    page: 0,
  };
  u.receive({
    ...common,
    revision: 2,
    pageRequest: u.messages.at(-1).pageRequest,
    items: [
      { pathSuffix: "fresh.txt", type: "FILE", length: 1, modificationTime: 0 },
    ],
  });
  u.receive({
    ...common,
    revision: 1,
    pageRequest: oldPage,
    items: [
      { pathSuffix: "stale.txt", type: "FILE", length: 1, modificationTime: 0 },
    ],
  });
  u.receive({
    type: "error",
    scope: "navigate",
    text: "Old failure",
    request: first,
  });
  assert.ok(u.doc.body.textContent?.includes("fresh.txt"));
  assert.ok(!u.doc.body.textContent?.includes("stale.txt"));
  assert.ok(!u.doc.body.textContent?.includes("Old failure"));
  u.dom.window.close();
});

test("keyboard navigation and preview retain the current list and focused row", () => {
  const u = ui();
  u.receive({ type: "listed", connection: "first", path: "/", revision: 1 });
  u.receive({
    type: "page",
    connection: "first",
    path: "/",
    revision: 1,
    pageRequest: u.messages.at(-1).pageRequest,
    filter: "",
    total: 2,
    count: 2,
    page: 0,
    items: ["one", "two"].map((pathSuffix) => ({
      pathSuffix,
      type: "FILE",
      length: 1,
      modificationTime: 0,
    })),
  });
  const names = u.doc.querySelectorAll<HTMLButtonElement>(".file-name");
  names[0].focus();
  names[0].dispatchEvent(
    new u.dom.window.KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(u.doc.activeElement, names[1]);
  names[1].click();
  assert.equal(u.messages.at(-1).type, "preview");
  assert.equal(u.messages.at(-1).path, "/two");
  assert.equal(u.doc.activeElement, names[1]);
  assert.equal(u.doc.querySelector(".file-name"), names[0]);
  u.dom.window.close();
});

test("keyboard path entry focuses the loaded list and sorting retains its control focus", () => {
  const u = ui();
  u.doc.getElementById("path")!.focus();
  u.fill("path", "/nested");
  u.doc
    .querySelector("form")!
    .dispatchEvent(new u.dom.window.Event("submit", { cancelable: true }));
  u.receive({
    type: "listed",
    connection: "first",
    path: "/nested",
    revision: 1,
    request: u.messages.at(-1).request,
  });
  const page = {
    type: "page",
    connection: "first",
    path: "/nested",
    revision: 1,
    filter: "",
    total: 1,
    count: 1,
    page: 0,
    items: [
      { pathSuffix: "file.txt", type: "FILE", length: 1, modificationTime: 0 },
    ],
  };
  u.receive({ ...page, pageRequest: u.messages.at(-1).pageRequest });
  assert.equal(u.doc.activeElement?.textContent, "file.txt");
  const sort = u.doc.querySelector<HTMLButtonElement>('[data-sort="size"]')!;
  sort.focus();
  sort.click();
  u.receive({ ...page, pageRequest: u.messages.at(-1).pageRequest });
  assert.equal((u.doc.activeElement as HTMLElement).dataset.sort, "size");
  u.dom.window.close();
});

function loadRows(
  u: ReturnType<typeof ui>,
  path = "/",
  entries = [
    { pathSuffix: "nested", type: "DIRECTORY", length: 0, modificationTime: 0 },
    { pathSuffix: "one.txt", type: "FILE", length: 123, modificationTime: 0 },
    { pathSuffix: "two.txt", type: "FILE", length: 456, modificationTime: 0 },
  ],
) {
  u.receive({ type: "listed", connection: "first", path, revision: 1 });
  u.receive({
    type: "page",
    connection: "first",
    path,
    revision: 1,
    pageRequest: u.messages.at(-1).pageRequest,
    filter: "",
    total: entries.length,
    count: entries.length,
    page: 0,
    items: entries,
  });
}
test("themeable selectors support keyboard choice, dismissal and readable authentication", () => {
  const u = ui("settings");
  try {
    const control = u.doc.getElementById("authControl") as HTMLButtonElement;
    assert.equal(u.doc.getElementById("auth")!.hidden, true);
    control.click();
    assert.equal(control.getAttribute("aria-expanded"), "true");
    assert.equal(
      u.doc.querySelectorAll('.select-options [role="option"]').length,
      5,
    );
    control.dispatchEvent(
      new u.dom.window.KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
      }),
    );
    control.dispatchEvent(
      new u.dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    assert.equal(
      (u.doc.getElementById("auth") as HTMLSelectElement).value,
      "basic",
    );
    assert.match(control.textContent!, /Username and password/);
    u.click("Authentication: Help");
    assert.match(
      u.doc.querySelector('[role="tooltip"]')!.textContent!,
      /gateways/,
    );
    assert.equal(u.doc.querySelector(".select-options"), null);
    control.click();
    control.dispatchEvent(
      new u.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    assert.equal(u.doc.querySelector(".select-options"), null);
    assert.equal(u.doc.activeElement, control);
    assert.equal(
      u.messages.some((m) => m.type === "save"),
      false,
    );
  } finally {
    u.dom.window.close();
  }
});
test("number steppers honor bounds and per-field help is available by click and keyboard", () => {
  const u = ui("settings");
  try {
    assert.equal(u.doc.querySelector("details.preview-help"), null);
    u.click("Increase Text preview limit (MiB)");
    assert.equal(
      (u.doc.getElementById("textLimit") as HTMLInputElement).value,
      "2",
    );
    u.fill("textLimit", "4");
    assert.equal(
      u.doc.querySelector<HTMLButtonElement>(
        '[aria-label="Increase Text preview limit (MiB)"]',
      )!.disabled,
      true,
    );
    u.click("Text preview limit (MiB): Limit details");
    assert.match(
      u.doc.querySelector('[role="tooltip"]')!.textContent!,
      /1–4 MiB/,
    );
    u.doc.dispatchEvent(
      new u.dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    assert.equal(u.doc.querySelector('[role="tooltip"]'), null);
    assert.equal(u.doc.getElementById("diagnostics"), null);
    assert.ok(u.doc.getElementById("timeout")!.closest(".network-settings"));
  } finally {
    u.dom.window.close();
  }
});
test("preferences validate immediately, skip invalid numbers, and survive late saves", async () => {
  const u = ui("settings");
  try {
    assert.equal(u.doc.getElementById("savePreferences"), null);
    const input = u.doc.getElementById("mediaLimit") as HTMLInputElement;
    u.fill("mediaLimit", "2.5");
    assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.match(
      u.doc.getElementById("mediaLimitError")!.textContent!,
      /1 to 50 MiB/,
    );
    u.savePreference("mediaLimit");
    assert.ok(!u.messages.some((m) => m.type === "savePreference"));
    u.fill("mediaLimit", "4");
    u.fill("mediaLimit", "40");
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.deepEqual(
      u.messages.filter((m) => m.type === "savePreference").map((m) => m.value),
      [40 * 1048576],
    );
    assert.equal(input.getAttribute("aria-invalid"), null);
    u.fill("mediaLimit", "51");
    u.ackPreference({ ...defaults, mediaLimit: 40 * 1048576 });
    assert.equal(input.value, "51");
    assert.equal(input.getAttribute("aria-invalid"), "true");
    u.fill("mediaLimit", "48");
    u.savePreference("mediaLimit");
    assert.equal(u.messages.at(-1).value, 48 * 1048576);
  } finally {
    u.dom.window.close();
  }
});
test("Auto is first and settings help stays beside the associated labels", () => {
  const u = ui("settings");
  try {
    const language = u.doc.getElementById("language") as HTMLSelectElement;
    assert.deepEqual(
      Array.from(language.options, (option) => option.value),
      ["auto", "en", "zh-CN"],
    );
    u.fill("language", "auto");
    u.ackPreference({ ...defaults, language: "zh-CN" }, "auto");
    assert.equal(
      (u.doc.getElementById("language") as HTMLSelectElement).value,
      "auto",
    );
    assert.equal(u.doc.getElementById("languageControl")!.textContent, "Auto");
    assert.equal(u.doc.documentElement.lang, "zh-CN");
    for (const [label, pattern] of [
      ["API 基础地址: 说明", /\/webhdfs\/v1/],
      ["身份认证: 说明", /WebHDFS 简单认证/],
      ["超时时间（秒）: 上限说明", /2 到 300/],
      ["仅只读: 说明", /暂不提供原地改写文件功能/],
    ] as const) {
      const guide = u.doc.querySelector(`button[aria-label="${label}"]`)!;
      assert.ok(guide.closest(".field-label")?.querySelector("label"));
      guide.dispatchEvent(new u.dom.window.MouseEvent("mouseenter"));
      assert.match(
        u.doc.querySelector('[role="tooltip"]')!.textContent!,
        pattern,
      );
    }
    assert.equal(
      (u.doc.getElementById("readOnly") as HTMLInputElement).checked,
      false,
    );
    assert.doesNotMatch(
      u.doc.body.textContent!,
      /主机范围内|Profile 内共享|编辑器安全存储/,
    );
  } finally {
    u.dom.window.close();
  }
});
test("page size defaults to 50, retains the current item interval, persists and rejects an old response", () => {
  const u = ui();
  try {
    loadRows(u);
    const reply = {
      type: "page",
      connection: "first",
      path: "/",
      revision: 1,
      filter: "",
      count: 450,
      total: 450,
      page: 2,
      items: [],
    };
    u.receive({ ...reply, pageRequest: u.messages.at(-1).pageRequest });
    const control = u.doc.getElementById("pageSizeControl")!;
    assert.match(control.textContent!, /50/);
    control.click();
    const options = [
      ...u.doc.querySelectorAll<HTMLElement>('.select-options [role="option"]'),
    ];
    assert.deepEqual(
      options.map((n) => n.textContent),
      ["10 / page", "20 / page", "50 / page", "100 / page", "200 / page"],
    );
    options[1].click();
    const requested = u.messages.at(-1);
    assert.equal(requested.pageSize, 20);
    assert.equal(requested.page, 5);
    assert.equal(u.persisted().pageSize, 20);
    u.receive({ ...reply, page: 0, pageRequest: requested.pageRequest - 1 });
    u.receive({ ...reply, page: 5, pageRequest: requested.pageRequest });
    assert.equal(
      u.doc.querySelector(".page-position")!.textContent,
      "Page 6 / 23",
    );
    assert.equal(u.doc.activeElement?.id, "pageSizeControl");
  } finally {
    u.dom.window.close();
  }
});
test("settings return arrow restores the prior list scroll and unfinished path", () => {
  const u = ui();
  try {
    loadRows(u);
    u.doc.getElementById("files")!.scrollTop = 72;
    u.fill("path", "/unfinished");
    u.click("Settings");
    assert.ok(u.doc.querySelector('.brand button[aria-label="Back to files"]'));
    u.click("Back to files");
    assert.equal(u.doc.getElementById("files")!.scrollTop, 72);
    assert.equal(
      (u.doc.getElementById("path") as HTMLInputElement).value,
      "/unfinished",
    );
    assert.equal(
      u.messages.some((m) => m.type === "navigate"),
      false,
    );
  } finally {
    u.dom.window.close();
  }
});
test("whole rows select and preview files; folder metadata double-click opens exactly once", () => {
  const u = ui();
  loadRows(u);
  const rows = u.doc.querySelectorAll<HTMLElement>(".file-row");
  rows[0].querySelector<HTMLElement>(".size")!.click();
  assert.equal(rows[0].getAttribute("aria-selected"), "true");
  assert.equal(u.messages.filter((m) => m.type === "navigate").length, 0);
  rows[1].querySelector<HTMLElement>(".modified")!.click();
  assert.equal(u.messages.at(-1).path, "/one.txt");
  assert.equal(u.messages.at(-1).inline, true);
  const before = u.messages.length;
  rows[1].dispatchEvent(
    new u.dom.window.MouseEvent("dblclick", { bubbles: true }),
  );
  assert.equal(u.messages.length, before);
  assert.equal(u.doc.querySelectorAll(".file-row").length, 3);
  rows[0]
    .querySelector<HTMLElement>(".size")!
    .dispatchEvent(new u.dom.window.MouseEvent("dblclick", { bubbles: true }));
  assert.equal(u.messages.at(-1).type, "navigate");
  assert.equal(u.messages.at(-1).path, "/nested");
  assert.equal(u.messages.filter((m) => m.type === "navigate").length, 1);
  u.dom.window.close();
});
test("inline preview ignores late responses, closes with Escape and restores the same row", async () => {
  const u = ui();
  loadRows(u);
  u.click("one.txt");
  const first = u.messages.at(-1).previewRequest;
  u.click("two.txt");
  const second = u.messages.at(-1).previewRequest;
  const result = (id: number, path: string, text: string) =>
    u.receive({
      type: "previewResult",
      previewRequest: id,
      content: {
        type: "content",
        kind: "text",
        path,
        language: "en",
        data: text,
        size: 12,
      },
    });
  result(second, "/two.txt", "new file content");
  result(first, "/one.txt", "stale file content");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    u.doc
      .querySelector("#previewPane")!
      .textContent?.includes("new file content"),
  );
  assert.ok(!u.doc.body.textContent?.includes("stale file content"));
  const row = u.doc.querySelector('.file-row[data-path="/two.txt"]');
  u.doc.getElementById("path")!.focus();
  u.receive({ type: "focusFiles" });
  assert.equal(u.doc.activeElement, row!.querySelector(".file-name"));
  u.doc.activeElement!.dispatchEvent(
    new u.dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(u.doc.querySelector<HTMLElement>("#previewPane")!.hidden, true);
  assert.equal(u.doc.activeElement, row!.querySelector(".file-name"));
  result(second, "/two.txt", "closed preview must stay closed");
  assert.ok(
    !u.doc.body.textContent?.includes("closed preview must stay closed"),
  );
  u.dom.window.close();
});
test("row actions do not open files; parent control and keyboard return to the actual parent", () => {
  const u = ui();
  loadRows(u, "/nested");
  u.click("Download: one.txt");
  assert.equal(u.messages.at(-1).type, "download");
  assert.equal(u.messages.filter((m) => m.type === "preview").length, 0);
  // Whitespace in the action cell is still part of the row; only its buttons are independent.
  u.doc
    .querySelector<HTMLElement>(
      '.file-row[data-path="/nested/one.txt"] .row-actions',
    )!
    .click();
  assert.equal(u.messages.at(-1).type, "preview");
  assert.equal(u.messages.at(-1).path, "/nested/one.txt");
  u.click("File information: nested");
  assert.ok(u.doc.querySelector("dialog[open]"));
  u.click("Close");
  u.click("Parent folder");
  assert.equal(u.messages.at(-1).path, "/");
  loadRows(u, "/a/b");
  const name = u.doc.querySelector<HTMLElement>(".file-name")!;
  name.focus();
  name.dispatchEvent(
    new u.dom.window.KeyboardEvent("keydown", {
      key: "ArrowUp",
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(u.messages.at(-1).path, "/a");
  u.dom.window.close();
});
test("limited previews show their actual limit and an actionable settings entry", () => {
  const u = ui();
  loadRows(u);
  u.click("one.txt");
  u.receive({
    type: "previewResult",
    previewRequest: u.messages.at(-1).previewRequest,
    content: {
      type: "limited",
      path: "/one.txt",
      language: "en",
      size: 40 * 1048576,
      limit: 20 * 1048576,
    },
  });
  const pane = u.doc.querySelector<HTMLElement>("#previewPane")!;
  assert.ok(pane.textContent?.includes("Current limit: 20.0 MiB"));
  [...pane.querySelectorAll("button")]
    .find((b) => b.textContent === "Adjust preview limit")!
    .click();
  assert.ok(u.doc.getElementById("mediaLimit"));
  assert.equal(u.messages.at(-1).type, "cancelPreview");
  u.dom.window.close();
});
test("cancelled inline reads can retry without a late response replacing the cancellation", () => {
  const u = ui();
  loadRows(u);
  u.click("one.txt");
  const old = u.messages.at(-1).previewRequest;
  u.click("Cancel");
  assert.ok(
    u.doc.querySelector("#previewPane")!.textContent?.includes("Cancelled"),
  );
  u.receive({
    type: "previewResult",
    previewRequest: old,
    content: {
      type: "content",
      kind: "text",
      language: "en",
      path: "/one.txt",
      data: "old data",
    },
  });
  assert.ok(!u.doc.body.textContent?.includes("old data"));
  u.click("Retry");
  assert.equal(u.messages.at(-1).type, "preview");
  assert.ok(u.messages.at(-1).previewRequest > old);
  u.dom.window.close();
});
test("native context menu selects the whole row without reading; commands retain their exact target", () => {
  const u = ui();
  loadRows(u);
  const row = u.doc.querySelector<HTMLElement>(
    '.file-row[data-path="/two.txt"]',
  )!;
  row
    .querySelector(".size")!
    .dispatchEvent(
      new u.dom.window.MouseEvent("contextmenu", { bubbles: true }),
    );
  assert.equal(row.getAttribute("aria-selected"), "true");
  assert.equal(u.messages.filter((m) => m.type === "preview").length, 0);
  const context = JSON.parse(row.dataset.vscodeContext!);
  assert.equal(context.webviewSection, "file");
  assert.equal(context.preventDefaultContextMenuItems, true);
  const action = (action: string, extra = {}) =>
    u.receive({
      type: "contextAction",
      action,
      connection: context.hdfsConnection,
      path: context.hdfsPath,
      revision: context.hdfsRevision,
      ...extra,
    });
  action("copyName");
  assert.equal(u.messages.at(-1).nameOnly, true);
  assert.equal(u.messages.at(-1).path, "/two.txt");
  action("download");
  assert.equal(u.messages.at(-1).type, "download");
  action("info");
  assert.match(u.doc.querySelector("dialog")!.textContent!, /two.txt/);
  u.click("Close");
  action("preview");
  assert.equal(u.messages.at(-1).inline, true);
  const before = u.messages.length;
  action("download", { revision: -1 });
  assert.equal(u.messages.length, before);
  action("openFolder", { path: "/nested" });
  assert.equal(u.messages.at(-1).type, "navigate");
  assert.equal(u.messages.at(-1).path, "/nested");
  u.dom.window.close();
});
test("failed navigation offers recovery for the attempted path and keeps diagnostics out of the footer", () => {
  const u = ui();
  loadRows(u);
  u.fill("path", "/missing/child");
  u.click("Go");
  u.receive({
    type: "error",
    scope: "navigate",
    request: u.messages.at(-1).request,
    text: "Missing",
    code: "missing",
  });
  for (const label of ["Refresh", "Parent folder"]) {
    const control = [...u.doc.querySelectorAll("button")].find(
      (b) => b.textContent === label || b.getAttribute("aria-label") === label,
    )!;
    assert.equal(control.disabled, false, label);
  }
  assert.equal(
    u.doc.querySelector("footer")?.textContent?.includes("Check connection"),
    false,
  );
  assert.equal(
    [...u.doc.querySelectorAll("#notice button")].some(
      (b) => b.textContent === "Settings",
    ),
    false,
  );
  u.click("Refresh");
  assert.equal(u.messages.at(-1).path, "/missing/child");
  u.receive({
    type: "error",
    scope: "navigate",
    request: u.messages.at(-1).request,
    text: "Missing",
  });
  u.click("Parent folder");
  assert.equal(u.messages.at(-1).path, "/missing");
  u.dom.window.close();
});
test("keyboard context menu opens on selected row and connection settings preserve unsaved input", () => {
  const u = ui();
  loadRows(u);
  const row = u.doc.querySelector<HTMLElement>(".file-row")!;
  let events = 0;
  row.addEventListener("contextmenu", () => events++);
  row.querySelector("button")!.dispatchEvent(
    new u.dom.window.KeyboardEvent("keydown", {
      key: "F10",
      shiftKey: true,
      bubbles: true,
    }),
  );
  assert.equal(events, 1);
  u.click("Settings");
  u.fill("name", "Unfinished");
  u.receive({
    type: "state",
    mode: "settings",
    editConnection: "second",
    connections,
    preferences: defaults,
    host: "This computer",
  });
  assert.equal(
    (u.doc.getElementById("name") as HTMLInputElement).value,
    "Unfinished",
  );
  u.click("Discard changes");
  assert.equal(
    (u.doc.getElementById("name") as HTMLInputElement).value,
    "Second",
  );
  u.dom.window.close();
});

test("adjusting a preview limit returns to the exact file without reloading the directory", () => {
  const u = ui();
  try {
    loadRows(u);
    u.click("one.txt");
    const old = u.messages.at(-1).previewRequest;
    u.receive({
      type: "previewResult",
      previewRequest: old,
      content: {
        type: "limited",
        path: "/one.txt",
        language: "en",
        size: 30 * 1048576,
        limit: 20 * 1048576,
      },
    });
    u.doc.getElementById("files")!.scrollTop = 120;
    u.click("Adjust preview limit");
    assert.equal(u.doc.activeElement?.id, "mediaLimit");
    assert.ok(u.doc.querySelector('button[aria-label="Back to preview"]'));
    u.fill("mediaLimit", "40");
    const before = u.messages.length;
    u.click("Back to preview");
    assert.equal(u.messages.at(-1).type, "savePreference");
    assert.equal(u.messages.at(-1).value, 40 * 1048576);
    assert.ok(u.doc.getElementById("preferencesForm"));
    u.ackPreference({ ...defaults, mediaLimit: 40 * 1048576 });
    assert.equal(u.messages.at(-1).type, "preview");
    assert.equal(u.messages.at(-1).path, "/one.txt");
    assert.equal(u.messages.at(-1).connection, "first");
    assert.ok(u.messages.at(-1).previewRequest > old);
    assert.equal(
      u.messages.slice(before).filter((m) => m.type === "navigate").length,
      0,
    );
    assert.equal(u.doc.getElementById("files")!.scrollTop, 120);
    assert.equal(
      u.doc
        .querySelector('.file-row[data-path="/one.txt"]')
        ?.getAttribute("aria-selected"),
      "true",
    );
  } finally {
    u.dom.window.close();
  }
});

test("standalone preview settings retain the originating file and return after saving", () => {
  const u = ui();
  try {
    loadRows(u);
    u.receive({
      type: "state",
      mode: "settings",
      connections,
      preferences: defaults,
      host: "This computer",
      editConnection: "second",
      settingsFocus: "textLimit",
      previewReturn: { connection: "second", path: "/data/report.json" },
    });
    assert.equal(u.doc.activeElement?.id, "textLimit");
    u.fill("textLimit", "2");
    u.savePreference("textLimit");
    u.ackPreference({ ...defaults, textLimit: 2 * 1048576 });
    assert.ok(u.doc.getElementById("preferencesForm"));
    u.click("Back to preview");
    assert.equal(u.messages.at(-1).type, "preview");
    assert.equal(u.messages.at(-1).connection, "second");
    assert.equal(u.messages.at(-1).path, "/data/report.json");
    assert.equal(u.messages.at(-1).inline, undefined);
  } finally {
    u.dom.window.close();
  }
});

test("save and open checks current input in a cancellable modal; late failures cannot replace a retry", () => {
  const u = ui("settings");
  try {
    assert.equal(u.doc.getElementById("save"), null);
    assert.equal(u.doc.getElementById("diagnosticContent"), null);
    u.fill("name", "Edited without saving");
    u.click("Save & open");
    const first = u.messages.at(-1);
    assert.equal(first.check, true);
    assert.equal(first.connection.name, "Edited without saving");
    assert.ok(u.doc.querySelector(".connection-dialog .spinner"));
    u.doc
      .querySelector(".connection-dialog")!
      .dispatchEvent(new u.dom.window.Event("cancel", { cancelable: true }));
    assert.equal(u.messages.at(-1).type, "cancelSave");
    assert.match(
      u.doc.querySelector(".connection-dialog")!.textContent!,
      /Cancelling/,
    );
    assert.equal(
      u.doc.querySelector<HTMLButtonElement>("#saveOpen")!.disabled,
      true,
    );
    u.receive({
      type: "error",
      scope: "save",
      request: first.request,
      code: "cancelled",
    });
    assert.equal(u.doc.querySelector(".connection-dialog"), null);
    u.click("Save & open");
    const retry = u.messages.at(-1);
    u.receive({
      type: "error",
      scope: "save",
      request: first.request,
      text: "stale failure",
    });
    assert.ok(!u.doc.body.textContent?.includes("stale failure"));
    u.receive({
      type: "error",
      scope: "save",
      request: retry.request,
      text: "Check the service address.",
    });
    assert.match(
      u.doc.querySelector(".connection-dialog [role=alert]")!.textContent!,
      /service address/,
    );
    assert.ok(!u.doc.getElementById("notice")?.textContent);
    u.doc
      .querySelector<HTMLButtonElement>(".connection-dialog .primary")!
      .click();
    assert.equal(
      (u.doc.getElementById("name") as HTMLInputElement).value,
      "Edited without saving",
    );
    assert.equal(
      (u.doc.getElementById("saveOpen") as HTMLButtonElement).disabled,
      false,
    );
  } finally {
    u.dom.window.close();
  }
});

test("correcting authentication reloads the folder then retries the originating preview", () => {
  const u = ui();
  try {
    loadRows(u);
    u.click("one.txt");
    u.receive({
      type: "previewResult",
      previewRequest: u.messages.at(-1).previewRequest,
      content: {
        type: "error",
        code: "unauthorized",
        text: "Authentication failed.",
        language: "en",
        path: "/one.txt",
      },
    });
    u.click("Edit authentication");
    u.fill("username", "reader");
    u.click("Save & open");
    assert.equal(u.messages.at(-1).connection.username, "reader");
    u.receive({
      type: "state",
      mode: "settings",
      connections: connections.map((c) =>
        c.id === "first" ? { ...c, username: "reader" } : c,
      ),
      preferences: defaults,
      host: "This computer",
    });
    u.receive({ type: "saved", kind: "connection", id: "first" });
    u.doc
      .querySelector<HTMLButtonElement>(".connection-dialog .primary")!
      .click();
    assert.equal(u.messages.at(-1).type, "navigate");
    assert.equal(u.messages.at(-1).path, "/");
    u.receive({
      type: "listed",
      request: u.messages.at(-1).request,
      connection: "first",
      path: "/",
      revision: 2,
      total: 1,
    });
    u.receive({
      type: "page",
      connection: "first",
      path: "/",
      revision: 2,
      pageRequest: u.messages.at(-1).pageRequest,
      filter: "",
      count: 1,
      total: 1,
      page: 0,
      items: [
        {
          pathSuffix: "one.txt",
          type: "FILE",
          length: 10,
          modificationTime: 0,
        },
      ],
    });
    assert.equal(u.messages.at(-1).type, "preview");
    assert.equal(u.messages.at(-1).path, "/one.txt");
    assert.equal(u.messages.at(-1).connection, "first");
  } finally {
    u.dom.window.close();
  }
});

test("preview errors focus the relevant setting; unsupported files have a direct download without a second preview entry", () => {
  const u = ui();
  try {
    loadRows(u);
    u.click("one.txt");
    u.receive({
      type: "previewResult",
      previewRequest: u.messages.at(-1).previewRequest,
      content: {
        type: "error",
        code: "unauthorized",
        text: "Authentication failed.",
        language: "en",
        path: "/one.txt",
      },
    });
    assert.ok(
      !u.doc.querySelector("#previewPane")?.textContent?.includes("Retry"),
    );
    u.click("Edit authentication");
    assert.equal(u.doc.activeElement?.id, "authControl");
    u.click("Back to preview");
    u.receive({
      type: "previewResult",
      previewRequest: u.messages.at(-1).previewRequest,
      content: {
        type: "binary",
        language: "en",
        path: "/one.txt",
        size: 20,
      },
    });
    assert.equal(
      u.doc.querySelector(
        '#previewPane [aria-label="Open preview in editor tab"]',
      ),
      null,
    );
    assert.equal(
      u.doc.querySelector(
        '#previewPane .preview-actions [aria-label="Download original"]',
      ),
      null,
    );
    const action = [
      ...u.doc.querySelectorAll<HTMLButtonElement>(
        "#previewPane .actions button",
      ),
    ].find((b) => b.textContent === "Download original");
    assert.ok(action);
    action.click();
    assert.equal(u.messages.at(-1).type, "download");
    assert.equal(u.messages.at(-1).path, "/one.txt");
  } finally {
    u.dom.window.close();
  }
});

test("multi-select does not preview, keeps a batch target and clears on navigation; read-only settings persist", () => {
  const u = ui();
  try {
    loadRows(u);
    const checks = u.doc.querySelectorAll<HTMLInputElement>(
      "tbody input[type=checkbox]",
    );
    const before = u.messages.length;
    checks[1].click();
    assert.equal(u.messages.length, before);
    assert.match(
      u.doc.getElementById("selectionActions")!.textContent!,
      /1 selected/,
    );
    u.doc
      .querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]")[2]
      .click();
    assert.match(
      u.doc.getElementById("selectionActions")!.textContent!,
      /2 selected/,
    );
    const download = [
      ...u.doc.querySelectorAll<HTMLButtonElement>("#selectionActions button"),
    ].find((b) => b.textContent === "Download")!;
    download.click();
    assert.equal(u.doc.querySelector("dialog"), null);
    assert.equal(u.messages.at(-1).target, "local");
    assert.equal(u.messages.at(-1).policy, undefined);
    assert.deepEqual(Array.from(u.messages.at(-1).paths), [
      "/one.txt",
      "/two.txt",
    ]);
  } finally {
    u.dom.window.close();
  }
  const settings = ui("settings");
  try {
    const check = settings.doc.getElementById("readOnly") as HTMLInputElement;
    assert.equal(check.checked, false);
    check.click();
    settings.click("Save & open");
    assert.equal(settings.messages.at(-1).connection.readOnly, true);
  } finally {
    settings.dom.window.close();
  }
});
test("upload source pills retain a clear target and errors preserve the selected-file dialog", () => {
  const u = ui();
  try {
    u.receive({
      type: "state",
      connections,
      preferences: defaults,
      remote: true,
      hostName: "example-ssh",
      host: "Remote host",
    });
    loadRows(u);
    u.click("Upload");
    u.click("example-ssh");
    u.click("Choose files");
    assert.equal(u.messages.at(-1).target, "host");
    const pickerRequest = u.messages.at(-1).request;
    u.receive({
      type: "uploadSelected",
      request: pickerRequest,
      target: "host",
      roots: [{ name: "example.csv", size: 10, type: "FILE" }],
    });
    const d = u.doc.querySelector("dialog")!;
    assert.match(d.textContent!, /example.csv/);
    const start = [...d.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Upload",
    )!;
    assert.equal(start.disabled, false);
    start.click();
    assert.equal(u.messages.at(-1).direction, "upload");
    u.receive({
      type: "taskError",
      request: u.messages.at(-1).request,
      text: "Try a different folder.",
    });
    assert.equal(u.doc.querySelector("dialog"), d);
    assert.match(d.textContent!, /example.csv/);
    assert.match(d.textContent!, /Try a different folder/);
  } finally {
    u.dom.window.close();
  }
});

test("Shift-clicking row checkboxes selects a range and keeps keyboard focus without previewing", () => {
  const u = ui();
  try {
    loadRows(u);
    let boxes = u.doc.querySelectorAll<HTMLInputElement>(
      "tbody input[type=checkbox]",
    );
    boxes[0].click();
    const before = u.messages.length;
    boxes = u.doc.querySelectorAll<HTMLInputElement>(
      "tbody input[type=checkbox]",
    );
    boxes[2].dispatchEvent(
      new u.dom.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        shiftKey: true,
      }),
    );
    assert.match(
      u.doc.getElementById("selectionActions")!.textContent!,
      /3 selected/,
    );
    assert.equal(
      u.doc.activeElement?.getAttribute("aria-label"),
      "Select two.txt",
    );
    assert.equal(u.messages.length, before);
    assert.ok(
      !u.doc.getElementById("selectionActions")!.textContent!.includes("null"),
    );
  } finally {
    u.dom.window.close();
  }
});

test("file and folder stars are independent of selection; favorites locate the row in its parent", () => {
  const u = ui();
  try {
    loadRows(u);
    const fileStar = u.doc.querySelector<HTMLButtonElement>(
      '[data-star="/one.txt"]',
    )!;
    fileStar.click();
    assert.equal(fileStar.getAttribute("aria-pressed"), "true");
    assert.equal(u.messages.at(-1).action, "set");
    assert.equal(u.messages.at(-1).entryType, "FILE");
    assert.equal(u.messages.at(-1).active, true);
    const places = {
      first: {
        favorites: [{ name: "one.txt", path: "/one.txt", type: "FILE" }],
        recent: [{ path: "/ignored" }],
      },
    };
    u.receive({ type: "places", places });
    u.click("Favorites");
    assert.ok(u.doc.querySelector(".favorites-list"));
    assert.doesNotMatch(u.doc.body.textContent!, /Recent|ignored/);
    u.click("one.txt");
    assert.equal(u.messages.at(-1).path, "/");
    const request = u.messages.at(-1).request;
    u.receive({
      type: "listed",
      connection: "first",
      path: "/",
      total: 101,
      revision: 200,
      request,
    });
    assert.equal(u.messages.at(-1).focusName, "one.txt");
    u.receive({
      type: "page",
      connection: "first",
      path: "/",
      filter: "",
      revision: 200,
      pageRequest: u.messages.at(-1).pageRequest,
      page: 2,
      total: 101,
      count: 101,
      focusFound: true,
      items: [
        { pathSuffix: "one.txt", type: "FILE", length: 1, modificationTime: 0 },
      ],
    });
    const row = u.doc.querySelector('[data-path="/one.txt"]')!;
    assert.equal(row.getAttribute("aria-selected"), "true");
    assert.equal(u.doc.activeElement, row.querySelector(".file-name"));
    row.querySelector<HTMLButtonElement>("[data-star]")!.click();
    assert.equal(u.messages.at(-1).active, false);
  } finally {
    u.dom.window.close();
  }
});

test("upload shows a clean local picker flow, preserves selection on cancel and ignores old responses", () => {
  const u = ui();
  try {
    loadRows(u);
    u.click("Upload");
    const modal = u.doc.querySelector("dialog")!;
    assert.doesNotMatch(
      modal.textContent!,
      /null|If a file exists|Choose files or a folder/,
    );
    assert.equal(modal.querySelector("[role=radiogroup]"), null);
    u.click("Choose files");
    const first = u.messages.at(-1).request;
    u.receive({
      type: "uploadSelected",
      request: first,
      target: "local",
      roots: [{ name: "sample.json", type: "FILE", size: 25 }],
    });
    assert.match(
      modal.querySelector(".transfer-summary")!.textContent!,
      /sample.json/,
    );
    u.click("Choose folder");
    const next = u.messages.at(-1).request;
    u.receive({ type: "uploadChoiceCancelled", request: first });
    assert.equal(
      modal.querySelector<HTMLButtonElement>("button.primary")!.disabled,
      true,
    );
    u.receive({ type: "uploadChoiceCancelled", request: next });
    assert.equal(
      modal.querySelector<HTMLButtonElement>("button.primary")!.disabled,
      false,
    );
    assert.match(
      modal.querySelector(".transfer-summary")!.textContent!,
      /sample.json/,
    );
  } finally {
    u.dom.window.close();
  }
});

test("a source-picker error preserves the dialog without enabling an upload with no source", () => {
  const u = ui();
  try {
    loadRows(u);
    u.click("Upload");
    u.click("Choose files");
    u.receive({
      type: "taskError",
      request: u.messages.at(-1).request,
      text: "Choose an actual file.",
    });
    const dialog = u.doc.querySelector("dialog")!;
    assert.equal(
      [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "Upload",
      )!.disabled,
      true,
    );
    assert.match(dialog.textContent!, /Choose an actual file/);
    u.click("Choose files");
    assert.equal(u.messages.at(-1).action, "chooseUpload");
  } finally {
    u.dom.window.close();
  }
});

test("transfer progress preserves the cancel node and keyboard focus", () => {
  const u = ui();
  try {
    loadRows(u);
    u.click("Transfers");
    const job = {
      id: "live",
      connection: "first",
      direction: "download",
      target: "local",
      folder: "/example",
      name: "large.bin",
      status: "running",
      done: 0,
      failed: 0,
      skipped: 0,
      bytes: 1048576,
      current: "large.bin",
    };
    u.receive({ type: "tasks", jobs: [job], recoveryCount: 0 });
    const cancel = u.doc.querySelector<HTMLButtonElement>(
      '[data-job="live"] button',
    )!;
    cancel.focus();
    u.receive({
      type: "tasks",
      jobs: [{ ...job, bytes: 2097152 }],
      recoveryCount: 0,
    });
    assert.equal(u.doc.querySelector('[data-job="live"] button'), cancel);
    assert.equal(u.doc.activeElement, cancel);
    assert.match(
      u.doc.querySelector(".transfer-progress")!.textContent!,
      /2.0 MiB/,
    );
    cancel.click();
    assert.equal(u.messages.at(-1).action, "cancel");
    assert.equal(u.messages.at(-1).id, "live");
    u.receive({
      type: "tasks",
      jobs: [{ ...job, status: "cancelled", current: undefined }],
    });
    const [copy, open] = u.doc.querySelectorAll<HTMLButtonElement>(
      '[data-job="live"] button',
    );
    assert.equal(copy.textContent, "Copy path");
    assert.equal(open.textContent, "Open location");
    copy.click();
    assert.deepEqual(
      { ...u.messages.at(-1) },
      { type: "task", action: "copyLocation", id: "live" },
    );
    u.receive({ type: "taskLocationCopied", id: "live" });
    assert.equal(copy.textContent, "Copied");
  } finally {
    u.dom.window.close();
  }
});

test("transfers dismisses on an outside pointer press without reopening on the trigger", () => {
  const u = ui();
  try {
    loadRows(u);
    const trigger = u.doc.getElementById("openTransfers") as HTMLButtonElement;
    const panel = () => u.doc.querySelector(".transfer-panel");
    const press = (target: Element) =>
      target.dispatchEvent(
        new u.dom.window.Event("pointerdown", { bubbles: true }),
      );
    trigger.click();
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    const download = {
      id: "example",
      direction: "download",
      name: "Example",
      status: "completed",
      done: 0,
      skipped: 4,
      failed: 0,
      failedFiles: 0,
    };
    const progress = () =>
      panel()!.querySelector(".transfer-progress")!.textContent;
    u.receive({ type: "tasks", jobs: [download] });
    assert.equal(progress(), "Completed · 4 files skipped");
    u.receive({
      type: "tasks",
      jobs: [{ ...download, done: 5, failedFiles: undefined }],
    });
    assert.equal(progress(), "Completed");
    press(panel()!.querySelector(".transfer-list")!);
    assert.ok(panel());
    press(trigger);
    trigger.click();
    assert.equal(panel(), null);
    trigger.click();
    press(u.doc.querySelector(".folderbar")!);
    assert.equal(panel(), null);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    u.receive({ type: "tasks", jobs: [] });
    assert.equal(panel(), null);
    trigger.click();
    panel()!.querySelector<HTMLButtonElement>('[data-action="close"]')!.click();
    assert.equal(u.doc.activeElement, trigger);
  } finally {
    u.dom.window.close();
  }
});
