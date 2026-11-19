import { manager } from "./manage.js";
import { strings, size, element as el } from "./strings.js";
import { icon } from "./icons.js";
import { createPreview } from "./preview-content.js";
import { fileIcon, filename, typeLabel } from "./files.js";
import { downloadDialog } from "./download.js";
import { recoveryActions } from "./recovery.js";
import {
  closePopup,
  enhanceSelects,
  syncSelects,
  numberControl,
  infoTip,
} from "./controls.js";
import { pageSizes, normalizePageSize } from "../src/listing.ts";
import { normalizeEncoding } from "../src/text-encoding.ts";
const vscode = acquireVsCodeApi(),
  app = document.getElementById("app");
const remembered = vscode.getState() || {};
let s = strings("en"),
  state,
  mode = "browse",
  selected = remembered.selected || "",
  editId = "",
  current = "",
  items = [],
  total = 0,
  count = 0,
  page = 0,
  pageSize = normalizePageSize(remembered.pageSize),
  filter = "",
  sort = "name",
  descending = false,
  revision,
  pageRequest = 0,
  pagePending = false,
  request = 0,
  busy = false,
  busyScope = "",
  hasListing = false,
  history = [],
  index = -1,
  pending,
  navigationReturn,
  lastAction,
  filterTimer,
  focusAfterListing = false,
  connectionDraft,
  connectionDirty = false,
  saving = "",
  saveAction = "",
  selectedPath = "",
  previewTarget,
  previewRequest = 0,
  previewNode,
  previewView,
  previewAfterListing,
  favoriteAfterListing,
  settingsReturn,
  settingsFocus,
  browseReturn,
  saveRequest = 0,
  preferenceRequest = 0,
  returnAfterPreferences = false,
  connectionDialog,
  status = { text: "", error: false, code: "" };
const send = (type, extra = {}) => vscode.postMessage({ type, ...extra });
const downloads = downloadDialog(send);
const checked = new Set();
const preferenceDrafts = new Map();
const MiB = 1048576;
let checkAnchor = 0;
let closeFileMenu = () => {};
const text = (en, zh) => (state?.preferences.language === "zh-CN" ? zh : en);
const manage = manager(send, () => ({ ...state, selected, current }));
const favorites = () => state?.places?.[selected]?.favorites || [];
function starButton(path, name, type) {
  const control = iconButton(
    "star",
    "",
    () => {
      const active = control.getAttribute("aria-pressed") !== "true";
      updateStar(control, active);
      send("place", {
        action: "set",
        connection: selected,
        path,
        entryType: type,
        active,
      });
      if (mode === "favorites" && !active) {
        const index = favorites().findIndex((item) => item.path === path);
        if (index >= 0) favorites().splice(index, 1);
        renderFavorites();
        document.querySelector(".favorite-open")?.focus();
      }
    },
    {
      class: "icon-button favorite-star",
      "data-star": path,
      "data-name": name,
    },
  );
  updateStar(
    control,
    favorites().some((item) => item.path === path),
  );
  return control;
}
function updateStar(control, active) {
  const label =
    (active
      ? text("Remove favorite", "取消收藏")
      : text("Add to favorites", "收藏")) +
    ": " +
    control.dataset.name;
  control.setAttribute("aria-pressed", String(active));
  control.setAttribute("aria-label", label);
  control.title = label;
}
function renderFavorites() {
  let list = document.querySelector(".favorites-list");
  if (!list) {
    list = el("section", {
      class: "favorites-list",
      "aria-label": text("Favorites", "收藏"),
    });
    app.append(list);
  }
  const items = favorites();
  list.replaceChildren(
    ...(items.length
      ? items.map((item) => {
          const name = item.name || item.path;
          return el(
            "div",
            { class: "favorite-row" },
            button(
              [
                fileIcon(name, item.type || "DIRECTORY", s),
                el(
                  "span",
                  { class: "favorite-text" },
                  el("strong", {}, name),
                  el("span", { class: "muted" }, item.path),
                ),
              ],
              () => {
                const folder =
                  item.path.slice(0, item.path.lastIndexOf("/")) || "/";
                mode = "browse";
                navigate(
                  folder,
                  undefined,
                  undefined,
                  item.path === "/" ? undefined : item.path,
                );
              },
              { class: "favorite-open", title: item.path, "aria-label": name },
            ),
            starButton(item.path, name, item.type || "DIRECTORY"),
          );
        })
      : [
          el(
            "div",
            { class: "empty compact" },
            icon("star"),
            el("h2", {}, text("No favorites yet", "暂无收藏")),
            el(
              "p",
              {},
              text(
                "Star a file or folder to find it here.",
                "点击文件或文件夹旁的星标，即可在这里找到它。",
              ),
            ),
          ),
        ]),
  );
}
function chosen(path) {
  return checked.has(path) ? [...checked] : [path];
}
function operation(action, path = current) {
  send("fileOperation", {
    action,
    connection: selected,
    path,
    paths: action === "delete" ? chosen(path) : undefined,
  });
}
function toggleCheck(item, path, index, event) {
  if (event?.shiftKey) {
    const start = Math.min(checkAnchor, index),
      end = Math.max(checkAnchor, index);
    for (let n = start; n <= end; n++)
      checked.add(current.replace(/\/$/, "") + "/" + items[n].pathSuffix);
  } else {
    if (checked.has(path)) checked.delete(path);
    else checked.add(path);
    checkAnchor = index;
  }
  renderFiles();
  renderSelection();
  const row = [...document.querySelectorAll(".file-row")].find(
    (row) => row.dataset.path === path,
  );
  row
    ?.querySelector(
      event?.target?.matches?.("input") ? "input[type=checkbox]" : ".file-name",
    )
    ?.focus();
}
function renderSelection() {
  const node = document.getElementById("selectionActions");
  if (!node) return;
  node.replaceChildren();
  if (checked.size) {
    const pageSelected = items.every((item) =>
      checked.has(current.replace(/\/$/, "") + "/" + item.pathSuffix),
    );
    node.append(
      el(
        "div",
        { class: "selection-summary" },
        el(
          "strong",
          { role: "status" },
          `${checked.size} ${text("selected", "项已选")}`,
        ),
        pageSelected && count > checked.size
          ? button(
              text(
                "Select all " + count + " results",
                "选择全部 " + count + " 项",
              ),
              () => send("selectFiltered", { revision, filter }),
            )
          : null,
      ),
      el(
        "div",
        { class: "selection-tools" },
        button(s.download, () => manage.transfer("download", [...checked])),
        !state.connections.find((c) => c.id === selected)?.readOnly
          ? button(
              text("Delete", "删除"),
              () =>
                send("fileOperation", {
                  action: "delete",
                  connection: selected,
                  path: current,
                  paths: [...checked],
                }),
              { class: "danger" },
            )
          : null,
        iconButton("close", text("Clear selection", "取消选择"), () => {
          checked.clear();
          renderFiles();
          renderSelection();
          (
            document.querySelector("thead .row-check") ||
            document.getElementById("files")
          )?.focus();
        }),
      ),
    );
  }
}

const button = (label, action, options = {}) =>
  el(
    "button",
    { type: "button", title: label, onclick: action, ...options },
    label,
  );
function iconButton(name, label, action, options = {}) {
  return el(
    "button",
    {
      type: "button",
      class: "icon-button",
      title: label,
      "aria-label": label,
      onclick: action,
      ...options,
    },
    icon(name),
  );
}
const input = (id, value, type = "text", extra = {}) =>
  el("input", { id, name: id, value, type, ...extra });
const field = (label, node, tip, detailLabel) =>
  el(
    "div",
    { class: "field" },
    el(
      "div",
      { class: "field-label" },
      el("label", { for: node.id }, label),
      tip ? infoTip(label, tip, s, detailLabel) : null,
    ),
    node.type === "number" ? numberControl(node, label, s) : node,
  );
