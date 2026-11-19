import { before, test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

let source: string;
before(async () => {
  const result = await build({
    entryPoints: ["web/preview-content.js"],
    bundle: true,
    format: "iife",
    globalName: "Preview",
    footer: { js: "window.Preview = Preview;" },
    write: false,
    define: { "import.meta.url": '"https://fixture.invalid/preview.js"' },
    plugins: [
      {
        name: "pdf-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^\.\/pdf\.mjs$/ }, () => ({
            path: "pdf",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export const PDFWorker = window.pdfFixture.PDFWorker; export const getDocument = window.pdfFixture.getDocument;",
          }));
        },
      },
    ],
  });
  source = result.outputFiles[0].text;
});

function setup(numPages = 2, pageSize = { width: 400, height: 600 }) {
  const dom = new JSDOM('<main id="app"></main>', {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window as any;
  w.MessageChannel = MessageChannel;
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({
    top: 0,
    bottom: 20,
    left: 0,
    right: 400,
    width: 400,
    height: 20,
  });
  const counts = {
    assets: 0,
    workers: 0,
    documents: 0,
    destroyed: 0,
    terminated: 0,
    text: 0,
    render: 0,
    cancelled: 0,
    active: 0,
    maxActive: 0,
    imageBudget: 0,
    requestedPages: [] as number[],
  };
  let failRender = false;
  let hangDestroy = false;
  let documentGate: Promise<any> | undefined;
  let renderGate: Promise<void> | undefined;
  let intersections: any;
  let resize: () => void;
  let layoutWidth = 400;
  w.IntersectionObserver = class {
    constructor(callback: any) {
      intersections = callback;
    }
    observe() {}
    disconnect() {
      intersections = undefined;
    }
  };
  w.ResizeObserver = class {
    constructor(callback: any) {
      resize = callback;
    }
    observe() {}
    disconnect() {}
  };
  Object.defineProperty(w.HTMLElement.prototype, "clientWidth", {
    get: () => layoutWidth,
  });
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const top = this.dataset.page
      ? (Number(this.dataset.page) - 1) * 600 -
        (w.document.querySelector(".pdf-scroll")?.scrollTop || 0)
      : 0;
    return {
      top,
      bottom: top + 600,
      width: layoutWidth,
      height: 600,
      left: 0,
      right: layoutWidth,
    };
  };
  w.fetch = async () => {
    counts.assets++;
    return { ok: true, text: async () => "" };
  };
  w.URL.createObjectURL = () => "blob:fixture";
  w.URL.revokeObjectURL = () => {};
  w.Worker = class extends w.EventTarget {
    constructor() {
      super();
      counts.workers++;
    }
    terminate() {
      counts.terminated++;
    }
  };
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  const doc = {
    numPages,
    getPage: async (number: number) => {
      counts.requestedPages.push(number);
      return {
        getViewport: ({ scale }: { scale: number }) => ({
          width: pageSize.width * scale,
          height: pageSize.height * scale,
        }),
        render: () => {
          counts.render++;
          counts.active++;
          counts.maxActive = Math.max(counts.maxActive, counts.active);
          let reject!: (error: Error) => void;
          const cancelled = new Promise<void>((_, fail) => {
            reject = fail;
          });
          return {
            promise: Promise.race([
              cancelled,
              failRender
                ? Promise.reject(new Error("render fixture"))
                : renderGate || Promise.resolve(),
            ]).finally(() => {
              counts.active--;
            }),
            cancel() {
              counts.cancelled++;
              reject(new Error("cancelled"));
            },
          };
        },
        getTextContent: async () => {
          counts.text++;
          return { items: [{ str: "Page fixture" }] };
        },
        cleanup() {},
      };
    },
  };
  w.pdfFixture = {
    PDFWorker: class {
      destroy() {}
    },
    getDocument: (options: any) => {
      counts.imageBudget = options.canvasMaxAreaInBytes;
      counts.documents++;
      return {
        promise: documentGate || Promise.resolve(doc),
        destroy: async () => {
          counts.destroyed++;
          if (hangDestroy) await new Promise(() => {});
        },
      };
    },
  };
  w.eval(source);
  const app = w.document.getElementById("app");
  const sent: string[] = [];
  const preview = w.Preview.createPreview(
    app,
    (type: string) => sent.push(type),
    { inline: true },
  );
  const show = (path = "/sample.pdf") =>
    preview.show({
      type: "content",
      kind: "pdf",
      path,
      data: "AA==",
      language: "en",
      size: 1,
    });
  return {
    dom,
    w,
    app,
    counts,
    sent,
    preview,
    show,
    doc,
    fail(value: boolean) {
      failRender = value;
    },
    gate(value: Promise<any>) {
      documentGate = value;
    },
    hangCleanup(value: boolean) {
      hangDestroy = value;
    },
    visible(numbers: number[]) {
      w.document.querySelector(".pdf-scroll").scrollTop =
        (numbers[0] - 1) * 600;
      intersections(
        [...w.document.querySelectorAll(".pdf-page")].map((target: any) => ({
          target,
          isIntersecting: numbers.includes(Number(target.dataset.page)),
        })),
      );
    },
    renderGate(value?: Promise<void>) {
      renderGate = value;
    },
    resize(width: number) {
      layoutWidth = width;
      resize();
    },
    close() {
      preview.destroy();
      dom.window.close();
    },
  };
}

test("PDF previews reuse the engine and release old documents without extracting text", async () => {
  const u = setup();
  await u.show();
  assert.equal(u.counts.text, 0);
  assert.equal(u.app.querySelector("details"), null);
  assert.equal(u.app.querySelector(".pdf-text"), null);
  assert.equal(u.app.querySelectorAll(".pdf-page").length, 2);
  await u.show("/second.pdf");
  assert.equal(u.counts.workers, 1);
  assert.equal(u.counts.assets, 1);
  assert.equal(u.counts.documents, 2);
  assert.equal(u.counts.destroyed, 1);
  u.preview.clear();
  assert.equal(u.counts.terminated, 0);
  await u.show("/third.pdf");
  assert.equal(u.counts.workers, 1);
  u.close();
  assert.equal(u.counts.terminated, 1);
});

test("late PDF loading cannot replace a newer text preview", async () => {
  const u = setup();
  let resolve!: (doc: any) => void;
  u.gate(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const pending = u.show();
  await new Promise((r) => setImmediate(r));
  await u.preview.show({
    type: "content",
    kind: "text",
    path: "/new.txt",
    data: "Latest file",
    language: "en",
  });
  resolve(u.doc);
  await pending;
  assert.equal(u.app.querySelector(".cm-content").textContent, "Latest file");
  assert.equal(u.app.querySelector("canvas"), null);
  assert.equal(u.counts.destroyed, 1);
  u.close();
});

test("PDF render retry keeps the loaded file and clears the failure", async () => {
  const u = setup();
  u.fail(true);
  await u.show();
  assert.ok(u.app.querySelector(".preview-problem"));
  u.fail(false);
  u.app.querySelector(".preview-problem button").click();
  await new Promise((r) => setImmediate(r));
  assert.equal(u.app.querySelector(".preview-problem"), null);
  assert.equal(u.counts.documents, 1);
  assert.equal(u.counts.render, 2);
  assert.deepEqual(u.sent, []);
  u.close();
});

test("continuous scrolling renders nearby pages with bounded canvases and one render at a time", async () => {
  const u = setup(80);
  await u.show();
  const first = u.app.querySelector("canvas");
  assert.equal(u.counts.render, 1);
  u.visible([20, 21, 22, 23, 24, 25, 26, 27]);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(u.app.querySelectorAll("canvas").length, 6);
  assert.equal(first.width, 0);
  assert.equal(u.app.querySelector(".pdf-controls input").value, "20");
  assert.equal(u.counts.maxActive, 1);
  assert.ok(
    u.counts.requestedPages.every(
      (page) => page === 1 || (page >= 20 && page <= 25),
    ),
  );
  u.visible([1, 2]);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(u.app.querySelectorAll("canvas").length, 2);
  assert.equal(u.counts.documents, 1);
  assert.equal(u.counts.text, 0);
  u.close();
});

test("long PDF pages preserve readable width within a fixed pixel budget", async () => {
  const u = setup(1, { width: 300, height: 6000 });
  await u.show();
  let canvas = u.app.querySelector("canvas");
  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 8000);
  assert.ok(canvas.width * canvas.height <= 3_520_000);
  assert.equal(u.counts.imageBudget, 16 * 1024 * 1024);
  u.resize(1000);
  await new Promise((resolve) => setTimeout(resolve, 40));
  canvas = u.app.querySelector("canvas");
  assert.ok(canvas.width >= 400);
  assert.ok(canvas.width * canvas.height <= 3_520_000);
  u.close();
});

test("switching away from an active scroll render cancels it and rejects stale canvas output", async () => {
  const u = setup(10);
  await u.show();
  u.renderGate(new Promise(() => {}));
  u.visible([4, 5]);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(u.counts.active, 1);
  await u.preview.show({
    type: "content",
    kind: "text",
    path: "/current.txt",
    data: "Current",
    language: "en",
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(u.counts.cancelled, 1);
  assert.equal(u.counts.active, 0);
  assert.equal(u.app.querySelector("canvas"), null);
  assert.equal(u.app.querySelector(".pdf-scroll"), null);
  assert.equal(u.app.querySelector(".cm-content").textContent, "Current");
  u.renderGate();
  await u.show();
  assert.equal(u.counts.workers, 1);
  u.close();
});

test("resizing rerenders nearby pages without rereading the PDF", async () => {
  const u = setup();
  await u.show();
  const old = u.app.querySelector("canvas");
  u.resize(700);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(old.width, 0);
  assert.equal(u.app.querySelector("canvas").width, 700);
  assert.equal(u.counts.documents, 1);
  assert.equal(u.counts.maxActive, 1);
  u.close();
});

test("cancelling a pending PDF releases loading without waiting for its timeout", async () => {
  const u = setup();
  u.gate(new Promise(() => {}));
  const pending = u.show();
  await new Promise((r) => setImmediate(r));
  await u.preview.show({
    type: "cancelled",
    path: "/sample.pdf",
    language: "en",
  });
  await pending;
  assert.equal(u.counts.destroyed, 1);
  assert.equal(u.app.querySelector("canvas"), null);
  assert.ok(u.app.textContent.includes("Cancelled"));
  u.close();
});

test("a failed worker cannot strand the next PDF behind abandoned cleanup", async () => {
  const u = setup();
  u.hangCleanup(true);
  u.gate(Promise.reject(new Error("broken PDF")));
  await u.show();
  assert.equal(u.counts.terminated, 1);
  u.hangCleanup(false);
  u.gate(Promise.resolve(u.doc));
  await u.show("/recovered.pdf");
  assert.equal(u.counts.workers, 2);
  assert.equal(u.app.querySelector(".pdf-controls input").disabled, false);
  u.close();
});

test("switching during large PDF decoding stops before opening a stale document", async () => {
  const u = setup();
  const pending = u.preview.show({
    type: "content",
    kind: "pdf",
    path: "/large.pdf",
    language: "en",
    data: Buffer.alloc(4 * 1048576).toString("base64"),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await u.preview.show({
    type: "content",
    kind: "text",
    path: "/current.txt",
    language: "en",
    data: "Current",
  });
  await pending;
  assert.equal(u.counts.documents, 0);
  assert.equal(u.app.querySelector(".cm-content").textContent, "Current");
  u.close();
});

test("closing during lazy text loading cannot recreate the preview", async () => {
  const u = setup();
  const pending = u.preview.show({
    type: "content",
    kind: "text",
    path: "/closed.txt",
    language: "en",
    data: "Closed",
  });
  u.preview.clear();
  await pending;
  assert.equal(u.app.children.length, 0);
  assert.equal(u.app.classList.contains("text-preview"), false);
  u.close();
});
test("wrap state changes its label, icon and pressed state; text encoding is selectable", async () => {
  const u = setup();
  try {
    await u.preview.show({
      type: "content",
      kind: "text",
      path: "/sample.csv",
      data: "name,value\nexample,42",
      language: "en",
      encoding: "utf-8",
      encodingSelection: "auto",
    });
    const toggle = u.app.querySelector('button[aria-label^="Wrap text"]');
    const before = toggle.querySelector("path").getAttribute("d");
    assert.equal(toggle.getAttribute("aria-pressed"), "true");
    toggle.click();
    assert.equal(toggle.getAttribute("aria-pressed"), "false");
    assert.equal(toggle.getAttribute("aria-label"), "Wrap text: off");
    assert.notEqual(toggle.querySelector("path").getAttribute("d"), before);
    assert.ok(u.app.querySelector('#previewEncodingControl[role="combobox"]'));
    u.app.querySelector("#previewEncodingControl").click();
    const option = [...u.w.document.querySelectorAll('[role="option"]')].find(
      (n: any) => n.textContent === "GBK",
    ) as any;
    option.click();
    assert.deepEqual(u.sent, ["encoding"]);
    await u.preview.show({
      type: "content",
      kind: "text",
      path: "/sample.csv",
      data: "name,value\n中文,42",
      language: "en",
      encoding: "gbk",
      encodingSelection: "gbk",
    });
    assert.equal(
      u.app
        .querySelector('button[aria-label^="Wrap text"]')
        .getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(u.w.document.activeElement.id, "previewEncodingControl");
  } finally {
    u.close();
  }
});

test("JSON indentation preserves the active search, line controls and original lexemes", async () => {
  const u = setup();
  try {
    const data = '{"id":90071992547409931234,"value":32.50,"id":1}';
    await u.preview.show({
      type: "content",
      kind: "text",
      path: "/data.json",
      data,
      language: "en",
      encoding: "utf-8",
    });
    const find = [...u.app.querySelectorAll("button")].find(
      (button: any) => button.textContent === "Find",
    ) as any;
    const indent = u.app.querySelector('button[title^="Show with two-space"]');
    find.click();
    const query = u.app.querySelector("input[main-field]");
    query.value = "id";
    query.dispatchEvent(new u.w.Event("input", { bubbles: true }));
    indent.click();
    await Promise.resolve();
    assert.equal(indent.getAttribute("aria-pressed"), "true");
    assert.equal(u.app.querySelector("input[main-field]"), query);
    assert.equal(query.value, "id");
    assert.equal(find.getAttribute("aria-pressed"), "true");
    assert.ok(u.app.querySelector(".cm-lineNumbers"));
    assert.equal(u.app.querySelectorAll(".cm-line").length, 5);
    assert.match(
      u.app.querySelector(".cm-content").textContent,
      /90071992547409931234.*32\.50/,
    );
    indent.click();
    assert.equal(u.app.querySelector(".cm-content").textContent, data);
  } finally {
    u.close();
  }
});

test("the automatic encoding label remains independent of manual selection and failures name the attempted encoding", async () => {
  const u = setup();
  try {
    await u.preview.show({
      type: "content",
      kind: "text",
      path: "/sample.csv",
      data: "中文",
      language: "en",
      encoding: "gbk",
      encodingSelection: "gbk",
      automaticEncoding: "utf-8",
    });
    u.app.querySelector("#previewEncodingControl").click();
    assert.match(
      u.w.document.querySelector('[role="listbox"]').textContent,
      /Automatic \(UTF-8\)/,
    );
    assert.ok(
      !u.w.document
        .querySelector('[role="listbox"]')
        .textContent.includes("Automatic (GBK)"),
    );
    await u.preview.show({
      type: "encoding",
      path: "/sample.csv",
      language: "zh-CN",
      encoding: "utf-16le",
      encodingSelection: "utf-16le",
      automaticEncoding: "utf-8",
    });
    assert.match(
      u.app.querySelector('[role="alert"]').textContent,
      /当前编码 UTF-16LE/,
    );
    assert.ok(u.app.querySelector(".encoding-error.error"));
    assert.ok(u.app.querySelector("#previewEncodingControl"));
  } finally {
    u.close();
  }
});
