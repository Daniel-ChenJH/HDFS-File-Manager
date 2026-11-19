import { fileExtension, fileKind } from "../src/file-types.ts";
import { icon } from "./icons.js";
import { element as el } from "./strings.js";
import { filenameTooltip } from "./controls.js";

export function typeLabel(name, type, s) {
  return s.fileTypes[fileKind(name, type)];
}

export function fileIcon(name, type, s) {
  const kind = fileKind(name, type);
  return el(
    "span",
    {
      class: "file-icon kind-" + kind,
      title: s.fileTypes[kind],
      role: "img",
      "aria-label": s.fileTypes[kind],
    },
    icon(kind),
  );
}

export function filename(name, type = "FILE") {
  const extension = type === "DIRECTORY" ? "" : fileExtension(name);
  return filenameTooltip(
    el(
      "span",
      { class: "file-label" },
      el(
        "span",
        { class: "filename-base" },
        extension ? name.slice(0, -extension.length) : name,
      ),
      extension ? el("span", { class: "filename-extension" }, extension) : null,
    ),
    name,
  );
}
