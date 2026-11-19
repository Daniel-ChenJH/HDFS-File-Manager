import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

export class Welcome implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private subscription?: vscode.Disposable;
  private disposal?: vscode.Disposable;
  constructor(private language: () => string) {}
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    this.disposal?.dispose();
    this.disposal = view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
        this.subscription?.dispose();
        this.subscription = undefined;
      }
    });
    view.webview.options = { enableScripts: true };
    this.subscription?.dispose();
    this.subscription = view.webview.onDidReceiveMessage((message) => {
      if (message?.type === "settings")
        void vscode.commands.executeCommand("hdfsLite.settings");
    });
    this.update();
  }
  update() {
    if (!this.view) return;
    const zh = this.language() === "zh-CN",
      nonce = randomBytes(18).toString("base64");
    this.view.webview.html = `<!doctype html><html lang="${zh ? "zh-CN" : "en"}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">
html,body{height:100%;margin:0}body{box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:24px 18px;color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);text-align:center}main{max-width:280px}svg{width:80px;height:80px;color:var(--vscode-descriptionForeground)}h2{font-size:16px;font-weight:600;margin:20px 0 10px}p{color:var(--vscode-descriptionForeground);line-height:1.6;margin:0 0 24px}button{display:block;width:100%;border:1px solid var(--vscode-contrastBorder,transparent);border-radius:999px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font:inherit;padding:10px 18px;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:3px}</style></head><body><main><svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M10 24a6 6 0 0 1 6-6h18l8 8h22a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6Z" stroke="currentColor" stroke-width="2.5"/><path d="M40 36v18m-9-9h18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg><h2>${zh ? "开始浏览 HDFS" : "Explore your HDFS files"}</h2><p>${zh ? "添加一个连接，即可浏览、预览和下载文件。" : "Add a connection to browse, preview and download files."}</p><button>${zh ? "添加连接" : "Add connection"}</button></main><script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelector('button').addEventListener('click',()=>vscode.postMessage({type:'settings'}));</script></body></html>`;
  }
  dispose() {
    this.subscription?.dispose();
    this.disposal?.dispose();
  }
}
