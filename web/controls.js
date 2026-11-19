import { element as el } from "./strings.js";
import { icon } from "./icons.js";

let popup;
let pendingTooltip;
const selects = new Map();
export function closePopup() {
  pendingTooltip?.();
  pendingTooltip = undefined;
  popup?.close();
}

function mountPopup(panel, trigger) {
  const dialog = trigger.closest("dialog");
  (dialog || document.body).append(panel);
  if (dialog && typeof panel.showPopover === "function") {
    panel.setAttribute("popover", "manual");
    panel.showPopover();
  }
}

// Webview hosts do not consistently display HTML title tooltips.
export function filenameTooltip(trigger, text) {
  let panel, timer;
  const close = () => {
    clearTimeout(timer);
    if (pendingTooltip === close) pendingTooltip = undefined;
    panel?.remove();
    panel = undefined;
    trigger.removeAttribute("aria-describedby");
    if (popup?.anchor === trigger) popup = undefined;
  };
  const show = () => {
    if (
      !trigger.isConnected ||
      panel ||
      popup?.panel.getAttribute("role") === "listbox"
    )
      return;
    closePopup();
    panel = el(
      "div",
      {
        id: "filenameTooltip",
        role: "tooltip",
        class: "control-tooltip filename-tooltip",
      },
      text,
    );
    mountPopup(panel, trigger);
    trigger.setAttribute("aria-describedby", panel.id);
    popup = { anchor: trigger, panel, close };
    place(panel, trigger);
  };
  trigger.addEventListener("mouseenter", () => {
    if (popup?.panel.getAttribute("role") === "listbox") return;
    pendingTooltip?.();
    pendingTooltip = close;
    timer = setTimeout(() => {
      if (pendingTooltip === close) pendingTooltip = undefined;
      show();
    }, 350);
  });
  trigger.addEventListener("mouseleave", close);
  trigger.addEventListener("focusin", show);
  trigger.addEventListener("focusout", close);
  return trigger;
}
function place(panel, anchor) {
  const rect = anchor.getBoundingClientRect();
  const labelTop =
    anchor.closest(".field")?.getBoundingClientRect().top ?? rect.top;
  const below = window.innerHeight - rect.bottom - 14;
  const above = labelTop - 14;
  const up = below < Math.min(panel.scrollHeight, 180) && above > below;
  panel.style.maxHeight = `${Math.max(32, up ? above : below)}px`;
  panel.style.minWidth = `${Math.min(rect.width, window.innerWidth - 24)}px`;
  const width = Math.min(
    Math.max(rect.width, panel.getBoundingClientRect().width),
    window.innerWidth - 24,
  );
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  panel.style.top = `${up ? Math.max(8, labelTop - panel.getBoundingClientRect().height - 6) : rect.bottom + 6}px`;
}
document.addEventListener("pointerdown", (event) => {
  if (
    popup &&
    !popup.anchor.contains(event.target) &&
    !popup.panel.contains(event.target)
  )
    closePopup();
});
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && popup) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const anchor = popup.anchor;
      const restoreFocus = popup.panel.getAttribute("role") === "listbox";
      closePopup();
      if (restoreFocus) anchor.focus();
    }
  },
  true,
);
window.addEventListener("resize", closePopup);
document.addEventListener(
  "scroll",
  (event) => {
    if (popup && !popup.panel.contains(event.target)) closePopup();
  },
  true,
);

