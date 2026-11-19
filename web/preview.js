import { createPreview } from "./preview-content.js";
const vscode = acquireVsCodeApi();
let context,
  language,
  cancelled = false;
const preview = createPreview(
  document.getElementById("app"),
  (type, extra = {}) => {
    if (type === "retry" || type === "encoding") cancelled = false;
    if (type === "cancel") {
      cancelled = true;
      context = { ...context, type: "cancelled" };
      void preview.show(context);
    }
    vscode.postMessage({ type, ...extra });
  },
);
window.addEventListener("message", ({ data }) => {
  if (data.type === "language") {
    language = data.language;
    if (context) void preview.show({ ...context, language });
    return;
  }
  if (cancelled) return;
  context = { ...data, language: language ?? data.language };
  void preview.show(context);
});
window.addEventListener("pagehide", () => preview.destroy());
vscode.postMessage({ type: "ready" });
