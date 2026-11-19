import { icon } from "./icons.js";
import { element as el, size } from "./strings.js";
export function manager(send, get) {
  let recoveryCount = 0;
  let jobs = [],
    dialog,
    panel,
    transferForm,
    request = 0;
  let copied;
  let copiedTimer;
  const text = (en, zh) => (get().preferences?.language === "zh-CN" ? zh : en);
  const b = (label, fn, cls = "") =>
    el(
      "button",
      {
        type: "button",
        class: cls,
        onclick: fn,
        "data-action": typeof label === "string" ? label : "",
      },
      label,
    );
  function close() {
    const own = dialog;
    if (transferForm?.direction === "upload")
      send("task", { action: "releaseSelection" });
    dialog = undefined;
    transferForm = undefined;
    own?.close();
    own?.remove();
  }
  function modal(title) {
    close();
    dialog = el("dialog", { "aria-label": title }, el("h2", {}, title));
    const own = dialog;
    dialog.addEventListener("close", () => {
      own.remove();
      if (dialog === own) {
        if (transferForm?.direction === "upload")
          send("task", { action: "releaseSelection" });
        dialog = undefined;
        transferForm = undefined;
      }
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          close();
      }
    });
    document.body.append(dialog);
    dialog.showModal();
    return dialog;
  }
  function transfer(direction, paths) {
    const state = get();
    if (direction === "download" && !state.remote) {
      send("task", {
        action: "start",
        direction,
        target: "local",
        paths,
        connection: state.selected,
      });
      return;
    }
    const d = modal(
      text(
        direction === "upload" ? "Upload" : "Download",
        direction === "upload" ? "上传" : "下载",
      ),
    );
    d.classList.add("transfer-dialog");
    let target =
      direction === "upload"
        ? state.uploadTargets?.[state.selected] || "local"
        : state.preferences.downloadTarget || "host";
    if (!state.remote) target = "local";
    else if (state.localTransfer === false) target = "host";
    const tabs = el("div", {
        class: "actions target-pills",
        role: "radiogroup",
        "aria-label": text("Computer", "计算机"),
      }),
      summary = el(
        "div",
        {
          class: "transfer-summary",
          "aria-live": "polite",
          hidden: direction === "upload",
        },
        direction === "download"
          ? [
              el("strong", {}, itemCount(paths.length)),
              el(
                "ul",
                { class: "batch-items" },
                paths
                  .slice(0, 3)
                  .map((path) =>
                    el("li", { title: path }, path.split("/").pop() || "/"),
                  ),
              ),
              paths.length > 3
                ? el(
                    "span",
                    { class: "muted" },
                    text(
                      `+${paths.length - 3} more`,
                      `另有 ${paths.length - 3} 项`,
                    ),
                  )
                : null,
            ]
          : null,
      );
    const error = el("p", {
      class: "transfer-error error",
      role: "alert",
      hidden: true,
    });
    const sourceActions = el("div", { class: "actions" }),
      start = b(
        text(
          direction === "upload" ? "Upload" : "Choose destination",
          direction === "upload" ? "上传" : "选择保存位置",
        ),
        () => {
          error.hidden = true;
          transferForm.request = ++request;
          setPending(true);
          send("task", {
            action: "start",
            direction,
            target,
            paths,
            connection: state.selected,
            path: state.current,
            request,
          });
        },
        "primary",
      );
    start.disabled = direction === "upload";
    const choose = (kind) => {
      error.hidden = true;
      transferForm.request = ++request;
      setPending(true);
      send("task", {
        action: "chooseUpload",
        target,
        kind,
        connection: state.selected,
        request,
      });
    };
    const setPending = (pending) => {
      start.disabled = pending || !transferForm.ready;
      for (const control of [
        ...tabs.querySelectorAll("button"),
        ...sourceActions.querySelectorAll("button"),
      ])
        control.disabled = pending;
    };
    const refresh = () => {
      tabs.replaceChildren();
      const targets = state.remote
        ? state.localTransfer === false
          ? ["host"]
          : ["local", "host"]
        : ["local"];
      for (const t of targets)
        tabs.append(
          b(
            t === "local" ? text("This computer", "本机") : state.hostName,
            () => {
              if (t === target) return;
              target = t;
              if (direction === "upload") {
                transferForm.ready = false;
                transferForm.request = ++request;
                send("task", { action: "releaseSelection" });
                summary.hidden = true;
                summary.replaceChildren();
                error.hidden = true;
                setPending(false);
              }
              refresh();
            },
            t === target ? "primary" : "",
          ),
        );
      for (const button of tabs.querySelectorAll("button")) {
        button.setAttribute("role", "radio");
        button.setAttribute(
          "aria-checked",
          String(button.classList.contains("primary")),
        );
      }
    };
    tabs.addEventListener("keydown", (event) => {
      const buttons = [...tabs.querySelectorAll("button")],
        i = buttons.indexOf(document.activeElement);
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const n =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (i + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[n].click();
      tabs.querySelectorAll("button")[n]?.focus();
    });
    refresh();
    if (direction === "upload")
      sourceActions.append(
        b(text("Choose files", "选择文件"), () => choose("files")),
        b(text("Choose folder", "选择文件夹"), () => choose("folder")),
      );
    d.append(
      el(
        "div",
        { class: "transfer-fields" },
        direction === "upload"
          ? el(
              "div",
              { class: "transfer-destination" },
              el(
                "span",
                { class: "transfer-label" },
                text("Destination", "上传到"),
              ),
              el(
                "span",
                { class: "transfer-location", title: state.current },
                icon("folder"),
                state.current,
              ),
            )
          : summary,
        state.remote
          ? el(
              "div",
              { class: "transfer-host" },
              el(
                "span",
                { class: "transfer-label" },
                direction === "upload"
                  ? text("Source", "来源")
                  : text("Save to", "保存到"),
              ),
              tabs,
            )
          : null,
        direction === "upload"
          ? el("div", { class: "transfer-source" }, sourceActions, summary)
          : null,
        error,
      ),
      el(
        "div",
        { class: "actions transfer-footer" },
        b(text("Cancel", "取消"), close, "quiet"),
        start,
      ),
    );
    transferForm = {
      direction,
      target: () => target,
      summary,
      start,
      error,
      setPending,
      ready: direction !== "upload",
    };
    (direction === "upload"
      ? sourceActions.querySelector("button")
      : tabs.querySelector('[aria-checked="true"]')
    )?.focus({ preventScroll: true });
  }
  const itemCount = (count) =>
    text(count === 1 ? "1 item" : `${count} items`, `${count} 项`);
  const fileCount = (count) =>
    text(count === 1 ? "1 file" : `${count} files`, `${count} 个文件`);
  function hideTasks(restoreFocus = false) {
    panel?.remove();
    panel = undefined;
    updateBadge();
    if (restoreFocus) document.getElementById("openTransfers")?.focus();
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (
        panel?.isConnected &&
        !panel.contains(event.target) &&
        !event.target.closest("#openTransfers, dialog[open]")
      )
        hideTasks();
    },
    true,
  );
  function showTasks() {
    if (panel?.isConnected) {
      hideTasks();
      return;
    }
    panel = el("section", {
      class: "transfer-panel",
      "aria-label": text("Transfers", "传输"),
    });
    document.getElementById("app").append(panel);
    paint();
    updateBadge();
    send("tasks");
  }
  function paint() {
    if (!panel?.isConnected) return;
    const signature = JSON.stringify([
      text("en", "zh"),
      recoveryCount,
      jobs.map((j) => [
        j.id,
        j.status,
        j.done,
        j.failed,
        j.failedFiles,
        j.skipped,
        j.error,
        j.folder,
      ]),
    ]);
    const progressText = (j) => {
      // Older jobs stored a combined count of directories and files.
      const countedFiles = j.failedFiles !== undefined;
      return [
        labelsFor(j.status),
        countedFiles && j.done
          ? text(`${fileCount(j.done)} completed`, `${fileCount(j.done)}完成`)
          : "",
        j.bytes ? size(j.bytes) : "",
        j.failedFiles
          ? text(
              `${fileCount(j.failedFiles)} failed`,
              `${fileCount(j.failedFiles)}失败`,
            )
          : "",
        countedFiles && j.skipped
          ? text(
              `${fileCount(j.skipped)} skipped`,
              `${fileCount(j.skipped)}跳过`,
            )
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
    };
    function labelsFor(status) {
      return {
        queued: text("Queued", "等待中"),
        running: text("Transferring", "传输中"),
        enumerating: text("Preparing files", "正在整理文件"),
        completed: text("Completed", "已完成"),
        partial: text("Partially completed", "部分失败"),
        failed: text("Failed", "失败"),
        cancelled: text("Cancelled", "已取消"),
        interrupted: text("Interrupted", "已中断"),
      }[status];
    }
    if (panel.dataset.signature === signature) {
      for (const row of panel.querySelectorAll("[data-job]")) {
        const j = jobs.find((j) => j.id === row.dataset.job);
        if (!j) continue;
        row.querySelector(".transfer-progress").textContent = progressText(j);
        const current = row.querySelector(".transfer-current");
        current.textContent = j.current || "";
        current.hidden = !j.current;
      }
      syncCopied();
      return;
    }
    const focus = panel.contains(document.activeElement)
      ? {
          job: document.activeElement.closest("[data-job]")?.dataset.job,
          action: document.activeElement.dataset.action,
        }
      : undefined;
    const scroll = panel.querySelector(".transfer-list")?.scrollTop || 0;
    const list = el("div", {
      class: "transfer-list",
      tabindex: "0",
      "aria-label": text("Transfer history", "传输记录"),
    });
    panel.dataset.signature = signature;
    panel.replaceChildren(
      el(
        "div",
        { class: "transfer-heading" },
        el("strong", {}, text("Transfers", "传输")),
        recoveryCount
          ? b(text("Check interrupted uploads", "检查中断的上传"), () =>
              send("task", { action: "recover" }),
            )
          : null,
        b(
          text("Clear finished", "清空已结束"),
          () => send("task", { action: "clear" }),
          "quiet",
        ),
        el(
          "button",
          {
            type: "button",
            class: "icon-button",
            "aria-label": text("Close", "关闭"),
            title: text("Close", "关闭"),
            "data-action": "close",
            onclick: () => hideTasks(true),
          },
          icon("close"),
        ),
      ),
      list,
    );
    if (!jobs.length)
      list.append(
        el(
          "p",
          { class: "muted" },
          text("No transfers yet.", "暂无传输记录。"),
        ),
      );
    for (const j of [...jobs].reverse()) {
      const active = ["queued", "running", "enumerating"].includes(j.status);
      const connected = get().connections?.some((c) => c.id === j.connection);
      const name = j.rootCount > 1 ? itemCount(j.rootCount) : j.name;
      const row = el(
        "div",
        { class: "transfer-row", "data-job": j.id, tabindex: "-1" },
        el(
          "div",
          { class: "transfer-title" },
          icon(j.direction === "upload" ? "upload" : "download"),
          el("strong", { title: name }, name),
          el(
            "span",
            { class: "muted" },
            j.direction === "upload"
              ? text("Upload", "上传")
              : text("Download", "下载"),
          ),
        ),
        el(
          "div",
          { class: "muted transfer-path", title: j.folder },
          el(
            "span",
            { class: "transfer-path-host" },
            j.direction === "upload"
              ? "HDFS"
              : j.target === "local" || !get().remote
                ? text("This computer", "本机")
                : get().hostName,
          ),
          el("span", { class: "transfer-path-value" }, j.folder),
        ),
        el("div", { class: "transfer-progress" }, progressText(j)),
      );
      row.append(
        el(
          "div",
          { class: "muted transfer-current", hidden: !j.current },
          j.current || "",
        ),
      );
      if (j.error)
        row.append(el("div", { class: "error", role: "alert" }, j.error));
      const actions = el("div", { class: "actions" });
      if (active)
        actions.append(
          b(text("Cancel", "取消"), () =>
            send("task", { action: "cancel", id: j.id }),
          ),
        );
      else {
        if (j.folder) {
          const copy = b(
            text("Copy path", "复制路径"),
            () => send("task", { action: "copyLocation", id: j.id }),
            "transfer-copy",
          );
          copy.dataset.action = "copyLocation";
          actions.append(copy);
        }
        if (j.direction === "download" || connected)
          actions.append(
            b(text("Open location", "打开位置"), () =>
              send("task", { action: "reveal", id: j.id }),
            ),
          );
        if (
          connected &&
          (j.failed ||
            ["failed", "cancelled", "interrupted"].includes(j.status))
        )
          actions.append(
            b(
              text(
                j.failed ? "Retry failed" : "Retry",
                j.failed ? "重试失败项" : "重试",
              ),
              () => send("task", { action: "retry", id: j.id }),
            ),
          );
      }
      if (j.failed)
        actions.append(
          b(text("Details", "查看详情"), () =>
            send("task", { action: "details", id: j.id, page: 0 }),
          ),
        );
      row.append(actions);
      list.append(row);
    }
    list.scrollTop = scroll;
    syncCopied();
    if (focus) {
      const region = focus.job
        ? [...panel.querySelectorAll("[data-job]")].find(
            (row) => row.dataset.job === focus.job,
          )
        : focus.action
          ? panel.querySelector(".transfer-heading")
          : list;
      const button = [...(region?.querySelectorAll("button") || [])].find(
        (button) => button.dataset.action === focus.action,
      );
      (button || region || list)?.focus({ preventScroll: true });
    }
  }
  function syncCopied() {
    for (const control of panel?.querySelectorAll(".transfer-copy") || []) {
      const label =
        control.closest("[data-job]").dataset.job === copied
          ? text("Copied", "已复制")
          : text("Copy path", "复制路径");
      if (control.textContent !== label) control.textContent = label;
    }
  }
  return {
    transfer,
    showTasks,
    restorePanel() {
      if (panel && !panel.isConnected)
        document.getElementById("app").append(panel);
      paint();
      updateBadge();
    },
    receive(m) {
      if (m.type === "taskLocationCopied") {
        copied = m.id;
        syncCopied();
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          copied = undefined;
          syncCopied();
        }, 1600);
        return true;
      }
      if (
        m.type === "transferChoiceCancelled" ||
        m.type === "uploadChoiceCancelled"
      ) {
        if (transferForm && transferForm.request === m.request)
          transferForm.setPending(false);
        return true;
      }
      if (m.type === "taskDetails") {
        const d = modal(text("Failed items", "失败项目"));
        d.classList.add("task-detail-dialog");
        const list = el("div", {
          class: "task-detail-list",
          tabindex: "0",
          "aria-label": text("Failed items", "失败项目"),
        });
        for (const item of m.items)
          list.append(
            el(
              "div",
              { class: "transfer-row" },
              el("strong", {}, item.name),
              el("p", { class: "error" }, item.error),
            ),
          );
        d.append(
          list,
          el(
            "div",
            { class: "actions" },
            m.page
              ? b(text("Previous", "上一页"), () =>
                  send("task", {
                    action: "details",
                    id: m.id,
                    page: m.page - 1,
                  }),
                )
              : null,
            (m.page + 1) * 50 < m.total
              ? b(text("Next", "下一页"), () =>
                  send("task", {
                    action: "details",
                    id: m.id,
                    page: m.page + 1,
                  }),
                )
              : null,
            b(text("Close", "关闭"), close),
          ),
        );
        return true;
      }
      if (m.type === "tasks") {
        jobs = m.jobs;
        recoveryCount = m.recoveryCount || 0;
        paint();
        updateBadge();
        return true;
      }
      if (
        m.type === "uploadSelected" &&
        transferForm?.direction === "upload" &&
        m.request === transferForm.request &&
        m.target === transferForm.target()
      ) {
        const { summary } = transferForm;
        summary.replaceChildren(
          ...m.roots
            .slice(0, 5)
            .map((root) =>
              el(
                "div",
                { class: "transfer-source-row" },
                icon(root.type === "FILE" ? "file" : "folder"),
                el(
                  "span",
                  { class: "transfer-source-name", title: root.name },
                  root.name,
                ),
                root.type === "FILE"
                  ? el("span", { class: "muted" }, size(root.size))
                  : null,
              ),
            ),
        );
        if (m.roots.length > 5)
          summary.append(
            el(
              "span",
              { class: "muted" },
              text(
                `+${m.roots.length - 5} more`,
                `另有 ${m.roots.length - 5} 项`,
              ),
            ),
          );
        summary.hidden = false;
        transferForm.ready = true;
        transferForm.setPending(false);
        return true;
      }
      if (m.type === "transferStarted") {
        if (transferForm && transferForm.request === m.request) close();
        if (!panel?.isConnected) showTasks();
        return true;
      }
      if (m.type === "taskError") {
        if (
          transferForm &&
          dialog?.open &&
          transferForm.request === m.request
        ) {
          transferForm.setPending(false);
          const { error } = transferForm;
          error.hidden = false;
          error.textContent = m.text;
          return true;
        }
        if (m.request !== undefined) return true;
        const d = modal(text("Unable to continue", "无法继续"));
        d.append(
          el("p", { class: "error", role: "alert" }, m.text),
          el(
            "div",
            { class: "actions" },
            b(text("Confirm", "确认"), close, "primary"),
          ),
        );
        return true;
      }
      return false;
    },
  };
  function updateBadge() {
    document
      .getElementById("openTransfers")
      ?.setAttribute("aria-expanded", String(!!panel?.isConnected));
    const badge = document.getElementById("transferCount");
    if (badge)
      badge.textContent = String(
        jobs.filter((job) =>
          ["running", "queued", "enumerating"].includes(job.status),
        ).length || "",
      );
  }
}