const dirty = () => connectionDirty;
function checkDialog(stage, text, accept, failureTitle = s.connectionFailed) {
  connectionDialog?.close();
  const busy =
    stage === "checking" || stage === "committing" || stage === "cancelling";
  const progressTitle =
    stage === "cancelling" ? s.cancelling : s.checkingConnection;
  const dialog = el(
    "dialog",
    {
      class:
        "connection-dialog" +
        (busy ? "" : " check-result") +
        (stage === "error" ? " check-failed" : ""),
      "aria-label": busy
        ? progressTitle
        : stage === "error"
          ? failureTitle
          : s.connectionPassed,
    },
    el(
      "div",
      { class: "check-heading" },
      busy
        ? el("span", { class: "spinner", "aria-hidden": "true" })
        : icon(stage === "error" ? "info" : "success"),
      el(
        "h2",
        {},
        busy
          ? progressTitle
          : stage === "error"
            ? failureTitle
            : s.connectionPassed,
      ),
    ),
    stage === "error" && text
      ? el(
          "p",
          {
            class: stage === "error" ? "error" : "",
            role: stage === "error" ? "alert" : "status",
          },
          text,
        )
      : null,
    el(
      "div",
      { class: "actions" },
      busy
        ? button(
            s.cancel,
            () => {
              send("cancelSave");
              saveAction = "";
              checkDialog("cancelling");
            },
            { disabled: stage !== "checking" },
          )
        : button(
            s.confirm,
            () => {
              dialog.close();
              accept?.();
            },
            { class: "primary", autofocus: true },
          ),
    ),
  );
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (stage === "checking") dialog.querySelector(".actions button")?.click();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (connectionDialog === dialog) connectionDialog = undefined;
  });
  document.body.append(dialog);
  connectionDialog = dialog;
  dialog.showModal();
}
function notice(text = "", error = false, code = "") {
  status = { text, error, code };
  const node = document.getElementById("notice");
  if (!node) return;
  node.className = error ? "notice error" : "notice";
  node.setAttribute("role", error ? "alert" : "status");
  node.replaceChildren(el("span", {}, text));
  node.hidden = !text;
  if (error && mode === "browse") {
    node.append(
      el(
        "div",
        { class: "actions" },
        ...recoveryActions(code)
          .filter(
            ({ action }) =>
              action !== "parent" || (pending?.path || current || "/") !== "/",
          )
          .map(({ action, label, focus }) =>
            button(s[label], () => recover(action, focus)),
          ),
      ),
    );
  }
}
function recover(action, focus) {
  if (action === "retry") lastAction?.();
  else if (action === "parent") parentFolder();
  else if (action === "editPath") {
    const field = document.getElementById("path");
    field?.focus();
    field?.select();
  } else if (action === "settings") openSettings({ focus });
}
function discardDrafts() {
  connectionDirty = false;
  connectionDraft = undefined;
}
function confirmDiscard(next) {
  if (saving) return;
  if (!dirty()) {
    next();
    return;
  }
  const dialog = el(
    "dialog",
    { "aria-label": s.unsaved },
    el("h2", {}, s.unsaved),
    el(
      "div",
      { class: "actions" },
      button(s.stay, () => dialog.close(), { autofocus: true }),
      button(
        s.discard,
        () => {
          discardDrafts();
          dialog.close();
          next();
        },
        { class: "primary" },
      ),
    ),
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
function stop() {
  clearTimeout(filterTimer);
  busy = false;
  send("cancel", { request: ++request });
}
function openSettings(options = {}) {
  if (mode === "settings") return;
  clearTimeout(filterTimer);
  if (busy) stop();
  rememberBrowse();
  settingsReturn = previewTarget
    ? {
        ...previewTarget,
        scroll: document.getElementById("files")?.scrollTop || 0,
      }
    : undefined;
  settingsFocus = options.focus;
  closePreview(false);
  mode = "settings";
  editId = selected || state.connections[0]?.id || "";
  notice();
  render();
}
function backToFiles() {
  for (const [key, draft] of preferenceDrafts)
    if (draft.timer) submitPreference(key, draft);
  if ([...preferenceDrafts.values()].some((draft) => draft.request)) {
    returnAfterPreferences = true;
    return;
  }
  confirmDiscard(() => {
    preferenceDrafts.clear();
    const target = settingsReturn;
    settingsReturn = undefined;
    mode = "browse";
    notice(
      browseReturn?.status.text,
      browseReturn?.status.error,
      browseReturn?.status.code,
    );
    render();
    if (browseReturn) {
      const files = document.getElementById("files");
      if (files) files.scrollTop = browseReturn.scroll;
      const path = document.getElementById("path");
      if (path && browseReturn.path !== undefined)
        path.value = browseReturn.path;
    }
    if (target && state.connections.some((c) => c.id === target.connection)) {
      if (target.tab)
        send("preview", {
          connection: target.connection,
          path: target.path,
          encoding: target.encoding,
        });
      else if (target.needsListing && target.connection === selected)
        navigate(
          target.path.split("/").slice(0, -1).join("/") || "/",
          undefined,
          target,
        );
      else if (target.connection === selected && hasListing) {
        document.getElementById("files").scrollTop = target.scroll || 0;
        previewFile(target.item, target.path, true, target.encoding);
        previewNode.focus();
      }
    }
  });
}
function rememberBrowse() {
  browseReturn = {
    scroll: document.getElementById("files")?.scrollTop || 0,
    path: document.getElementById("path")?.value,
    status: { ...status },
  };
}
function header() {
  return el(
    "header",
    { class: "app-header" },
    el(
      "div",
      { class: "brand" },
      mode === "settings"
        ? iconButton(
            "back",
            settingsReturn ? s.returnPreview : s.previewBack,
            backToFiles,
          )
        : mode === "favorites"
          ? iconButton("back", s.previewBack, () => {
              mode = "browse";
              render();
              document.getElementById("openFavorites")?.focus();
            })
          : icon("folder"),
      el(
        "h1",
        {},
        mode === "settings"
          ? s.settings
          : mode === "favorites"
            ? text("Favorites", "收藏")
            : "HDFS File Manager",
      ),
    ),
    el("span", { class: "host", title: s.hostHint }, state.host),
    mode !== "browse" ? null : iconButton("settings", s.settings, openSettings),
  );
}
function render() {
  closeFileMenu();
  closePopup();
  document.documentElement.lang = state.preferences.language;
  app.className = mode;
  app.replaceChildren(header());
  if (mode === "settings") renderSettings();
  else if (mode === "favorites") renderFavorites();
  else {
    renderBrowse();
    manage.restorePanel();
  }
  enhanceSelects(app);
  notice(status.text, status.error, status.code);
  if (mode === "settings" && settingsFocus) {
    const target = document.getElementById(settingsFocus);
    const details = target?.closest("details");
    if (details) details.open = true;
    if (target?.tagName === "DETAILS") target.open = true;
    (target?.tagName === "DETAILS"
      ? target.querySelector("summary")
      : target
    )?.focus();
    if (target?.tagName === "SELECT")
      document.getElementById(target.id + "Control")?.focus();
    target?.scrollIntoView?.({ block: "nearest" });
    settingsFocus = undefined;
  }
}
function parentFolder() {
  const path =
    pending?.path || current || document.getElementById("path")?.value || "/";
  if (path !== "/") navigate(path.split("/").slice(0, -1).join("/") || "/");
}
function closePreview(restoreFocus = true) {
  if (!previewTarget) return;
  previewTarget = undefined;
  previewRequest++;
  send("cancelPreview");
  previewView?.clear();
  if (previewNode) previewNode.hidden = true;
  document.getElementById("fileArea")?.classList.remove("with-preview");
  if (restoreFocus) {
    [...document.querySelectorAll(".file-row")]
      .find((row) => row.dataset.path === selectedPath)
      ?.querySelector(".file-name")
      ?.focus();
  }
}
function previewFile(item, path, force = false, encoding) {
  if (
    !force &&
    previewTarget?.path === path &&
    previewTarget.connection === selected
  )
    return;
  encoding = normalizeEncoding(
    encoding ??
      (previewTarget?.path === path ? previewTarget.encoding : "auto"),
  );
  previewTarget = { item, path, connection: selected, encoding };
  if (!previewNode) {
    previewNode = el("aside", {
      id: "previewPane",
      class: "preview-pane",
      "aria-label": s.preview,
      tabindex: -1,
    });
    previewView = createPreview(
      previewNode,
      (type, extra = {}) => {
        if (!previewTarget) return;
        const { connection, path, item } = previewTarget;
        if (type === "browse") closePreview();
        else if (type === "retry") previewFile(item, path, true);
        else if (type === "encoding")
          previewFile(item, path, true, extra.encoding);
        else if (type === "settings") openSettings(extra);
        else if (type === "parent")
          navigate(path.split("/").slice(0, -1).join("/") || "/");
        else if (type === "cancel") {
          send("cancelPreview");
          previewRequest++;
          void previewView.show({
            type: "cancelled",
            language: state.preferences.language,
            path,
          });
        } else if (type === "openTab")
          send("preview", {
            connection,
            path,
            encoding: previewTarget.encoding,
          });
        else send(type, { connection, path });
      },
      { inline: true },
    );
  }
  previewNode.hidden = false;
  previewNode.setAttribute("aria-label", s.preview);
  const area = document.getElementById("fileArea");
  area.append(previewNode);
  area.classList.add("with-preview");
  void previewView.show({
    type: "loading",
    language: state.preferences.language,
    path,
  });
  if (window.matchMedia?.("(max-width: 800px)")?.matches) previewNode.focus();
  send("preview", {
    connection: selected,
    path,
    inline: true,
    previewRequest: ++previewRequest,
    encoding,
  });
}
function selectEntry(item, path, preview = true) {
  selectedPath = path;
  for (const row of document.querySelectorAll(".file-row")) {
    const active = row.dataset.path === path;
    row.classList.toggle("selected", active);
    row.setAttribute(
      "aria-selected",
      String(active || checked.has(row.dataset.path)),
    );
    if (active) row.querySelector(".file-name")?.focus();
  }
  if (preview && item.type === "FILE") previewFile(item, path);
  else if (previewTarget?.path !== path) closePreview(false);
}
function menuContext(section, path) {
  return JSON.stringify({
    webviewSection: section,
    hdfsConnection: selected,
    hdfsPath: path,
    hdfsRevision: revision,
    hdfsCanGoUp: current !== "/",
    preventDefaultContextMenuItems: true,
  });
}
function captureDrafts() {
  const connection = document.getElementById("connectionForm");
  if (connection && connectionDirty) {
    const value = (id) => connection.querySelector("#" + id).value;
    connectionDraft = {
      id: editId,
      name: value("name"),
      endpoint: value("endpoint"),
      root: value("root"),
      auth: value("auth"),
      username: value("username"),
      timeout: value("timeout"),
      readOnly: connection.querySelector("#readOnly").checked,
      secret: value("secret"),
    };
  }
}
function changeEditedConnection(id) {
  const apply = () => {
    connectionDraft = undefined;
    connectionDirty = false;
    editId = id;
    render();
  };
  if (connectionDirty) confirmDiscard(apply);
  else apply();
}
function renderSettings() {
  const existing = state.connections.find((c) => c.id === editId);
  const connection =
    connectionDraft?.id === editId
      ? connectionDraft
      : existing || {
          name: "",
          endpoint: "",
          root: "/",
          auth: "simple",
          username: "",
          timeout: 30,
        };
  const select = el(
    "select",
    {
      id: "editConnection",
      "aria-label": s.useSaved,
      onchange: (event) => {
        const id = event.target.value;
        changeEditedConnection(id);
        event.target.value = editId;
      },
    },
    el("option", { value: "", selected: !editId }, s.newConnection),
    state.connections.map((c) =>
      el("option", { value: c.id, selected: c.id === editId }, c.name),
    ),
  );
  const chooser = el(
    "div",
    { class: "connection-chooser" },
    select,
    iconButton("plus", s.add, () => changeEditedConnection(""), {
      id: "addConnection",
    }),
  );
  const form = el("form", {
    id: "connectionForm",
    novalidate: true,
    oninput: () => {
      connectionDirty = true;
      captureDrafts();
      updateDirty();
    },
    onsubmit: (event) => {
      event.preventDefault();
      captureDrafts();
      saveAction = event.submitter?.id === "saveOpen" ? "open" : "";
      saveConnection(form);
    },
  });
  const controls = el("fieldset", { disabled: !!saving });
  controls.append(
    field(
      s.name,
      input("name", connection.name, "text", {
        required: true,
        maxlength: 120,
        autocomplete: "off",
        placeholder: "Analytics",
      }),
    ),
    field(
      s.endpoint,
      input("endpoint", connection.endpoint, "url", {
        required: true,
        spellcheck: "false",
        placeholder: "https://hdfs.example.org/webhdfs/v1",
      }),
      s.endpointHelp,
      s.settingHelp,
    ),
    field(
      s.root,
      input("root", connection.root, "text", {
        required: true,
        spellcheck: "false",
      }),
    ),
  );
  const auth = el(
    "select",
    {
      id: "auth",
      onchange: () => {
        updateAuth();
        connectionDirty = true;
        captureDrafts();
        updateDirty();
      },
    },
    ["none", "simple", "basic", "bearer", "delegation"].map((key) =>
      el("option", { value: key, selected: key === connection.auth }, s[key]),
    ),
  );
  controls.append(
    field(s.auth, auth, () => s.authDescriptions[auth.value], s.settingHelp),
    field(
      s.username,
      input("username", connection.username, "text", { autocomplete: "off" }),
    ),
    field(
      s.secret,
      input("secret", connection.secret || "", "password", {
        autocomplete: "new-password",
        placeholder: existing ? s.secretHint : "",
        maxlength: 16384,
      }),
    ),
    el(
      "div",
      { class: "network-settings" },
      field(
        s.timeout,
        input("timeout", connection.timeout, "number", {
          min: 2,
          max: 300,
          required: true,
        }),
        s.timeoutHelp,
        s.limitInfo,
      ),
    ),
  );
  controls.append(
    el(
      "div",
      { class: "setting-toggle" },
      el(
        "div",
        { class: "field-label" },
        el("label", { for: "readOnly" }, s.readOnlySetting),
        infoTip(s.readOnlySetting, s.readOnlyHelp, s, s.settingHelp),
      ),
      input("readOnly", "", "checkbox", {
        role: "switch",
        class: "switch-control",
        checked: connection.readOnly === true,
      }),
    ),
  );
  controls.append(
    el(
      "div",
      { class: "actions form-actions" },
      el(
        "button",
        { type: "submit", id: "saveOpen", class: "primary" },
        s.saveOpen,
      ),
      existing
        ? button(
            s.remove,
            () => {
              if (dirty()) confirmDiscard(() => send("remove", { id: editId }));
              else send("remove", { id: editId });
            },
            { class: "danger" },
          )
        : null,
    ),
    el("span", { id: "dirtyStatus", class: "muted", role: "status" }),
  );
  form.append(controls);
  function updateAuth() {
    const user = controls.querySelector("#username"),
      secret = controls.querySelector("#secret");
    const needsUser = ["simple", "basic"].includes(auth.value),
      needsSecret = ["basic", "bearer", "delegation"].includes(auth.value);
    user.closest(".field").hidden = !needsUser;
    user.required = needsUser;
    secret.closest(".field").hidden = !needsSecret;
    secret.required = needsSecret && !existing;
    secret.placeholder =
      existing && auth.value === existing.auth ? s.secretHint : "";
    controls.querySelector('label[for="secret"]').textContent =
      auth.value === "basic" ? s.password : s.token;
  }
  updateAuth();

  const prefForm = el("form", {
    id: "preferencesForm",
    novalidate: true,
    onsubmit: (event) => event.preventDefault(),
    oninput: (event) => changePreferenceField(event.target, true),
    onchange: (event) => changePreferenceField(event.target, false),
  });
  prefForm.append(
    el(
      "fieldset",
      {},
      preferenceField(
        s.language,
        el(
          "select",
          { id: "language" },
          [
            ["auto", "Auto"],
            ["en", "English"],
            ["zh-CN", "简体中文"],
          ].map(([value, label]) =>
            el(
              "option",
              {
                value,
                selected: preferenceValue("language") === value,
              },
              label,
            ),
          ),
        ),
      ),
      preferenceField(
        s.defaultDownloadTarget,
        el(
          "select",
          {
            id: "downloadTarget",
            disabled: !state.remote || state.localTransfer === false,
          },
          ...(state.remote && state.localTransfer !== false
            ? [
                el(
                  "option",
                  {
                    value: "host",
                    selected: preferenceValue("downloadTarget") === "host",
                  },
                  state.hostName || state.host,
                ),
                el(
                  "option",
                  {
                    value: "local",
                    selected: preferenceValue("downloadTarget") === "local",
                  },
                  s.thisComputer,
                ),
              ]
            : [
                el(
                  "option",
                  { value: state.remote ? "host" : "local", selected: true },
                  state.remote ? state.hostName || state.host : s.thisComputer,
                ),
              ]),
        ),
      ),
      preferenceField(
        s.textLimit,
        input("textLimit", preferenceValue("textLimit"), "number", {
          min: 1,
          max: 4,
          required: true,
        }),
        s.textLimitHelp,
      ),
      preferenceField(
        s.mediaLimit,
        input("mediaLimit", preferenceValue("mediaLimit"), "number", {
          min: 1,
          max: 50,
          required: true,
        }),
        s.mediaLimitHelp,
      ),
      el(
        "div",
        { class: "preview-help" },
        el("h2", {}, s.previewFormats),
        el("p", {}, s.previewFormatsDetail),
      ),
    ),
  );
  const connectionSection = el(
    "section",
    { class: "connection-settings" },
    el("h2", {}, s.connections),
    chooser,
    form,
  );
  const prefsSection = el(
    "section",
    { class: "preferences-settings" },
    el("h2", {}, s.global),
    prefForm,
  );
  app.append(
    el("div", { id: "notice", role: "status", class: "notice" }),
    el("div", { class: "settings-grid" }, connectionSection, prefsSection),
  );
  updateDirty();
}
function updateDirty() {
  const status = document.getElementById("dirtyStatus");
  if (status) status.textContent = connectionDirty ? s.unsavedLabel : "";
  setSaving();
}
function setSaving() {
  for (const id of ["editConnection", "addConnection", "saveOpen"]) {
    const node = document.getElementById(id);
    if (node) node.disabled = !!saving;
  }
  const controls = document.querySelector("#connectionForm fieldset");
  if (controls) controls.disabled = !!saving;
  syncSelects();
}
function preferenceValue(key) {
  const draft = preferenceDrafts.get(key);
  if (draft) return draft.value;
  if (key === "language")
    return state.languageSetting ?? state.preferences.language;
  if (key === "downloadTarget")
    return state.preferences.downloadTarget ?? "host";
  return state.preferences[key] / MiB;
}
function preferenceError(input, error) {
  if (!error) return "";
  return error === "invalid"
    ? s.previewLimitError.replace("{max}", input.max)
    : s.preferenceSaveError;
}
function preferenceField(label, input, tip) {
  const row = field(label, input, tip);
  const error = preferenceError(input, preferenceDrafts.get(input.id)?.error);
  if (error) input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", input.id + "Error");
  row.append(
    el(
      "p",
      {
        id: input.id + "Error",
        class: "field-error",
        "aria-live": "polite",
      },
      error,
    ),
  );
  return row;
}
function showPreferenceError(key, error) {
  const input = document.getElementById(key);
  const message = document.getElementById(key + "Error");
  if (!input || !message) return;
  message.textContent = preferenceError(input, error);
  for (const control of [input, document.getElementById(key + "Control")]) {
    if (!control) continue;
    if (error) control.setAttribute("aria-invalid", "true");
    else control.removeAttribute("aria-invalid");
  }
}
function submitPreference(key, draft) {
  clearTimeout(draft.timer);
  draft.timer = undefined;
  draft.request = ++preferenceRequest;
  send("savePreference", {
    key,
    value:
      key === "textLimit" || key === "mediaLimit"
        ? Number(draft.value) * MiB
        : draft.value,
    request: draft.request,
  });
}
function changePreferenceField(input, defer) {
  const key = input.id;
  const numeric = key === "textLimit" || key === "mediaLimit";
  if (!numeric && key !== "language" && key !== "downloadTarget") return;
  const previous = preferenceDrafts.get(key);
  if (!previous && input.value === String(preferenceValue(key))) return;
  if (previous?.value === input.value && previous.error !== "save") {
    if (!defer && previous.timer) submitPreference(key, previous);
    return;
  }
  clearTimeout(previous?.timer);
  const draft = {
    value: input.value,
    error: numeric && !input.validity.valid ? "invalid" : "",
  };
  preferenceDrafts.set(key, draft);
  showPreferenceError(key, draft.error);
  if (draft.error) return;
  if (numeric && defer)
    draft.timer = setTimeout(() => submitPreference(key, draft), 300);
  else submitPreference(key, draft);
}
function saveConnection(form) {
  if (saving) return;
  const value = (id) => form.querySelector("#" + id).value;
  saving = "connection";
  setSaving();
  checkDialog("checking");
  send("save", {
    check: true,
    request: ++saveRequest,
    connection: {
      id: editId,
      name: value("name"),
      endpoint: value("endpoint"),
      root: value("root"),
      auth: value("auth"),
      username: value("username"),
      timeout: Number(value("timeout")),
      readOnly: form.querySelector("#readOnly").checked,
    },
    secret: value("secret"),
  });
}
function renderBrowse() {
  if (!state.connections.length) {
    app.append(
      el(
        "section",
        { class: "welcome empty" },
        icon("folder"),
        el("h2", {}, s.welcome),
        el("p", {}, s.welcomeDetail),
        button(s.add, openSettings, { class: "primary" }),
      ),
    );
    return;
  }
  if (!state.connections.some((c) => c.id === selected)) {
    selected = state.connections[0].id;
    resetListing();
  }
  const connection = state.connections.find((c) => c.id === selected);
  const select = el(
    "select",
    {
      id: "connection",
      "aria-label": s.connection,
      onchange: (event) => {
        selected = event.target.value;
        resetListing();
        filter = "";
        history = [];
        index = -1;
        navigate(state.connections.find((c) => c.id === selected).root);
      },
    },
    state.connections.map((c) =>
      el("option", { value: c.id, selected: c.id === selected }, c.name),
    ),
  );
  const connectionBar = el(
    "div",
    { class: "connectionbar" },
    select,
    !hasListing && !busy
      ? button(s.connect, () => navigate(current || connection.root), {
          class: "primary",
        })
      : null,
    el(
      "details",
      { class: "connection-menu" },
      el(
        "summary",
        { title: s.connectionMenu, "aria-label": s.connectionMenu },
        icon("more"),
      ),
      el(
        "div",
        { class: "connection-actions" },
        button(s.connectionSettings, openSettings),
        button(
          s.disconnect,
          () => {
            request++;
            send("disconnect");
          },
          { disabled: !hasListing && !busy },
        ),
      ),
    ),
  );
  const pathInput = input(
    "path",
    pending?.path || current || connection.root,
    "text",
    { "aria-label": s.path, spellcheck: "false" },
  );
  const pathBar = el(
    "form",
    {
      class: "pathbar",
      onsubmit: (event) => {
        event.preventDefault();
        navigate(pathInput.value);
      },
    },
    el(
      "div",
      { class: "navigation-group" },
      iconButton("back", s.back, () => travel(-1), { disabled: index <= 0 }),
      iconButton("forward", s.forward, () => travel(1), {
        disabled: index >= history.length - 1,
      }),
      button([icon("up"), s.upShort], parentFolder, {
        class: "up-button quiet",
        title: s.up + " (Alt+↑)",
        "aria-label": s.up,
        disabled: (pending?.path || current || pathInput.value) === "/",
      }),
    ),
    el(
      "div",
      { class: "path-input" },
      pathInput,
      iconButton("go", s.go, () => navigate(pathInput.value)),
    ),
    iconButton(
      "refresh",
      s.refresh,
      () => navigate(pending?.path || current || pathInput.value),
      { disabled: busy },
    ),
  );
  const breadcrumbs = el(
    "nav",
    { class: "breadcrumbs", "aria-label": s.path },
    button("/", () => navigate("/")),
  );
  let prefix = "";
  for (const segment of (current || connection.root)
    .split("/")
    .filter(Boolean)) {
    if (prefix) breadcrumbs.append(el("span", { "aria-hidden": true }, "/"));
    prefix += "/" + segment;
    const path = prefix;
    breadcrumbs.append(button(segment, () => navigate(path), { title: path }));
  }
  const filterInput = input("filter", filter, "search", {
    placeholder: s.filter,
    "aria-label": s.filterLabel,
    title: s.notRecursive,
    disabled: !hasListing,
    oninput: (event) => {
      checked.clear();
      renderSelection();
      filter = event.target.value;
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => requestPage(0), 120);
    },
  });
  app.append(
    connectionBar,
    el(
      "div",
      { class: "management-toolbar" },
      !connection.readOnly
        ? el(
            "div",
            { class: "management-group" },
            button(
              text("Upload", "上传"),
              () => manage.transfer("upload", []),
              {
                disabled: !hasListing,
              },
            ),
            button(text("New folder", "新建文件夹"), () => operation("mkdir"), {
              disabled: !hasListing,
            }),
          )
        : null,
      el(
        "div",
        { class: "management-group management-tools" },
        button(
          text("Favorites", "收藏"),
          () => {
            closePreview(false);
            mode = "favorites";
            render();
            (
              document.querySelector(".favorite-open") ||
              document.querySelector(".brand button")
            )?.focus();
          },
          { id: "openFavorites" },
        ),
        button(
          [text("Transfers", "传输"), el("span", { id: "transferCount" })],
          () => manage.showTasks(),
          { id: "openTransfers", title: text("Transfers", "传输") },
        ),
      ),
    ),
    pathBar,
    el(
      "div",
      { class: "folderbar" },
      breadcrumbs,
      el("div", { class: "search" }, icon("search"), filterInput),
    ),
    el("div", {
      id: "notice",
      class: "notice",
      role: "status",
      "aria-live": "polite",
    }),
    el(
      "div",
      {
        id: "fileArea",
        class: "file-area" + (previewTarget ? " with-preview" : ""),
      },
      el("div", {
        id: "files",
        class: "files",
        tabindex: "-1",
        "aria-label": s.browse,
      }),
      previewTarget ? previewNode : null,
    ),
    el(
      "footer",
      {},
      el("div", { id: "counts", class: "counts", role: "status" }),
      el("div", { id: "pagination", class: "pagination" }),
    ),
  );
  app.insertBefore(
    el("div", {
      id: "selectionActions",
      class: "selection-actions",
      role: "toolbar",
      "aria-label": text("Selection", "选择操作"),
    }),
    document.getElementById("fileArea"),
  );
  renderSelection();
  renderFiles();
}
function fileMenu(event, item, path) {
  closeFileMenu();
  document.querySelector(".file-menu")?.remove();
  const menu = el("div", { class: "file-menu", role: "menu" });
  const add = (label, fn, danger = false) =>
    menu.append(
      button(
        label,
        () => {
          menu.remove();
          fn();
        },
        { role: "menuitem", class: danger ? "danger" : "" },
      ),
    );
  if (item.type === "DIRECTORY")
    add(text("Open folder", "打开文件夹"), () => navigate(path));
  else if (item.type === "FILE") {
    add(s.preview, () => selectEntry(item, path));
    add(text("Open in new tab", "在新标签页打开"), () =>
      send("preview", { connection: selected, path }),
    );
  }
  if (item.type !== "SYMLINK")
    add(s.download, () => manage.transfer("download", chosen(path)));
  add(s.copy, () => send("copy", { path }));
  add(s.copyName, () => send("copy", { path, nameOnly: true }));
  add(s.info, () => information(item, path));
  if (!state.connections.find((c) => c.id === selected)?.readOnly) {
    if (checked.size < 2)
      add(text("Rename", "重命名"), () => operation("rename", path));
    add(text("Delete", "删除"), () => operation("delete", path), true);
  }
  document.body.append(menu);
  menu.style.left =
    Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) +
    "px";
  menu.style.top =
    Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8)) +
    "px";
  menu.querySelector("button")?.focus();
  const cleanup = () => {
    menu.remove();
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", key);
    closeFileMenu = () => {};
  };
  const outside = (e) => {
    if (!menu.contains(e.target)) cleanup();
  };
  const key = (e) => {
    const buttons = [...menu.querySelectorAll("button")],
      i = buttons.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      buttons[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length
      ]?.focus();
    }
  };
  closeFileMenu = cleanup;
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", key);
  menu.addEventListener("click", cleanup, { once: true });
}
function resetListing() {
  navigationReturn = undefined;
  pending = undefined;
  closePreview(false);
  selectedPath = "";
  items = [];
  total = count = 0;
  page = 0;
  hasListing = false;
  pagePending = false;
  revision = undefined;
  current = "";
}
function navigate(path, historyIndex, restorePreview, favoritePath) {
  checked.clear();
  if (!path) {
    notice(s.noPath, true);
    return;
  }
  clearTimeout(filterTimer);
  if (hasListing)
    navigationReturn = {
      items,
      total,
      count,
      page,
      revision,
      current,
      filter,
      selectedPath,
      scroll: document.getElementById("files")?.scrollTop || 0,
    };
  focusAfterListing =
    document.activeElement?.id === "path" ||
    document.activeElement?.classList.contains("file-name");
  closePreview(false);
  selectedPath = "";
  previewAfterListing = undefined;
  favoriteAfterListing = undefined;
  pending = {
    path,
    historyIndex,
    request: ++request,
    restorePreview,
    favoritePath,
  };
  lastAction = () => navigate(path, historyIndex, restorePreview, favoritePath);
  busy = true;
  busyScope = "navigate";
  hasListing = false;
  items = [];
  total = count = 0;
  notice();
  render();
  send("navigate", { connection: selected, path, request });
}

