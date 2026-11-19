import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("the welcome view survives being disposed after connection creation and can reopen after removing the last connection", async () => {
  const source = (
    await build({
      entryPoints: ["src/welcome.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["vscode"],
      write: false,
    })
  ).outputFiles[0].text;
  const commands: string[] = [],
    module = { exports: {} as any },
    require = createRequire(__filename);
  new Function("require", "module", "exports", source)(
    (name: string) =>
      name === "vscode"
        ? {
            commands: {
              executeCommand: (command: string) => commands.push(command),
            },
          }
        : require(name),
    module,
    module.exports,
  );
  let language = "en";
  const provider = new module.exports.Welcome(() => language);
  const view = () => {
    let disposed = false,
      html = "",
      close!: Function,
      receive!: Function;
    return {
      webview: {
        options: {},
        get html() {
          return html;
        },
        set html(value: string) {
          if (disposed) throw new Error("Disposed webview");
          html = value;
        },
        onDidReceiveMessage(fn: Function) {
          receive = fn;
          return { dispose() {} };
        },
      },
      onDidDispose(fn: Function) {
        close = fn;
        return { dispose() {} };
      },
      close() {
        disposed = true;
        close();
      },
      message(value: any) {
        receive(value);
      },
    };
  };
  const first = view();
  provider.resolveWebviewView(first);
  assert.match(first.webview.html, /<svg/);
  first.message({ type: "settings" });
  assert.deepEqual(commands, ["hdfsLite.settings"]);
  first.close();
  assert.doesNotThrow(() => provider.update());
  language = "zh-CN";
  const second = view();
  provider.resolveWebviewView(second);
  assert.match(second.webview.html, /添加连接/);
  provider.dispose();
});
