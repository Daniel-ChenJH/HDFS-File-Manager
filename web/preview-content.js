import { formatJson } from "./json-format.js";
import { strings, size, element as el } from "./strings.js";
import { icon } from "./icons.js";
import { fileIcon, filename, typeLabel } from "./files.js";
import { createPdfScroller } from "./pdf-scroll.js";
import { decodeBase64 } from "./bytes.js";
import { recoveryActions } from "./recovery.js";
import { enhanceSelects, closePopup, infoTip } from "./controls.js";
import { textEncodings } from "../src/text-encoding.ts";
let pdfAssets;
function loadPdfAssets() {
  if (!pdfAssets)
    pdfAssets = Promise.all([
      import("./pdf.mjs"),
      fetch(new URL("./pdf.worker.mjs", import.meta.url)).then((response) => {
        if (!response.ok) throw new Error("worker");
        return response.text();
      }),
    ]).catch((error) => {
      pdfAssets = undefined;
      throw error;
    });
  return pdfAssets;
}
const button = (label, action) =>
  el("button", { type: "button", onclick: action }, label);
const pageButton = (name, label, action) =>
  el(
    "button",
    {
      type: "button",
      class: "icon-button",
      title: label,
      "aria-label": label,
      onclick: action,
    },
    icon(name),
  );