export function syncSelects() {
  for (const [select, sync] of selects) {
    if (!select.isConnected) selects.delete(select);
    else sync();
  }
}
export function enhanceSelects(root) {
  syncSelects();
  for (const select of root.querySelectorAll("select:not([data-enhanced])")) {
    select.dataset.enhanced = "true";
    select.hidden = true;
    const label = document.querySelector(`label[for="${select.id}"]`);
    const name = select.getAttribute("aria-label") || label?.textContent || "";
    const value = el("span", { class: "select-value" });
    const trigger = el(
      "button",
      {
        type: "button",
        id: select.id + "Control",
        class: "select-control",
        role: "combobox",
        "aria-label": name,
        "aria-describedby": select.getAttribute("aria-describedby"),
        "aria-invalid": select.getAttribute("aria-invalid"),
        "aria-expanded": "false",
        "aria-haspopup": "listbox",
        "aria-controls": select.id + "Options",
      },
      value,
      icon("down"),
    );
    if (label) label.htmlFor = trigger.id;
    const wrapper = el("div", { class: "select-field" });
    select.before(wrapper);
    wrapper.append(select, trigger);
    let active = 0,
      panel,
      typed = "",
      typedAt = 0;
    const sync = () => {
      value.textContent = select.selectedOptions[0]?.textContent || "";
      trigger.title = value.textContent;
      trigger.disabled =
        select.disabled || !!select.closest("fieldset:disabled");
    };
    const close = () => {
      panel?.remove();
      panel = undefined;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      if (popup?.anchor === trigger) popup = undefined;
    };
    const highlight = () => {
      [...panel.children].forEach((node, i) =>
        node.classList.toggle("is-active", i === active),
      );
      const option = panel.children[active];
      trigger.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView?.({ block: "nearest" });
    };
    const commit = (index) => {
      const next = select.options[index].value;
      close();
      trigger.focus();
      if (next === select.value) return;
      select.value = next;
      sync();
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
    };
    const open = () => {
      if (panel || trigger.disabled) return;
      closePopup();
      active = Math.max(0, select.selectedIndex);
      panel = el("div", {
        id: select.id + "Options",
        class: "select-options",
        role: "listbox",
        "aria-label": name,
      });
      [...select.options].forEach((option, index) => {
        panel.append(
          el(
            "div",
            {
              id: `${select.id}Option${index}`,
              role: "option",
              "aria-selected": String(option.selected),
              title: option.textContent,
              onpointermove: () => {
                active = index;
                highlight();
              },
              onmousedown: (event) => event.preventDefault(),
              onclick: () => commit(index),
            },
            el("span", {}, option.textContent),
            icon("check"),
          ),
        );
      });
      mountPopup(panel, trigger);
      popup = { anchor: trigger, panel, close };
      trigger.setAttribute("aria-expanded", "true");
      place(panel, trigger);
      highlight();
    };
    trigger.addEventListener("click", () => (panel ? close() : open()));
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        close();
        return;
      }
      if (
        ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(
          event.key,
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!panel) {
          open();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          commit(active);
          return;
        }
        active =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? select.options.length - 1
              : Math.max(
                  0,
                  Math.min(
                    select.options.length - 1,
                    active + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
        highlight();
      } else if (
        event.key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        open();
        typed = Date.now() - typedAt < 800 ? typed + event.key : event.key;
        typedAt = Date.now();
        const index = [...select.options].findIndex((option) =>
          option.textContent
            .toLocaleLowerCase()
            .startsWith(typed.toLocaleLowerCase()),
        );
        if (index >= 0) {
          active = index;
          highlight();
        }
      }
    });
    trigger.addEventListener("blur", close);
    select.addEventListener("input", sync);
    select.addEventListener("change", sync);
    selects.set(select, sync);
    sync();
  }
}

export function numberControl(input, label, s) {
  const change = (direction) => {
    if (input.disabled || input.closest("fieldset:disabled")) return;
    direction > 0 ? input.stepUp() : input.stepDown();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
    sync();
  };
  const decrement = el(
    "button",
    {
      type: "button",
      class: "number-step",
      "aria-label": s.decrease + " " + label,
      onclick: () => change(-1),
    },
    icon("minus"),
  );
  const increment = el(
    "button",
    {
      type: "button",
      class: "number-step",
      "aria-label": s.increase + " " + label,
      onclick: () => change(1),
    },
    icon("plus"),
  );
  const sync = () => {
    decrement.disabled =
      input.value !== "" && Number(input.value) <= Number(input.min);
    increment.disabled =
      input.value !== "" && Number(input.value) >= Number(input.max);
  };
  input.addEventListener("input", sync);
  sync();
  return el("div", { class: "number-control" }, input, decrement, increment);
}

export function infoTip(label, text, s, detailLabel = s.limitInfo) {
  let panel,
    pinned = false,
    timer;
  const trigger = el(
    "button",
    {
      type: "button",
      class: "info-tip",
      "aria-label": label + ": " + detailLabel,
    },
    icon("info"),
  );
  const close = () => {
    clearTimeout(timer);
    panel?.remove();
    panel = undefined;
    pinned = false;
    trigger.removeAttribute("aria-describedby");
    if (popup?.anchor === trigger) popup = undefined;
  };
  const show = () => {
    clearTimeout(timer);
    if (panel) return;
    closePopup();
    panel = el(
      "div",
      { id: "controlHelp", class: "control-tooltip", role: "tooltip" },
      typeof text === "function" ? text() : text,
    );
    panel.addEventListener("mouseenter", () => clearTimeout(timer));
    panel.addEventListener("mouseleave", () => {
      if (!pinned) close();
    });
    mountPopup(panel, trigger);
    trigger.setAttribute("aria-describedby", panel.id);
    popup = { anchor: trigger, panel, close };
    place(panel, trigger);
  };
  trigger.addEventListener("mouseenter", show);
  trigger.addEventListener("mouseleave", () => {
    if (!pinned) timer = setTimeout(close, 150);
  });
  trigger.addEventListener("focus", show);
  trigger.addEventListener("blur", close);
  trigger.addEventListener("click", () => {
    if (pinned) close();
    else {
      show();
      pinned = true;
    }
  });
  return trigger;
}
