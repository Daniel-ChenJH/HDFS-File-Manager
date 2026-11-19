import { before, test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

let source: string;
before(async () => {
  const result = await build({
    entryPoints: ["web/text-view.js"],
    bundle: true,
    format: "iife",
    globalName: "TextPreview",
    footer: { js: "window.TextPreview = TextPreview;" },
    write: false,
  });
  source = result.outputFiles[0].text;
});

function setup(text: string) {
  const dom = new JSDOM(
    '<meta name="csp-nonce" content="fixture-nonce"><main></main>',
    {
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  const w = dom.window as any;
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => new w.DOMRect(0, 0, 400, 20);
  w.eval(source);
  const preview = w.TextPreview.createTextView(
    w.document.querySelector("main"),
    text,
    "Sample preview",
  );
  return {
    w,
    preview,
    close() {
      preview.destroy();
      dom.window.close();
    },
  };
}

test("read-only text preserves Unicode, mixed line endings and JSON integers through wrapping and copying", () => {
  const original =
    '{"id":9007199254740993,"text":"中文 𠮷"}\r\nsecond\nthird\rfourth\tend';
  const u = setup(original);
  const { view } = u.preview;
  assert.equal(view.state.sliceDoc(), original);
  assert.equal(view.state.readOnly, true);
  assert.equal(view.contentDOM.getAttribute("contenteditable"), "false");
  assert.equal(view.contentDOM.getAttribute("aria-readonly"), "true");
  assert.equal(view.contentDOM.getAttribute("tabindex"), "0");
  u.preview.setWrap(false);
  assert.equal(view.contentDOM.classList.contains("cm-lineWrapping"), false);
  u.preview.setWrap(true);
  assert.equal(view.contentDOM.classList.contains("cm-lineWrapping"), true);
  assert.equal(view.state.sliceDoc(), original);
  view.focus();
  view.contentDOM.dispatchEvent(
    new u.w.KeyboardEvent("keydown", {
      key: "a",
      code: "KeyA",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(view.state.selection.main.from, 0);
  assert.equal(view.state.selection.main.to, original.length);
  let copied: string | undefined;
  const event = new u.w.Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      clearData() {},
      setData(type: string, value: string) {
        assert.equal(type, "text/plain");
        copied = value;
      },
    },
  });
  view.contentDOM.dispatchEvent(event);
  assert.equal(copied, original);
  assert.equal(u.w.document.querySelector("style").nonce, "fixture-nonce");
  u.close();
  assert.equal(view.dom.isConnected, false);
});

test("large single-line and many-line previews retain all bounded source text", () => {
  for (const text of [
    "长行 abc ".repeat(150000),
    "log entry\r\n".repeat(100000),
  ]) {
    const u = setup(text);
    assert.equal(u.preview.view.state.doc.length, text.length);
    assert.equal(u.preview.view.state.sliceDoc(), text);
    u.close();
  }
});

test("search and line numbers remain read only and release their controls", () => {
  const u = setup("first\nsecond\nfirst");
  try {
    u.preview.setLineNumbers(true);
    assert.ok(u.w.document.querySelector(".cm-lineNumbers"));
    u.preview.find();
    assert.ok(u.w.document.querySelector(".cm-search"));
    const find = u.w.document.querySelector(
      "input[main-field]",
    ) as HTMLInputElement;
    find.value = "first";
    find.dispatchEvent(new u.w.Event("input", { bubbles: true }));
    const next = u.w.document.querySelector(
      '[aria-label="Next match"]',
    ) as HTMLButtonElement;
    next.click();
    assert.equal(viewSelection(), "first");
    u.preview.replaceText("first\nthird\nfirst");
    assert.equal(find.value, "first");
    assert.ok(find.isConnected);
    next.click();
    assert.equal(viewSelection(), "first");
    find.value = "missing";
    find.dispatchEvent(new u.w.Event("input", { bubbles: true }));
    assert.equal(next.disabled, true);
    assert.match(
      u.w.document.querySelector(".preview-find-status").textContent,
      /No matches/,
    );
    u.preview.find();
    assert.equal(u.w.document.querySelector(".cm-search"), null);
    assert.equal(u.preview.view.state.readOnly, true);
    u.preview.setLineNumbers(false);
    assert.equal(u.w.document.querySelector(".cm-lineNumbers"), null);
    function viewSelection() {
      const state = u.preview.view.state;
      return state.sliceDoc(state.selection.main.from, state.selection.main.to);
    }
  } finally {
    u.close();
  }
});