export function createPreview(app, send, { inline = false } = {}) {
  let s = strings("en"),
    generation = 0,
    task,
    cancelLoad,
    scroller,
    textView,
    engine,
    enginePromise,
    engineEpoch = 0,
    wrapEnabled = true,
    numbersEnabled = true,
    encodingFocusPath,
    cleanup = Promise.resolve();
  function release() {
    closePopup();
    generation++;
    scroller?.destroy();
    scroller = undefined;
    textView?.destroy();
    textView = undefined;
    app.classList.remove("text-preview");
    cancelLoad?.();
    cancelLoad = undefined;
    const previous = task;
    task = undefined;
    if (previous)
      cleanup = Promise.all([cleanup, previous.destroy().catch(() => {})]).then(
        () => {},
      );
    return cleanup;
  }
  function preparePdf() {
    if (!enginePromise) {
      const epoch = engineEpoch;
      enginePromise = loadPdfAssets()
        .then(([pdfjs, code]) => {
          if (epoch !== engineEpoch) throw new Error("cancelled");
          // A self-contained Blob worker works across local and SSH webview origins.
          const url = URL.createObjectURL(
            new Blob([code], { type: "text/javascript" }),
          );
          const port = new Worker(url, { type: "module" });
          engine = { pdfjs, url, port, worker: new pdfjs.PDFWorker({ port }) };
          return engine;
        })
        .catch((error) => {
          if (epoch === engineEpoch) enginePromise = undefined;
          throw error;
        });
    }
    return enginePromise;
  }
  function disposeEngine() {
    engineEpoch++;
    enginePromise = undefined;
    // A terminated worker cannot acknowledge old document cleanup. A fresh
    // engine must not wait on those abandoned transport promises.
    cleanup = Promise.resolve();
    if (!engine) return;
    engine.worker.destroy();
    engine.port.terminate();
    URL.revokeObjectURL(engine.url);
    engine = undefined;
  }
  async function show(message) {
    const released = release();
    const current = generation;
    s = strings(message.language);
    if (encodingFocusPath !== message.path) encodingFocusPath = undefined;
    const restoreEncodingFocus = () => {
      if (encodingFocusPath === message.path) {
        app.querySelector("#previewEncodingControl")?.focus();
        encodingFocusPath = undefined;
      }
    };
    const encodingControl = () =>
      el(
        "div",
        { class: "encoding-control" },
        el(
          "select",
          {
            id: "previewEncoding",
            "aria-label": s.encoding,
            onchange: (event) => {
              encodingFocusPath = message.path;
              send("encoding", { encoding: event.target.value });
            },
          },
          textEncodings.map((value) =>
            el(
              "option",
              {
                value,
                selected: value === (message.encodingSelection || "auto"),
              },
              value === "auto"
                ? s.autoEncoding +
                    (message.automaticEncoding
                      ? ` (${message.automaticEncoding.toUpperCase()})`
                      : "")
                : value.toUpperCase(),
            ),
          ),
        ),
        infoTip(s.encoding, s.encodingHelp, s, s.encodingInfo),
      );
    app.lang = message.language;
    app.replaceChildren(
      el(
        "header",
        { class: "preview-header" },
        el(
          "div",
          { class: "preview-heading" },
          el(
            "button",
            {
              type: "button",
              class: "icon-button preview-return",
              title: s.previewBack,
              "aria-label": s.previewBack,
              onclick: () => send("browse"),
            },
            icon("back"),
          ),
          el(
            "strong",
            { title: message.path },
            fileIcon(message.path, "FILE", s),
            filename(message.path.split("/").pop()),
          ),
          el(
            "div",
            { class: "preview-actions" },
            message.type === "binary" || message.type === "limited"
              ? null
              : pageButton("download", s.original, () => send("download")),
            inline && message.type !== "binary" && message.type !== "limited"
              ? pageButton("expand", s.openPreviewTab, () => send("openTab"))
              : null,
          ),
        ),
        !inline
          ? el(
              "div",
              {
                class: "preview-path",
                title: [message.connection, message.host]
                  .filter(Boolean)
                  .join(" · "),
              },
              [message.connection, message.host].filter(Boolean).join(" · "),
            )
          : null,
        message.size !== undefined
          ? el(
              "div",
              { class: "preview-meta" },
              typeLabel(message.path, "FILE", s) + " · " + size(message.size),
            )
          : null,
      ),
    );
    if (message.type === "loading") {
      if (/\.pdf$/i.test(message.path)) void preparePdf().catch(() => {});
      else if (!/\.(png|jpe?g|gif|webp|bmp)$/i.test(message.path))
        void import("./text-view.js").catch(() => {});
      app.append(
        el("p", { role: "status" }, s.previewLoading),
        button(s.cancel, () => send("cancel")),
      );
      return;
    }
    if (message.type === "error") {
      app.append(
        el("p", { role: "alert", class: "error" }, message.text),
        el(
          "div",
          { class: "actions" },
          ...recoveryActions(message.code, true).map(
            ({ action, label, focus }) =>
              button(s[label], () => send(action, { focus })),
          ),
        ),
      );
      return;
    }
    if (message.type === "cancelled") {
      app.append(
        el("p", { role: "status" }, s.cancelled),
        button(s.retry, () => send("retry")),
      );
      return;
    }
    if (message.type === "encoding") {
      app.append(
        el(
          "p",
          { class: "encoding-error error", role: "alert" },
          s.encodingError.replace(
            "{encoding}",
            (message.encoding || "UTF-8").toUpperCase(),
          ),
        ),
        encodingControl(),
      );
      enhanceSelects(app);
      restoreEncodingFocus();
      return;
    }
    if (message.type === "limited" || message.type === "binary") {
      app.append(
        el(
          "p",
          {},
          message.type === "limited"
            ? `${s.tooLarge} ${s.previewLimit}: ${size(message.limit)}.`
            : s.binary,
        ),
      );
      app.append(
        el(
          "div",
          { class: "actions" },
          button(s.original, () => send("download")),
          message.type === "limited" &&
            message.size <= 50 * 1048576 &&
            message.limit < 50 * 1048576
            ? button(s.adjustPreviewLimit, () =>
                send("settings", { focus: "mediaLimit" }),
              )
            : null,
        ),
      );
      return;
    }
    if (message.truncated)
      app.append(
        el(
          "div",
          { class: "preview-truncated", role: "status" },
          `${s.truncated} ${size(message.bytesRead)} / ${size(message.size)}`,
          message.bytesRead < 4 * 1048576
            ? button(s.adjustPreviewLimit, () =>
                send("settings", { focus: "textLimit" }),
              )
            : null,
        ),
      );
    if (message.kind === "text") {
      const loading = el(
        "div",
        { class: "preview-loading" },
        el("p", { role: "status" }, s.renderingPreview),
        button(s.cancel, () => send("cancel")),
      );
      app.append(loading);
      try {
        const { createTextView } = await import("./text-view.js");
        if (current !== generation) return;
        const text = el("div", { class: "text-content" });
        const wrap = button(s.wrap, () => {
          wrapEnabled = !wrapEnabled;
          textView.setWrap(wrapEnabled);
          updateWrap();
        });
        const updateWrap = () => {
          wrap.setAttribute("aria-pressed", String(wrapEnabled));
          wrap.setAttribute("aria-label", wrapEnabled ? s.wrapOn : s.wrapOff);
          wrap.title = wrapEnabled ? s.wrapOn : s.wrapOff;
          wrap.replaceChildren(
            icon(wrapEnabled ? "wrap" : "nowrap"),
            document.createTextNode(s.wrap),
          );
        };
        wrap.className = "toggle-button";
        updateWrap();
        loading.remove();
        app.classList.add("text-preview");
        const zh = message.language === "zh-CN";
        const labeledIcon = (symbol, label) =>
          el("span", { class: "preview-control-label" }, icon(symbol), label);
        const numbers = button(
          labeledIcon("lines", zh ? "行号" : "Line numbers"),
          () => {
            numbersEnabled = !numbersEnabled;
            textView.setLineNumbers(numbersEnabled);
            numbers.setAttribute("aria-pressed", String(numbersEnabled));
          },
        );
        numbers.className = "toggle-button";
        numbers.setAttribute("aria-pressed", String(numbersEnabled));
        const find = button(labeledIcon("search", zh ? "查找" : "Find"), () =>
          textView.find(),
        );
        find.className = "toggle-button";
        find.setAttribute("aria-pressed", "false");
        let formatted = false,
          formatting = false,
          formattedText;
        const format = button(
          labeledIcon("indent", zh ? "JSON 缩进" : "JSON indent"),
          async () => {
            if (formatting) return;
            formatting = true;
            format.disabled = true;
            try {
              const value = formatted
                ? message.data
                : (formattedText ??= await formatJson(
                    message.data,
                    () => current !== generation,
                  ));
              if (current !== generation) return;
              textView.replaceText(value);
              formatted = !formatted;
              format.setAttribute("aria-pressed", String(formatted));
              formatError.hidden = true;
            } catch {
              if (current === generation) {
                formatError.hidden = false;
                formatError.textContent = zh
                  ? "此 JSON 无法格式化，请查看原文。"
                  : "This JSON cannot be formatted. View the original text.";
              }
            } finally {
              formatting = false;
              format.disabled = false;
            }
          },
        );
        format.className = "toggle-button";
        format.setAttribute("aria-pressed", "false");
        format.title = zh
          ? "以两空格缩进显示；再次点击恢复原文"
          : "Show with two-space indentation; click again for original";
        const formatError = el("p", {
          class: "error",
          role: "alert",
          hidden: true,
        });
        app.append(
          el(
            "div",
            { class: "text-controls" },
            el(
              "div",
              { class: "preview-control-group" },
              find,
              numbers,
              wrap,
              /\.json$/i.test(message.path) && !message.truncated
                ? format
                : null,
            ),
            encodingControl(),
          ),
          formatError,
          text,
        );
        enhanceSelects(app);
        textView = createTextView(
          text,
          message.data,
          message.path,
          message.language,
          (open) => find.setAttribute("aria-pressed", String(open)),
        );
        textView.setWrap(wrapEnabled);
        textView.setLineNumbers(numbersEnabled);
        restoreEncodingFocus();
      } catch {
        if (current !== generation) return;
        textView?.destroy();
        textView = undefined;
        app.classList.remove("text-preview");
        app.querySelector(".text-controls")?.remove();
        app.querySelector(".text-content")?.remove();
        loading.replaceChildren(
          el("p", { role: "alert" }, s.textError),
          button(s.retry, () => send("retry")),
        );
        app.append(loading);
      }
      return;
    }
    if (message.kind === "image") {
      const image = el("img", {
        class: "preview-image",
        alt: message.path,
        src: `data:${message.mime};base64,${message.data}`,
      });
      image.addEventListener("error", () => {
        image.replaceWith(el("p", {}, s.binary));
      });
      app.append(image);
      return;
    }
    const status = el("p", { role: "status" }, s.renderingPreview);
    const loading = el(
      "div",
      { class: "preview-loading" },
      status,
      button(s.cancel, () => send("cancel")),
    );
    app.append(loading);
    try {
      const prepared = await preparePdf();
      await released;
      if (current !== generation) return;
      const bytes = await decodeBase64(
        message.data,
        () => current === generation,
      );
      if (!bytes) return;
      const loadingTask = prepared.pdfjs.getDocument({
        worker: prepared.worker,
        data: bytes,
        isEvalSupported: false,
        // This viewer owns canvas scheduling and reuse. Keep PDF.js's optional
        // renderer worker off; parsing and image decoding still use our worker.
        disableWorkerRendering: true,
        // Downsample oversized embedded scans in the worker instead of probing
        // and retaining canvases sized to the original image's pixel count.
        canvasMaxAreaInBytes: 16 * 1024 * 1024,
        wasmUrl: new URL("./wasm/", import.meta.url).href,
        iccUrl: new URL("./iccs/", import.meta.url).href,
        cMapUrl: new URL("./cmaps/", import.meta.url).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("./standard_fonts/", import.meta.url).href,
      });
      task = loadingTask;
      let timer;
      let workerFailure;
      let stopLoading;
      let passwordProtected = false;
      let pdf;
      try {
        pdf = await Promise.race([
          loadingTask.promise,
          new Promise((_, reject) => {
            stopLoading = () => reject(new Error("cancelled"));
            cancelLoad = stopLoading;
            timer = setTimeout(() => reject(new Error("PDF timeout")), 30000);
            workerFailure = () => reject(new Error("PDF worker"));
            prepared.port.addEventListener("error", workerFailure, {
              once: true,
            });
            loadingTask.onPassword = () => {
              passwordProtected = true;
              reject(new Error("password"));
            };
          }),
        ]);
      } catch (error) {
        if (passwordProtected) status.dataset.password = "true";
        throw error;
      } finally {
        clearTimeout(timer);
        if (cancelLoad === stopLoading) cancelLoad = undefined;
        prepared.port.removeEventListener("error", workerFailure);
      }
      if (current !== generation) return;
      scroller = createPdfScroller(app, pdf, s);
      await scroller.ready;
      if (current === generation) loading.remove();
    } catch {
      if (current === generation) {
        status.textContent = status.dataset.password
          ? s.passwordPdf
          : s.pdfError;
        loading.replaceChildren(status);
        release();
        disposeEngine();
        if (!status.dataset.password)
          loading.append(button(s.retry, () => send("retry")));
      }
    }
  }
  return {
    show,
    clear() {
      release();
      app.replaceChildren();
    },
    destroy() {
      release();
      disposeEngine();
      app.replaceChildren();
    },
  };
}