function travel(delta) {
  const next = index + delta;
  if (next >= 0 && next < history.length) navigate(history[next], next);
}
function requestPage(next = 0) {
  if (!hasListing) return;
  send("page", {
    filter,
    page: next,
    pageSize,
    sort,
    descending,
    revision,
    pageRequest: ++pageRequest,
    focusName: favoriteAfterListing?.slice(
      favoriteAfterListing.lastIndexOf("/") + 1,
    ),
  });
}
function renderFiles() {
  closeFileMenu();
  closePopup();
  const files = document.getElementById("files");
  if (!files) return;
  const focusedSort = document.activeElement?.dataset.sort;
  const focusedPager = document.activeElement?.closest("#pagination")
    ? document.activeElement.id
    : "";
  files.replaceChildren();
  if (hasListing)
    files.dataset.vscodeContext = menuContext("background", current);
  else delete files.dataset.vscodeContext;
  files.setAttribute("aria-busy", String(busy || pagePending));
  if ((busy && busyScope === "navigate") || (pagePending && !items.length)) {
    files.append(
      el(
        "div",
        { class: "load-status", role: "status" },
        s.loadingDirectory,
        busy ? button(s.cancel, stop) : null,
      ),
      el(
        "div",
        { class: "skeletons", "aria-hidden": true },
        Array.from({ length: 7 }, () => el("div", { class: "skeleton-row" })),
      ),
    );
  } else if (!items.length && !(status.error && !hasListing)) {
    files.append(
      el(
        "div",
        { class: "empty compact" },
        icon(hasListing ? "folder" : "file"),
        el(
          "h2",
          {},
          hasListing
            ? filter
              ? s.noMatchTitle
              : s.emptyTitle
            : s.notLoadedTitle,
        ),
        el(
          "p",
          {},
          hasListing ? (filter ? s.noMatchDetail : "") : s.notLoadedDetail,
        ),
        filter && hasListing
          ? button(s.clearFilter, () => {
              filter = "";
              document.getElementById("filter").value = "";
              requestPage();
            })
          : null,
      ),
    );
  } else if (items.length) {
    const heading = (key, label, css) =>
      el(
        "th",
        {
          scope: "col",
          class: css,
          "aria-sort":
            sort === key ? (descending ? "descending" : "ascending") : "none",
        },
        button(
          label + (sort === key ? (descending ? " ↓" : " ↑") : ""),
          () => {
            descending = sort === key ? !descending : false;
            sort = key;
            requestPage();
          },
          { title: s.sortBy + ": " + label, "data-sort": key },
        ),
      );
    const body = el("tbody");
    const selectedOnPage = items.filter((item) =>
      checked.has(current.replace(/\/$/, "") + "/" + item.pathSuffix),
    ).length;
    const table = el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el(
            "th",
            { class: "name-cell", scope: "col" },
            el(
              "div",
              { class: "name-content" },
              el("input", {
                type: "checkbox",
                class: "row-check",
                "aria-label": text("Select page", "全选本页"),
                checked: selectedOnPage === items.length,
                onchange: (e) => {
                  for (const item of items) {
                    const p =
                      current.replace(/\/$/, "") + "/" + item.pathSuffix;
                    if (e.target.checked) checked.add(p);
                    else checked.delete(p);
                  }
                  renderFiles();
                  renderSelection();
                  files.querySelector("thead .row-check")?.focus();
                },
              }),
              button(
                s.name + (sort === "name" ? (descending ? " ↓" : " ↑") : ""),
                () => {
                  descending = sort === "name" ? !descending : false;
                  sort = "name";
                  requestPage();
                },
                { "data-sort": "name" },
              ),
            ),
          ),
          heading("size", s.size, "size"),
          heading("modified", s.modified, "modified"),
          el(
            "th",
            { class: "row-actions", scope: "col" },
            el("span", { class: "sr-only" }, s.information),
          ),
        ),
      ),
      body,
    );
    items.forEach((item, rowIndex) => {
      const path = current.replace(/\/$/, "") + "/" + item.pathSuffix;
      const open = () => {
        if (item.type === "DIRECTORY") navigate(path);
        else if (item.type === "SYMLINK") information(item, path);
        else selectEntry(item, path);
      };
      const name = button(
        filename(item.pathSuffix, item.type),
        (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey)
            toggleCheck(item, path, rowIndex, event);
          else selectEntry(item, path);
        },
        {
          class: "file-name",
          "aria-label": item.pathSuffix,
          title:
            path +
            " · " +
            (item.type === "DIRECTORY"
              ? s.openFolderHint
              : item.type === "SYMLINK"
                ? s.info
                : s.preview),
          "data-row": rowIndex,
          onkeydown: (event) => {
            if (
              !event.altKey &&
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              const n =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          items.length - 1,
                          rowIndex + (event.key === "ArrowDown" ? 1 : -1),
                        ),
                      );
              const next = items[n];
              selectEntry(
                next,
                current.replace(/\/$/, "") + "/" + next.pathSuffix,
                checked.size === 0,
              );
            }
            if (event.key === " ") {
              event.preventDefault();
              toggleCheck(item, path, rowIndex, event);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              open();
            }
          },
        },
      );
      body.append(
        el(
          "tr",
          {
            class:
              "file-row" +
              (selectedPath === path ? " selected" : "") +
              (checked.has(path) ? " checked" : ""),
            "data-path": path,
            "data-vscode-context": menuContext(item.type.toLowerCase(), path),
            "aria-selected": String(selectedPath === path || checked.has(path)),
            oncontextmenu: (event) => {
              event.preventDefault();
              if (!checked.has(path)) {
                checked.clear();
                for (const row of files.querySelectorAll(".file-row.checked")) {
                  row.classList.remove("checked");
                  row.setAttribute("aria-selected", "false");
                  row.querySelector(".row-check").checked = false;
                }
                const headerCheck = files.querySelector("thead .row-check");
                headerCheck.checked = headerCheck.indeterminate = false;
                renderSelection();
              }
              selectEntry(item, path, false);
              fileMenu(event, item, path);
            },
            onclick: (event) => {
              if (!event.target.closest("button,input")) {
                if (event.metaKey || event.ctrlKey || event.shiftKey)
                  toggleCheck(item, path, rowIndex, event);
                else selectEntry(item, path);
              }
            },
            ondblclick: (event) => {
              if (
                !event.target.closest(".row-actions button,input") &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey
              )
                open();
            },
          },
          el(
            "td",
            { class: "name-cell" },
            el(
              "div",
              { class: "name-content" },
              el("input", {
                type: "checkbox",
                class: "row-check",
                checked: checked.has(path),
                "aria-label": text("Select ", "选择 ") + item.pathSuffix,
                onclick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleCheck(item, path, rowIndex, event);
                },
              }),
              fileIcon(item.pathSuffix, item.type, s),
              name,
            ),
          ),
          el(
            "td",
            { class: "size" },
            item.type === "DIRECTORY" ? "" : size(item.length),
          ),
          el(
            "td",
            {
              class: "modified",
              title: new Date(item.modificationTime).toLocaleString(
                state.preferences.language,
              ),
            },
            new Date(item.modificationTime).toLocaleDateString(
              state.preferences.language,
            ),
          ),
          el(
            "td",
            { class: "row-actions" },
            starButton(path, item.pathSuffix, item.type),
            iconButton("info", s.info + ": " + item.pathSuffix, () =>
              information(item, path),
            ),
            item.type !== "SYMLINK"
              ? iconButton(
                  "download",
                  s.download + ": " + item.pathSuffix,
                  () =>
                    item.type === "FILE"
                      ? send("download", { connection: selected, path })
                      : manage.transfer("download", [path]),
                )
              : null,
          ),
        ),
      );
    });
    table.querySelector("thead .row-check").indeterminate =
      selectedOnPage > 0 && selectedOnPage < items.length;
    files.append(table);
  }
  const counts = document.getElementById("counts");
  counts.textContent =
    !hasListing || (busy && busyScope === "navigate")
      ? ""
      : filter
        ? count.toLocaleString() +
          " / " +
          total.toLocaleString() +
          " " +
          s.items
        : total.toLocaleString() + " " + s.items;
  const pagination = document.getElementById("pagination");
  pagination.replaceChildren();
  if (hasListing)
    pagination.append(
      el(
        "select",
        {
          id: "pageSize",
          "aria-label": s.pageSize,
          disabled: busy,
          onchange: (event) => {
            const offset = page * pageSize;
            pageSize = normalizePageSize(event.target.value);
            vscode.setState({ selected, path: current, pageSize });
            requestPage(Math.floor(offset / pageSize));
          },
        },
        pageSizes.map((value) =>
          el(
            "option",
            { value, selected: value === pageSize },
            s.perPage.replace("{count}", value),
          ),
        ),
      ),
      iconButton("back", s.previousPage, () => requestPage(page - 1), {
        id: "previousPage",
        disabled: !page || busy,
      }),
      el(
        "span",
        {
          class: "page-position",
          "aria-label": s.pagePosition
            .replace("{page}", page + 1)
            .replace("{pages}", Math.max(1, Math.ceil(count / pageSize))),
        },
        s.pagePosition
          .replace("{page}", page + 1)
          .replace("{pages}", Math.max(1, Math.ceil(count / pageSize))),
      ),
      iconButton("forward", s.nextPage, () => requestPage(page + 1), {
        id: "nextPage",
        disabled: (page + 1) * pageSize >= count || busy,
      }),
    );
  enhanceSelects(pagination);
  if (focusedSort)
    files.querySelector('[data-sort="' + focusedSort + '"]')?.focus();
  if (focusedPager) {
    const button = document.getElementById(focusedPager);
    if (button && !button.disabled) button.focus();
    else pagination.querySelector("button:not(:disabled)")?.focus();
  }
}
function information(item, path) {
  const list = el("dl");
  for (const [key, value] of [
    [s.path, path],
    [s.type, typeLabel(item.pathSuffix, item.type, s)],
    ...(item.type === "FILE" ? [[s.size, size(item.length)]] : []),
    [s.owner, item.owner],
    [s.group, item.group],
    [s.permission, item.permission],
    [
      s.modified,
      new Date(item.modificationTime).toLocaleString(
        state.preferences.language,
      ),
    ],
  ])
    list.append(el("dt", {}, key), el("dd", {}, value));
  const dialog = el(
    "dialog",
    { "aria-label": s.info },
    el(
      "div",
      { class: "dialog-heading" },
      el(
        "h2",
        { title: item.pathSuffix },
        fileIcon(item.pathSuffix, item.type, s),
        filename(item.pathSuffix, item.type),
      ),
      iconButton("close", s.close, () => dialog.close()),
    ),
    list,
    el(
      "div",
      { class: "actions" },
      button(
        s.copy,
        () => {
          send("copy", { path });
          dialog.close();
        },
        { class: "primary" },
      ),
    ),
  );
  dialog.addEventListener("close", () => dialog.remove());
  let startedOutside = false;
  const outside = (event) => {
    const bounds = dialog.getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  };
  dialog.addEventListener("pointerdown", (event) => {
    startedOutside = event.target === dialog && outside(event);
  });
  dialog.addEventListener("click", (event) => {
    if (startedOutside && event.target === dialog && outside(event))
      dialog.close();
    startedOutside = false;
  });
  document.body.append(dialog);
  dialog.showModal();
}
window.addEventListener("message", ({ data: message }) => {
  if (message.type === "selection") {
    if (message.revision === revision && message.filter === filter) {
      checked.clear();
      for (const path of message.paths) checked.add(path);
      renderFiles();
      renderSelection();
    }
    return;
  }
  if (manage.receive(message)) return;
  if (message.type === "manageAction") {
    selected = message.connection;
    if (message.action === "upload") manage.transfer("upload", []);
    else if (message.action === "download")
      manage.transfer("download", [message.path]);
    else
      send("place", {
        action: "toggle",
        connection: selected,
        path: message.path,
      });
    return;
  }
  if (message.type === "places") {
    state.places = message.places;
    const starred = new Set(favorites().map((item) => item.path));
    for (const control of document.querySelectorAll("[data-star]"))
      updateStar(control, starred.has(control.dataset.star));
    return;
  }
  if (message.type === "taskNavigate") {
    selected = message.connection;
    navigate(message.path);
    return;
  }
  if (message.type === "filesChanged") {
    checked.clear();
    if (mode === "browse" && hasListing) navigate(current);
    return;
  }
  if (message.type === "connectionCommitting") {
    if (message.request === saveRequest && saving === "connection")
      checkDialog("committing");
    return;
  }
  if (
    message.type === "preferenceSaved" ||
    message.type === "preferenceError"
  ) {
    const { key } = message;
    const draft = preferenceDrafts.get(key);
    const current = draft?.request === message.request && !!draft;
    if (message.type === "preferenceSaved") {
      const changedLanguage =
        state.preferences.language !== message.preferences.language;
      Object.assign(state, {
        preferences: message.preferences,
        languageSetting: message.languageSetting,
        host: message.host,
      });
      if (current) preferenceDrafts.delete(key);
      if (changedLanguage) {
        if (mode === "settings")
          settingsFocus = document.activeElement?.id?.replace(/Control$/, "");
        s = strings(state.preferences.language);
        render();
      }
      if (
        returnAfterPreferences &&
        mode === "settings" &&
        ![...preferenceDrafts.values()].some(
          (entry) => entry.request || entry.timer,
        )
      ) {
        returnAfterPreferences = false;
        backToFiles();
      }
    } else if (current) {
      draft.request = undefined;
      draft.error = "save";
      returnAfterPreferences = false;
      showPreferenceError(key, draft.error);
    }
    return;
  }
  if (message.type === "error" && message.scope === "save") {
    if (message.request !== undefined && message.request !== saveRequest)
      return;
    saving = "";
    saveAction = "";
    setSaving();
    if (message.code !== "cancelled")
      checkDialog("error", message.text, () => {
        const field = {
          endpoint: "endpoint",
          endpointPrefix: "endpoint",
          response: "endpoint",
          name: "name",
          username: "username",
          secret: "secret",
          auth: "authControl",
          timeoutSetting: "timeout",
          path: "root",
          missing: "root",
        }[message.code];
        if (field) document.getElementById(field)?.focus();
      });
    else connectionDialog?.close();
    return;
  }
  if (message.type.startsWith("download")) {
    downloads.receive(message);
    return;
  }
  if (
    ["listed", "loading", "error", "cancelled"].includes(message.type) &&
    message.request !== undefined &&
    message.request !== request
  )
    return;
  switch (message.type) {
    case "contextAction": {
      if (
        mode !== "browse" ||
        !hasListing ||
        message.connection !== selected ||
        message.revision !== revision
      )
        return;
      const item = items.find(
        (item) =>
          current.replace(/\/$/, "") + "/" + item.pathSuffix === message.path,
      );
      if (!item && message.path !== current) return;
      const path = message.path;
      if (message.action === "copy" || message.action === "copyName")
        send("copy", { path, nameOnly: message.action === "copyName" });
      else if (message.action === "download" && item?.type === "FILE")
        send("download", { connection: selected, path });
      else if (message.action === "previewTab" && item?.type === "FILE")
        send("preview", { connection: selected, path });
      else if (message.action === "preview" && item?.type === "FILE") {
        selectEntry(item, path, false);
        previewFile(item, path, true);
      } else if (message.action === "openFolder" && item?.type === "DIRECTORY")
        navigate(path);
      else if (message.action === "info" && item) information(item, path);
      else if (message.action === "parent") parentFolder();
      else if (message.action === "refresh") navigate(current);
      else if (message.action === "connectionSettings") openSettings();
      break;
    }
    case "focusFiles":
      if (mode === "browse") {
        const row = [...document.querySelectorAll(".file-row")].find(
          (row) => row.dataset.path === selectedPath,
        );
        const narrow = window.matchMedia?.("(max-width: 800px)")?.matches;
        (narrow && previewTarget
          ? previewNode
          : row?.querySelector(".file-name") || document.getElementById("files")
        )?.focus();
      }
      break;
    case "previewResult":
      if (
        mode === "browse" &&
        previewTarget &&
        message.previewRequest === previewRequest &&
        message.content.path === previewTarget.path
      )
        void previewView.show(message.content);
      break;
    case "state": {
      if (state && mode === "settings" && dirty() && !saving) {
        if (
          message.mode &&
          (message.mode !== mode ||
            (message.editConnection && message.editConnection !== editId))
        )
          confirmDiscard(() => {
            state = message;
            mode = message.mode;
            if (message.editConnection) editId = message.editConnection;
            render();
          });
        return;
      }
      const previous = state;
      if (message.mode === "settings" && mode !== "settings") rememberBrowse();
      if (!previous && message.pageSize !== undefined)
        pageSize = normalizePageSize(message.pageSize);
      if (message.mode === "settings" && mode !== "settings" && previewTarget) {
        settingsReturn = {
          ...previewTarget,
          scroll: document.getElementById("files")?.scrollTop || 0,
        };
      }
      if (message.previewReturn)
        settingsReturn = { ...message.previewReturn, tab: true };
      if (message.settingsFocus) settingsFocus = message.settingsFocus;
      if (
        message.mode === "settings" ||
        (previous &&
          JSON.stringify(previous.preferences) !==
            JSON.stringify(message.preferences))
      )
        closePreview(false);
      state = message;
      s = strings(state.preferences.language);
      if (saving) return; // Followed by 'saved'; preserve both forms until the transaction completes.
      if (
        previous &&
        JSON.stringify(previous.connections) !==
          JSON.stringify(state.connections)
      ) {
        settingsReturn = undefined;
        browseReturn = undefined;
        notice();
        resetListing();
        history = [];
        index = -1;
        discardDrafts();
      }
      if (!state.connections.some((c) => c.id === selected))
        selected = state.connections[0]?.id || "";
      if (!state.connections.some((c) => c.id === editId))
        editId = selected || state.connections[0]?.id || "";
      if (message.editConnection) editId = message.editConnection;
      mode = message.mode || mode;
      render();
      break;
    }
    case "saved": {
      if (message.request !== undefined && message.request !== saveRequest)
        return;
      saving = "";
      if (settingsReturn?.connection === message.id)
        settingsReturn.needsListing = true;
      else settingsReturn = undefined;
      discardDrafts();
      if (message.id) editId = selected = message.id;
      resetListing();
      history = [];
      index = -1;
      notice();
      if (saveAction === "open") {
        saveAction = "";
        render();
        checkDialog("success", "", () => {
          if (settingsReturn) backToFiles();
          else {
            mode = "browse";
            navigate(state.connections.find((c) => c.id === selected).root);
          }
        });
      } else render();
      break;
    }
    case "loading":
      if (mode === "settings") return;
      busy = true;
      busyScope = message.scope;
      notice();
      if (message.scope === "navigate") {
        closePreview(false);
        selectedPath = "";
        hasListing = false;
        items = [];
        count = total = 0;
      }
      renderFiles();
      break;
    case "listed":
      if (mode === "settings") return;
      busy = false;
      navigationReturn = undefined;
      hasListing = true;
      selected = message.connection;
      current = message.path;
      revision = message.revision;
      pagePending = true;
      filter = "";
      items = [];
      total = message.total || 0;
      if (pending?.historyIndex !== undefined) index = pending.historyIndex;
      else if (history[index] !== current) {
        history = history.slice(0, index + 1);
        history.push(current);
        index = history.length - 1;
      }
      previewAfterListing = pending?.restorePreview;
      favoriteAfterListing = pending?.favoritePath;
      pending = undefined;
      vscode.setState({ selected, path: current, pageSize });
      status = { text: "", error: false };
      render();
      requestPage();
      break;
    case "page":
      if (
        message.revision !== revision ||
        message.pageRequest !== pageRequest ||
        message.connection !== selected ||
        message.path !== current ||
        message.filter !== filter ||
        !hasListing
      )
        return;
      items = message.items;
      if (
        selectedPath &&
        !items.some(
          (item) =>
            current.replace(/\/$/, "") + "/" + item.pathSuffix === selectedPath,
        )
      ) {
        closePreview(false);
        selectedPath = "";
      }
      pagePending = false;
      total = message.total;
      count = message.count;
      page = message.page;
      const favorite = favoriteAfterListing;
      favoriteAfterListing = undefined;
      if (favorite && message.focusFound) {
        selectedPath = favorite;
        focusAfterListing = false;
      }
      renderFiles();
      if (favorite && message.focusFound) {
        const row = [...document.querySelectorAll(".file-row")].find(
          (node) => node.dataset.path === favorite,
        );
        row?.querySelector(".file-name")?.focus({ preventScroll: true });
        row?.scrollIntoView?.({ block: "nearest" });
      } else if (favorite)
        notice(
          s.notFound ||
            text(
              "This item is no longer in the folder.",
              "此项目已不在该目录中。",
            ),
          true,
        );
      if (previewAfterListing?.connection === selected) {
        const target = previewAfterListing;
        previewAfterListing = undefined;
        selectedPath = target.path;
        previewFile(target.item, target.path, true, target.encoding);
        previewNode.focus();
      }
      if (focusAfterListing && mode === "browse") {
        (
          document.querySelector(".file-name") ||
          document.getElementById("files")
        )?.focus();
        focusAfterListing = false;
      }
      break;
    case "cancelled":
      busy = false;
      pending = undefined;
      if (navigationReturn) {
        ({
          items,
          total,
          count,
          page,
          revision,
          current,
          filter,
          selectedPath,
        } = navigationReturn);
        hasListing = true;
      }
      notice();
      if (mode === "browse") {
        render();
        if (navigationReturn)
          document.getElementById("files").scrollTop = navigationReturn.scroll;
      }
      navigationReturn = undefined;
      break;
    case "disconnected":
      settingsReturn = undefined;
      busy = false;
      resetListing();
      history = [];
      index = -1;
      pending = undefined;
      notice();
      render();
      break;
    case "error":
      busy = false;
      if (message.scope === "save") {
        saving = "";
        saveAction = "";
        setSaving();
      }
      notice(message.text, true, message.code);
      if (mode === "browse") render();
      break;
  }
});
window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  const menu = document.querySelector(".connection-menu[open]");
  if (event.key === "Escape" && menu) {
    menu.open = false;
    menu.querySelector("summary").focus();
    event.preventDefault();
    return;
  }
  if (
    mode !== "browse" ||
    document.querySelector("dialog[open]") ||
    event.target.closest(
      "input, select, textarea, [role=combobox], [contenteditable=true]",
    )
  )
    return;
  if (event.key === "Escape" && previewTarget) {
    event.preventDefault();
    closePreview();
  } else if (event.target.closest(".cm-editor")) {
    return;
  } else if (
    (event.shiftKey && event.key === "F10") ||
    event.key === "ContextMenu"
  ) {
    const target =
      event.target.closest(".file-row") || document.getElementById("files");
    if (!target?.dataset.vscodeContext) return;
    event.preventDefault();
    const bounds = target.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: bounds.left + 24,
        clientY: bounds.top + 16,
      }),
    );
  } else if (
    event.key === "Backspace" ||
    (event.altKey && event.key === "ArrowUp")
  ) {
    event.preventDefault();
    parentFolder();
  } else if (event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();
    travel(-1);
  } else if (event.altKey && event.key === "ArrowRight") {
    event.preventDefault();
    travel(1);
  }
});
document.addEventListener("pointerdown", (event) => {
  const menu = document.querySelector(".connection-menu[open]");
  if (menu && !menu.contains(event.target)) menu.open = false;
});
window.addEventListener("pagehide", () => previewView?.destroy());
send("ready");
