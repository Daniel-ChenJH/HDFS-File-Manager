import { strings, element as el } from "./strings.js";
import { icon } from "./icons.js";

export function downloadDialog(send) {
  let current;
  function close(notify = true) {
    if (!current) return;
    const previous = current;
    current = undefined;
    if (notify) send("downloadCancel", { id: previous.id });
    previous.dialog.close();
    previous.dialog.remove();
    if (previous.focus?.isConnected) previous.focus.focus();
  }
  function open(message) {
    if (current?.id === message.id) return;
    close();
    const s = strings(message.language),
      focus = document.activeElement;
    const folder = el("input", {
      id: "downloadFolder",
      type: "text",
      required: true,
      autocomplete: "off",
      spellcheck: false,
    });
    const name = el("input", {
      id: "downloadName",
      type: "text",
      value: message.name,
      required: true,
      autocomplete: "off",
      spellcheck: false,
    });
    const error = el("p", {
      class: "download-error",
      role: "alert",
      hidden: true,
    });
    const browse = el(
      "button",
      {
        type: "button",
        onclick: () => {
          saveDraft();
          setBusy(true);
          send("downloadBrowse", {
            id: current.id,
            target: current.target,
            folder: folder.value,
            request: ++current.request,
          });
        },
      },
      s.browseFolder,
    );
    const submit = el(
      "button",
      { type: "submit", class: "primary" },
      s.download,
    );
    const pills = el("div", {
      class: "download-targets",
      role: "radiogroup",
      "aria-label": s.saveTo,
    });
    const targets = message.remote
      ? message.localTransfer === false
        ? ["host"]
        : ["host", "local"]
      : ["local"];
    for (const target of targets)
      pills.append(
        el(
          "button",
          {
            type: "button",
            role: "radio",
            "data-target": target,
            onclick: () => {
              if (current.target !== target) {
                saveDraft();
                select(target);
              }
            },
            onkeydown: (event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                  event.key,
                ) ||
                current.busy
              )
                return;
              event.preventDefault();
              saveDraft();
              const next =
                event.key === "Home"
                  ? targets[0]
                  : event.key === "End"
                    ? targets.at(-1)
                    : targets[
                        (targets.indexOf(current.target) +
                          (event.key === "ArrowLeft" ? -1 : 1) +
                          targets.length) %
                          targets.length
                      ];
              if (next !== current.target) select(next);
              pills.querySelector('[aria-checked="true"]').focus();
            },
          },
          icon(target === "host" ? "server" : "computer"),
          el(
            "span",
            { title: target === "host" ? message.hostName : s.thisComputer },
            target === "host" ? message.hostName : s.thisComputer,
          ),
        ),
      );
    const form = el(
      "form",
      {
        onsubmit: (event) => {
          event.preventDefault();
          if (current.busy || current.loading) return;
          saveDraft();
          setBusy(true);
          send("downloadSubmit", {
            id: current.id,
            target: current.target,
            folder: folder.value,
            name: name.value,
          });
        },
      },
      pills,
      el(
        "div",
        { class: "field" },
        el("label", { for: folder.id }, s.saveFolder),
        el("div", { class: "download-folder" }, folder, browse),
      ),
      el(
        "div",
        { class: "field" },
        el("label", { for: name.id }, s.fileName),
        name,
      ),
      error,
      el(
        "div",
        { class: "actions download-actions" },
        el("button", { type: "button", onclick: () => close() }, s.cancel),
        submit,
      ),
    );
    const dialog = el(
      "dialog",
      { class: "download-dialog", "aria-labelledby": "downloadHeading" },
      el(
        "div",
        { class: "dialog-heading" },
        el("h2", { id: "downloadHeading" }, s.downloadFile),
        el(
          "button",
          {
            type: "button",
            class: "icon-button",
            "aria-label": s.close,
            title: s.close,
            onclick: () => close(),
          },
          icon("close"),
        ),
      ),
      form,
    );
    current = {
      id: message.id,
      target: message.target,
      request: 0,
      drafts: {},
      loading: false,
      busy: false,
      dialog,
      focus,
      folder,
      name,
      error,
      pills,
      browse,
      submit,
      s,
    };
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    let outside = false;
    const isOutside = (event) => {
      const r = dialog.getBoundingClientRect();
      return (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      );
    };
    dialog.addEventListener("pointerdown", (event) => {
      outside = event.target === dialog && isOutside(event);
    });
    dialog.addEventListener("click", (event) => {
      if (outside && event.target === dialog && isOutside(event)) close();
      outside = false;
    });
    document.body.append(dialog);
    dialog.showModal();
    select(message.target, true);
    name.focus();
    name.select();
  }
  function saveDraft() {
    if (current && !current.loading)
      current.drafts[current.target] = {
        folder: current.folder.value,
        name: current.name.value,
      };
  }
  function setBusy(value) {
    const c = current;
    c.busy = value;
    c.folder.disabled = c.name.disabled = value || c.loading;
    c.browse.disabled = c.submit.disabled = value || c.loading;
    c.submit.textContent = value ? c.s.preparingDownload : c.s.download;
    for (const pill of c.pills.children) pill.disabled = value;
    c.dialog.setAttribute("aria-busy", String(value || c.loading));
  }
  function select(target, initial = false) {
    const c = current;
    c.target = target;
    c.focusNameOnLoad = initial;
    c.error.hidden = true;
    c.request++;
    for (const pill of c.pills.children) {
      const selected = pill.dataset.target === target;
      pill.setAttribute("aria-checked", String(selected));
      pill.tabIndex = selected ? 0 : -1;
    }
    const draft = c.drafts[target];
    c.loading = !draft;
    c.folder.value = draft?.folder ?? "";
    if (draft) c.name.value = draft.name;
    setBusy(false);
    if (!draft)
      send("downloadTarget", { id: c.id, target, request: c.request });
  }
  return {
    receive(message) {
      if (message.type === "downloadDialog") {
        open(message);
        return;
      }
      const c = current;
      if (!c || (message.id && message.id !== c.id)) return;
      if (message.type === "downloadClosed") {
        close(false);
        return;
      }
      if (message.type === "downloadRestore") {
        c.drafts[message.target] = {
          folder: message.folder,
          name: message.name,
        };
        select(message.target);
        return;
      }
      if (
        (message.target && message.target !== c.target) ||
        (message.request !== undefined && message.request !== c.request)
      )
        return;
      if (message.type === "downloadLocation") {
        c.loading = false;
        if (message.folder !== undefined) c.folder.value = message.folder;
        if (message.name !== undefined) c.name.value = message.name;
        c.error.hidden = true;
        setBusy(false);
        saveDraft();
        if (!message.chosen && c.focusNameOnLoad) {
          c.name.focus();
          c.name.select();
        }
      } else if (message.type === "downloadError") {
        c.loading = false;
        setBusy(false);
        c.error.textContent = message.text;
        c.error.hidden = !message.text;
        const correction = [
          "filename",
          "destinationChanged",
          "destinationBusy",
        ].includes(message.code)
          ? c.name
          : ["destination", "save"].includes(message.code)
            ? c.folder
            : undefined;
        correction?.focus();
        if (message.code === "localTransfer")
          c.error.append(
            el(
              "button",
              { type: "button", onclick: () => send("downloadReload") },
              c.s.reloadWindow,
            ),
          );
      }
    },
  };
}
