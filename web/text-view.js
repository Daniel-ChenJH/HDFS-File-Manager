import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  runScopeHandlers,
} from "@codemirror/view";
import {
  search,
  searchKeymap,
  openSearchPanel,
  closeSearchPanel,
  searchPanelOpen,
  getSearchQuery,
  setSearchQuery,
  SearchQuery,
  findNext,
  findPrevious,
} from "@codemirror/search";
import { element as el } from "./strings.js";
import { icon } from "./icons.js";

function searchPanel(view, language) {
  const t = (en, zh) => (language === "zh-CN" ? zh : en);
  const label = t("Find in preview", "在预览中查找");
  const field = el("input", {
    type: "text",
    "main-field": "true",
    "aria-label": label,
    placeholder: t("Find in file", "查找文件内容"),
    autocomplete: "off",
    spellcheck: "false",
    maxlength: 512,
  });
  const status = el("span", { class: "preview-find-status", role: "status" });
  const run = (command) => {
    if (!getSearchQuery(view.state).valid) return;
    if (!command(view)) status.textContent = t("No matches", "无匹配");
  };
  const action = (name, title, fn) =>
    el(
      "button",
      {
        type: "button",
        class: "icon-button",
        title,
        "aria-label": title,
        onclick: fn,
      },
      icon(name),
    );
  const previous = action("up", t("Previous match", "上一处匹配"), () =>
    run(findPrevious),
  );
  const next = action("down", t("Next match", "下一处匹配"), () =>
    run(findNext),
  );
  const matchCase = el(
    "button",
    {
      type: "button",
      class: "icon-button preview-find-case",
      title: t("Match case", "区分大小写"),
      "aria-label": t("Match case", "区分大小写"),
      onclick: () => {
        view.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({
              search: field.value,
              literal: true,
              caseSensitive: !getSearchQuery(view.state).caseSensitive,
            }),
          ),
        });
      },
    },
    "Aa",
  );
  const sync = (inspect) => {
    const query = getSearchQuery(view.state);
    if (field.value !== query.search) field.value = query.search;
    matchCase.setAttribute("aria-pressed", String(query.caseSensitive));
    if (inspect) {
      const found = query.valid && !query.getCursor(view.state).next().done;
      previous.disabled = next.disabled = !found;
      status.textContent =
        query.valid && !found ? t("No matches", "无匹配") : "";
    }
  };
  field.addEventListener("input", () => {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: field.value,
          literal: true,
          caseSensitive: getSearchQuery(view.state).caseSensitive,
        }),
      ),
    });
  });
  const dom = el(
    "div",
    {
      class: "cm-search preview-find",
      role: "search",
      "aria-label": label,
      onkeydown: (event) => {
        if (event.key === "Enter" && event.target === field) {
          event.preventDefault();
          run(event.shiftKey ? findPrevious : findNext);
        } else if (runScopeHandlers(view, event, "search-panel"))
          event.preventDefault();
      },
    },
    el("div", { class: "preview-find-input" }, icon("search"), field, status),
    el(
      "div",
      { class: "preview-find-actions" },
      matchCase,
      previous,
      next,
      action("close", t("Close find", "关闭查找"), () =>
        closeSearchPanel(view),
      ),
    ),
  );
  sync(true);
  return {
    dom,
    top: true,
    mount() {
      field.focus();
      field.select();
    },
    update(update) {
      sync(
        update.docChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setSearchQuery)),
          ),
      );
    },
  };
}

export function createTextView(
  parent,
  text,
  label,
  language = "en",
  onFind = () => {},
) {
  const wrapping = new Compartment();
  const numbers = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        EditorState.readOnly.of(true),
        EditorState.phrases.of(
          language === "zh-CN"
            ? {
                Find: "查找",
                next: "下一个",
                previous: "上一个",
                all: "全选匹配项",
                "match case": "区分大小写",
                regexp: "正则表达式",
                "by word": "全字匹配",
                close: "关闭",
                "Go to line": "跳转到行",
                go: "跳转",
                "Selection deleted": "所选内容已删除",
                "No matches found": "未找到匹配项",
              }
            : {},
        ),
        EditorState.lineSeparator.of("\n"),
        EditorState.tabSize.of(4),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({
          tabindex: "0",
          "aria-label": label,
          "aria-readonly": "true",
        }),
        EditorView.cspNonce.of(
          document.querySelector('meta[name="csp-nonce"]')?.content || "",
        ),
        wrapping.of(EditorView.lineWrapping),
        numbers.of([]),
        search({
          top: true,
          literal: true,
          createPanel: (view) => searchPanel(view, language),
        }),
        EditorView.updateListener.of((update) => {
          if (
            searchPanelOpen(update.startState) !== searchPanelOpen(update.state)
          )
            onFind(searchPanelOpen(update.state));
        }),
        keymap.of(searchKeymap),
        keymap.of([
          {
            key: "Mod-a",
            run(editor) {
              editor.dispatch({
                selection: { anchor: 0, head: editor.state.doc.length },
              });
              return true;
            },
          },
        ]),
      ],
    }),
  });
  return {
    view,
    find() {
      if (searchPanelOpen(view.state)) closeSearchPanel(view);
      else openSearchPanel(view);
    },
    replaceText(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      });
    },
    setLineNumbers(enabled) {
      view.dispatch({
        effects: numbers.reconfigure(enabled ? lineNumbers() : []),
      });
    },
    setWrap(enabled) {
      view.dispatch({
        effects: wrapping.reconfigure(enabled ? EditorView.lineWrapping : []),
      });
    },
    destroy() {
      view.destroy();
    },
  };
}
