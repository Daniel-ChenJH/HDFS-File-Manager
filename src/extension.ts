import * as vscode from "vscode";
import { hostname } from "node:os";
import { posix } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "./client";
import {
  Connection,
  changePreference,
  defaults,
  Entry,
  Gate,
  HdfsError,
  joinPath,
  Language,
  Latest,
  normalizePath,
  PreferenceSettings,
  Preferences,
  resolveLanguage,
  validateConnection,
} from "./model";
import { errorText, tr } from "./i18n";
import { selectPage, normalizePageSize } from "./listing";
import { readPreview } from "./preview";
import { normalizeEncoding } from "./text-encoding";
import { fileKind, themeIcons } from "./file-types";
import { Tasks } from "./tasks";
import { Downloads } from "./downloads";
import { remoteLabelCommand } from "./remote-label";
import { Welcome } from "./welcome";

type Node = {
  connection: Connection;
  path: string;
  entry?: Entry;
  message?: string;
};
type Listing = {
  connection: string;
  path: string;
  items: Entry[];
  revision: number;
};
type MenuContext = {
  webview: string;
  hdfsConnection: string;
  hdfsPath: string;
  hdfsRevision: number;
};

export function activate(context: vscode.ExtensionContext): void {
  const app = new Explorer(context);
  context.subscriptions.push(app);
}

class Explorer implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private connections: Connection[];
  private preferenceSettings: PreferenceSettings;
  private preferenceWrites = Promise.resolve();
  private get preferences(): Preferences {
    return {
      ...this.preferenceSettings,
      language: resolveLanguage(
        this.preferenceSettings.language,
        vscode.env.language,
      ),
    };
  }
  private emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private disposables: vscode.Disposable[] = [];
  private panel?: vscode.WebviewPanel;
  private previewPanel?: vscode.WebviewPanel;
  private listing?: Listing;
  private navigation = new Latest();
  private previewWork = new Latest();
  private inlineWork = new Latest();
  private diagnosticWork = new Latest();
  private gate = new Gate(4);
  private transferGate = new Gate(2);
  private operations = new Set<AbortController>();
  private treeGeneration = 0;
  private treeView: vscode.TreeView<Node>;
  private saving = false;
  private saveCheck = new Latest();
  private remoteLabel = "SSH";
  private localTransfer = !vscode.env.remoteName;
  private welcome: Welcome;
  private revision = 0;
  private downloads: Downloads;
  private tasks: Tasks;
  private settingsConnection?: string;
  private settingsFocus?: string;
  private settingsPreview?: {
    connection: string;
    path: string;
    encoding?: string;
  };
  private scope = vscode.env.remoteName ? "remote:" + hostname() : "local";
  private get connectionKey(): string {
    return "connections:" + this.scope;
  }
  private secretKey(id: string): string {
    return "connection." + this.scope + "." + id;
  }
  constructor(private context: vscode.ExtensionContext) {
    this.connections = context.globalState.get(this.connectionKey, []);
    this.preferenceSettings = {
      ...defaults,
      language: "auto",
      ...context.globalState.get<PreferenceSettings>("preferences"),
    };
    this.welcome = new Welcome(() => this.preferences.language);
    this.disposables.push(
      this.welcome,
      vscode.window.registerWebviewViewProvider(
        "hdfsLite.welcome",
        this.welcome,
      ),
    );
    this.tasks = new Tasks(
      context,
      (id) => this.client(id),
      () => this.preferences.language,
      (m) => this.send(m),
      () => this.remoteLabel,
      () => {
        this.refresh();
        this.send({ type: "filesChanged" });
      },
      this.transferGate,
    );
    this.disposables.push(this.tasks);
    this.downloads = new Downloads(
      context,
      () => this.preferences,
      (message) => this.send(message),
      () => this.open("browse"),
      this.transferGate,
      () => this.localTransfer,
      () => this.remoteLabel,
      (event) => void this.tasks.recordDownload(event),
    );
    this.disposables.push(
      this.downloads,
      vscode.commands.registerCommand(
        "_hdfsFileManager.cancelTransfer",
        (id) => {
          this.downloads.cancelTransfer(id);
          this.tasks.cancelReceiver(id);
        },
      ),
    );
    this.treeView = vscode.window.createTreeView("hdfsLite.tree", {
      treeDataProvider: this,
    });
    this.disposables.push(this.treeView, this.emitter);
    const register = (name: string, handler: (...args: any[]) => unknown) =>
      this.disposables.push(
        vscode.commands.registerCommand("hdfsLite." + name, handler),
      );
    register("open", (node?: Node) => {
      this.open("browse");
      if (node?.connection) void this.navigate(node.connection.id, node.path);
    });
    register("settings", () => this.open("settings"));
    for (const action of [
      "refresh",
      "download",
      "copy",
      "copyName",
      "openFolder",
      "preview",
      "previewTab",
      "info",
      "parent",
      "connectionSettings",
      "upload",
      "mkdir",
      "rename",
      "delete",
      "favorite",
    ])
      register(action, (target?: Node | MenuContext) =>
        this.contextAction(action, target).catch((error) =>
          vscode.window.showErrorMessage(
            errorText(error, this.preferences.language),
            { modal: true },
            this.t("Confirm", "确认"),
          ),
        ),
      );
    register("select", (node: Node) => {
      if (node.entry?.type === "FILE")
        void this.preview(node.connection.id, node.path);
      else {
        this.open("browse");
        void this.navigate(node.connection.id, node.path);
      }
    });
    this.updateLanguage();
  }
  private async refreshTransferAvailability() {
    if (!vscode.env.remoteName) return;
    try {
      const label =
        await vscode.commands.executeCommand<string>(remoteLabelCommand);
      this.localTransfer = true;
      if (typeof label === "string" && label && !/[\x00-\x1f]/.test(label)) {
        this.remoteLabel = label;
      }
    } catch {
      this.localTransfer = false;
    }
  }
  private async contextAction(
    action: string,
    target?: Node | MenuContext,
  ): Promise<void> {
    if (target && "webview" in target) {
      const listing = this.listing;
      if (
        target.webview !== "hdfsLite.explorer" ||
        !listing ||
        target.hdfsConnection !== listing.connection ||
        target.hdfsRevision !== listing.revision ||
        (target.hdfsPath !== listing.path &&
          !listing.items.some(
            (e) => joinPath(listing.path, e.pathSuffix) === target.hdfsPath,
          ))
      )
        return;
      this.send({
        type: "contextAction",
        action,
        connection: target.hdfsConnection,
        path: target.hdfsPath,
        revision: target.hdfsRevision,
      });
      return;
    }
    const node = target;
    if (action === "refresh") {
      this.refresh();
      if (node) {
        this.open("browse");
        await this.navigate(node.connection.id, node.path);
      } else if (this.listing)
        await this.navigate(this.listing.connection, this.listing.path);
      return;
    }
    if (!node || !this.connections.some((c) => c.id === node.connection.id))
      return;
    if (["mkdir", "rename", "delete"].includes(action)) {
      await this.fileOperation({
        action,
        connection: node.connection.id,
        path: node.path,
      });
      return;
    }
    if (
      action === "upload" ||
      action === "favorite" ||
      (action === "download" && node.entry?.type === "DIRECTORY")
    ) {
      this.open("browse");
      await this.navigate(
        node.connection.id,
        node.entry?.type === "FILE" ? posix.dirname(node.path) : node.path,
      );
      this.send({
        type: "manageAction",
        action,
        path: node.path,
        connection: node.connection.id,
      });
      return;
    }
    if (action === "copy" || action === "copyName") {
      await vscode.env.clipboard.writeText(
        action === "copy" ? node.path : posix.basename(node.path) || "/",
      );
    } else if (action === "download" && node.entry?.type === "FILE") {
      await this.download(node.connection.id, node.path);
    } else if (
      (action === "preview" || action === "previewTab") &&
      node.entry?.type === "FILE"
    ) {
      await this.preview(node.connection.id, node.path);
    } else if (action === "openFolder") {
      this.open("browse");
      await this.navigate(node.connection.id, node.path);
    } else if (action === "connectionSettings")
      this.open("settings", node.connection.id);
    else if (action === "info" && node.entry) {
      const e = node.entry;
      const detail = [
        node.path,
        `${this.t("Size", "大小")}: ${e.length.toLocaleString()} B`,
        `${this.t("Owner / group", "所有者 / 组")}: ${e.owner} / ${e.group}`,
        `${this.t("Permissions", "权限")}: ${e.permission}`,
        `${this.t("Modified", "修改时间")}: ${new Date(e.modificationTime).toLocaleString(this.preferences.language)}`,
      ].join("\n");
      const copy = this.t("Copy HDFS path", "复制 HDFS 路径");
      if (
        (await vscode.window.showInformationMessage(
          e.pathSuffix,
          { modal: true, detail },
          copy,
        )) === copy
      )
        await vscode.env.clipboard.writeText(node.path);
    }
  }
  private t(en: string, zh: string): string {
    return tr(this.preferences.language, en, zh);
  }
  private get host(): string {
    return vscode.env.remoteName
      ? `${this.t("Remote host", "远端主机")}: ${this.remoteLabel}`
      : this.t("This computer", "本机");
  }
  private updateLanguage(): void {
    this.welcome.update();
    this.treeView.title = this.t("Connections", "连接");
    this.treeView.message = undefined;
    void vscode.commands.executeCommand(
      "setContext",
      "hdfsLite.hasConnections",
      this.connections.length > 0,
    );
    if (this.panel) this.panel.title = "HDFS File Manager";
  }
  private refresh(): void {
    this.treeGeneration++;
    this.emitter.fire(undefined);
  }
  getTreeItem(node: Node): vscode.TreeItem {
    const directory = !node.entry || node.entry.type === "DIRECTORY";
    const item = new vscode.TreeItem(
      node.message ?? node.entry?.pathSuffix ?? node.connection.name,
      !node.message && directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id =
      node.connection.id + ":" + node.path + (node.message ? ":message" : "");
    item.contextValue = node.message
      ? "message"
      : !node.entry
        ? "connection"
        : node.entry.type.toLowerCase();
    if (node.connection.readOnly) item.contextValue += "Readonly";
    item.iconPath = new vscode.ThemeIcon(
      node.message
        ? "info"
        : themeIcons[
            fileKind(node.path, directory ? "DIRECTORY" : node.entry?.type)
          ],
    );
    item.tooltip = node.path;
    if (node.entry?.type !== "SYMLINK")
      item.command = {
        command: "hdfsLite.select",
        title: this.t("Open", "打开"),
        arguments: [node],
      };
    else item.description = this.t("Symbolic link", "符号链接");
    return item;
  }
  async getChildren(node?: Node): Promise<Node[]> {
    if (!node)
      return this.connections.map((connection) => ({
        connection,
        path: connection.root,
      }));
    const controller = new AbortController();
    this.operations.add(controller);
    const generation = this.treeGeneration;
    try {
      const client = await this.client(node.connection.id);
      const items = await this.gate.run(controller.signal, () =>
        client.list(node.path, controller.signal),
      );
      if (generation !== this.treeGeneration) return [];
      const children: Node[] = items.slice(0, 1000).map((entry) => ({
        connection: node.connection,
        path: joinPath(node.path, entry.pathSuffix),
        entry,
      }));
      if (items.length > 1000)
        children.push({
          ...node,
          message: this.t(
            "Open Explorer to browse all items…",
            "查看全部文件…",
          ),
        });
      return children;
    } catch (error) {
      if (generation !== this.treeGeneration) return [];
      return [
        {
          ...node,
          message:
            errorText(error, this.preferences.language) +
            this.t(
              " Open HDFS File Manager to retry.",
              " 打开 HDFS File Manager 重试。",
            ),
        },
      ];
    } finally {
      this.operations.delete(controller);
    }
  }
  private async client(id: string): Promise<Client> {
    const connection = this.connections.find((c) => c.id === id);
    if (!connection) throw new HdfsError("missing");
    const secret = (await this.context.secrets.get(this.secretKey(id))) ?? "";
    if (["basic", "bearer", "delegation"].includes(connection.auth) && !secret)
      throw new HdfsError("secret");
    return new Client(connection, secret);
  }
  private html(webview: vscode.Webview, mode = "main"): string {
    const nonce = randomBytes(18).toString("base64");
    const uri = (file: string) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "web", file),
      );
    return `<!doctype html><html lang="${this.preferences.language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="csp-nonce" content="${nonce}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${webview.cspSource}; img-src data: ${webview.cspSource}; font-src ${webview.cspSource} data:; connect-src ${webview.cspSource}; worker-src ${webview.cspSource} blob:;"><link rel="stylesheet" href="${uri("style.css")}"></head><body data-mode="${mode}"><main id="app"></main><script nonce="${nonce}" type="module" src="${uri(mode === "preview" ? "preview.js" : "app.js")}"></script></body></html>`;
  }
  private send(message: object): void {
    void this.panel?.webview.postMessage(message);
  }
  private state(mode?: string): void {
    this.send({
      type: "state",
      connections: this.connections,
      uploadTargets: this.context.globalState.get("uploadTargets", {}),
      places: this.context.globalState.get("places", {}),
      preferences: this.preferences,
      languageSetting: this.preferenceSettings.language,
      pageSize: normalizePageSize(this.context.globalState.get("pageSize")),
      host: this.host,
      remote: !!vscode.env.remoteName,
      localTransfer: this.localTransfer,
      hostName: this.remoteLabel,
      mode,
      editConnection: this.settingsConnection,
      settingsFocus: this.settingsFocus,
      previewReturn: this.settingsPreview,
    });
    this.settingsConnection = undefined;
    this.settingsFocus = undefined;
    this.settingsPreview = undefined;
  }
  private open(mode: string, connection?: string): void {
    this.settingsConnection = connection;
    if (this.panel) {
      this.panel.reveal();
      this.state(mode);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "hdfsLite.explorer",
      "HDFS File Manager",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "dist", "web"),
        ],
      },
    );
    this.panel = panel;
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage(
      (message) => this.message(message, mode),
      undefined,
      this.disposables,
    );
    panel.onDidDispose(
      () => {
        this.saveCheck.cancel();
        this.navigation.cancel();
        this.diagnosticWork.cancel();
        this.inlineWork.cancel();
        this.downloads.close();
        this.panel = undefined;
        this.listing = undefined;
      },
      undefined,
      this.disposables,
    );
  }
  private async message(message: any, initial: string): Promise<void> {
    if (!message || typeof message.type !== "string") return;
    try {
      switch (message.type) {
        case "task":
          if (
            vscode.env.remoteName &&
            message.target === "local" &&
            !this.localTransfer
          ) {
            this.send({
              type: "taskError",
              request: message.request,
              text: errorText(
                new HdfsError("localTransfer"),
                this.preferences.language,
              ),
            });
            break;
          }
          await this.tasks.message(message);
          break;
        case "tasks":
          await this.tasks.snapshot();
          break;
        case "place": {
          if (
            !this.connections.some(
              (connection) => connection.id === message.connection,
            )
          )
            break;
          const path = normalizePath(message.path);
          const places = this.context.globalState.get<any>("places", {});
          const entry = places[message.connection] || { favorites: [] };
          const index = entry.favorites.findIndex(
            (item: any) => item.path === path,
          );
          const active =
            message.action === "set" ? message.active === true : index < 0;
          if (!active && index >= 0) entry.favorites.splice(index, 1);
          if (active && index < 0)
            entry.favorites.push({
              path,
              name: posix.basename(path) || "/",
              type:
                message.entryType === "FILE" || message.entryType === "SYMLINK"
                  ? message.entryType
                  : "DIRECTORY",
            });
          places[message.connection] = entry;
          await this.context.globalState.update("places", places);
          this.send({ type: "places", places });
          break;
        }
        case "fileOperation":
          try {
            await this.fileOperation(message);
          } catch (error) {
            this.refresh();
            this.send({ type: "filesChanged" });
            await vscode.window.showErrorMessage(
              errorText(error, this.preferences.language),
              { modal: true },
              this.t("Confirm", "确认"),
            );
          }
          break;
        case "ready":
          await this.refreshTransferAvailability();
          this.state(initial);
          this.downloads.ready();
          if (this.listing) {
            this.send({
              type: "listed",
              connection: this.listing.connection,
              path: this.listing.path,
              total: this.listing.items.length,
              revision: this.listing.revision,
            });
          }
          break;
        case "navigate":
          await this.navigate(
            String(message.connection),
            String(message.path),
            message.request,
          );
          break;
        case "selectFiltered":
          if (this.listing && message.revision === this.listing.revision)
            this.send({
              type: "selection",
              revision: this.listing.revision,
              filter: message.filter,
              paths: this.listing.items
                .filter((e) =>
                  e.pathSuffix
                    .toLocaleLowerCase()
                    .includes(String(message.filter || "").toLocaleLowerCase()),
                )
                .map((e) => joinPath(this.listing!.path, e.pathSuffix)),
            });
          break;
        case "page":
          this.page(message);
          break;
        case "cancel":
          this.navigation.cancel();
          this.send({ type: "cancelled", request: message.request });
          break;
        case "disconnect":
          this.diagnosticWork.cancel();
          this.downloads.cancelAll();
          this.tasks.cancelAll();
          this.navigation.cancel();
          this.previewWork.cancel();
          this.inlineWork.cancel();
          this.previewPanel?.dispose();
          for (const c of this.operations) c.abort();
          this.listing = undefined;
          this.send({ type: "disconnected" });
          this.refresh();
          break;
        case "save":
          await this.save(message);
          break;
        case "savePreference":
          await this.savePreference(
            message.key,
            message.value,
            message.request,
          );
          break;
        case "cancelSave":
          this.saveCheck.cancel();
          break;
        case "remove":
          await this.remove(String(message.id));
          break;
        case "preview":
          if (message.inline)
            await this.previewInline(
              String(message.connection),
              String(message.path),
              message.previewRequest,
              message.encoding,
            );
          else
            await this.preview(
              String(message.connection),
              String(message.path),
              message.encoding,
            );
          break;
        case "cancelPreview":
          this.inlineWork.cancel();
          break;
        case "download":
          await this.download(String(message.connection), String(message.path));
          break;
        case "downloadTarget":
        case "downloadBrowse":
        case "downloadSubmit":
        case "downloadCancel":
          await this.downloads.message(message);
          break;
        case "downloadReload":
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
          break;
        case "copy":
          await vscode.env.clipboard.writeText(
            message.nameOnly
              ? posix.basename(normalizePath(String(message.path))) || "/"
              : normalizePath(String(message.path)),
          );
          break;
        case "diagnose":
          await this.diagnose(
            String(message.connection),
            String(message.path),
            message.request,
          );
          break;
        case "cancelDiagnose":
          this.diagnosticWork.cancel();
          break;
      }
    } catch (error) {
      this.send({
        type: "error",
        text: errorText(error, this.preferences.language),
        scope: message.type,
        request: message.request,
        code: error instanceof HdfsError ? error.code : "unknown",
      });
    }
  }
  private async savePreference(key: unknown, value: unknown, request: unknown) {
    const write = this.preferenceWrites.then(async () => {
      const previous = this.preferences.language;
      const next = changePreference(this.preferenceSettings, key, value);
      await this.context.globalState.update("preferences", next);
      this.preferenceSettings = next;
      if (this.preferences.language !== previous) {
        this.updateLanguage();
        this.refresh();
        void this.previewPanel?.webview.postMessage({
          type: "language",
          language: this.preferences.language,
        });
      }
      this.send({
        type: "preferenceSaved",
        key,
        request,
        preferences: this.preferences,
        languageSetting: next.language,
        host: this.host,
      });
    });
    this.preferenceWrites = write.catch(() => {});
    try {
      await write;
    } catch {
      this.send({ type: "preferenceError", key, request });
    }
  }
  private async save(message: any): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    let restoreSecret: (() => Promise<void>) | undefined;
    const check = this.saveCheck.next();
    let checkedItems: Entry[] | undefined;
    let checkedRead = false;
    try {
      const input = message.connection;
      let next = [...this.connections];
      let savedId: string | undefined;
      if (input) {
        if (
          typeof input.id !== "string" ||
          (input.id && !next.some((c) => c.id === input.id))
        )
          throw new HdfsError("missing");
        const connection = validateConnection({
          ...input,
          id: input.id || randomUUID(),
        });
        savedId = connection.id;
        const secret = typeof message.secret === "string" ? message.secret : "";
        if (/[\r\n]/.test(secret)) throw new HdfsError("secret");
        const requiresSecret = ["basic", "bearer", "delegation"].includes(
          connection.auth,
        );
        const previous = next.find((c) => c.id === connection.id);
        const oldSecret = await this.context.secrets.get(
          this.secretKey(connection.id),
        );
        // An unchanged stored secret is reusable only for the same endpoint, identity and method.
        const reuse =
          previous &&
          previous.endpoint === connection.endpoint &&
          previous.auth === connection.auth &&
          previous.username === connection.username;
        if (requiresSecret && !secret && (!reuse || !oldSecret))
          throw new HdfsError("secret");
        if (message.check) {
          const client = new Client(
            connection,
            secret || (reuse ? oldSecret : "") || "",
          );
          checkedItems = await this.gate.run(check.signal, () =>
            client.list(connection.root, check.signal),
          );
          const file = checkedItems.find(
            (entry) => entry.type === "FILE" && entry.length > 0,
          );
          if (file) {
            await this.gate.run(check.signal, () =>
              client.read(
                joinPath(connection.root, file.pathSuffix),
                1,
                check.signal,
              ),
            );
            checkedRead = true;
          }
          if (check.signal.aborted) throw new HdfsError("cancelled");
          this.send({ type: "connectionCommitting", request: message.request });
        }
        if ((requiresSecret && secret) || !requiresSecret)
          restoreSecret = async () =>
            oldSecret === undefined
              ? this.context.secrets.delete(this.secretKey(connection.id))
              : this.context.secrets.store(
                  this.secretKey(connection.id),
                  oldSecret,
                );
        if (requiresSecret && secret)
          await this.context.secrets.store(
            this.secretKey(connection.id),
            secret,
          );
        if (!requiresSecret)
          await this.context.secrets.delete(this.secretKey(connection.id));
        const index = next.findIndex((c) => c.id === connection.id);
        if (index < 0) next.push(connection);
        else next[index] = connection;
      }
      if (input)
        await this.context.globalState.update(this.connectionKey, next);
      restoreSecret = undefined;
      if (input) {
        this.navigation.cancel();
        this.diagnosticWork.cancel();
      }
      this.previewWork.cancel();
      this.inlineWork.cancel();
      this.previewPanel?.dispose();
      if (input) for (const c of this.operations) c.abort();
      if (input) {
        this.downloads.cancelAll();
        this.tasks.cancelAll();
      }
      this.connections = next;
      if (input)
        this.listing = checkedItems
          ? {
              connection: savedId!,
              path: next.find((c) => c.id === savedId)!.root,
              items: checkedItems,
              revision: ++this.revision,
            }
          : undefined;
      this.updateLanguage();
      this.refresh();
      this.state("settings");
      this.send({
        type: "saved",
        id: savedId,
        kind: "connection",
        checked: !!message.check,
        checkedRead,
        request: message.request,
      });
    } catch (error) {
      // The editor's configuration and secret stores have independent commits.
      // Restore the previous secret if persistence fails so Retry keeps its meaning.
      if (restoreSecret) await restoreSecret();
      if (
        message.check &&
        error instanceof HdfsError &&
        error.code === "missing" &&
        error.stage === "namenode"
      )
        throw new HdfsError("connectionMissing");
      throw error;
    } finally {
      this.saving = false;
    }
  }
  private async remove(id: string): Promise<void> {
    const connection = this.connections.find((c) => c.id === id);
    if (!connection) return;
    const action = this.t("Remove connection", "移除连接");
    if (
      (await vscode.window.showWarningMessage(
        this.t(
          `Remove “${connection.name}”? HDFS files are unchanged.`,
          `移除“${connection.name}”？HDFS 文件不受影响。`,
        ),
        { modal: true },
        action,
      )) !== action
    )
      return;
    this.navigation.cancel();
    this.diagnosticWork.cancel();
    this.previewWork.cancel();
    this.inlineWork.cancel();
    this.previewPanel?.dispose();
    for (const c of this.operations) c.abort();
    this.downloads.cancelAll();
    this.tasks.cancelAll();
    await this.tasks.settle();
    const next = this.connections.filter((c) => c.id !== id);
    const oldSecret = await this.context.secrets.get(this.secretKey(id));
    await this.context.secrets.delete(this.secretKey(id));
    try {
      await this.context.globalState.update(this.connectionKey, next);
    } catch (error) {
      if (oldSecret !== undefined)
        await this.context.secrets.store(this.secretKey(id), oldSecret);
      throw error;
    }
    this.connections = next;
    this.listing = undefined;
    this.refresh();
    this.updateLanguage();
    this.state("settings");
  }
  private async navigate(
    id: string,
    path: string,
    request?: number,
  ): Promise<void> {
    const controller = this.navigation.next();
    this.inlineWork.cancel();
    // Retain the last successful listing until the replacement is ready. A
    // cancelled navigation can then restore its rows and continue paging.
    this.send({ type: "loading", scope: "navigate", request });
    try {
      path = normalizePath(path);
      const client = await this.client(id);
      const items = await this.gate.run(controller.signal, () =>
        client.list(path, controller.signal),
      );
      if (!this.navigation.isCurrent(controller)) return;
      this.listing = { connection: id, path, items, revision: ++this.revision };
      this.send({
        type: "listed",
        connection: id,
        path,
        request,
        total: items.length,
        revision: this.listing.revision,
      });
    } catch (error) {
      if (this.navigation.isCurrent(controller))
        this.send({
          type: "error",
          scope: "navigate",
          code: error instanceof HdfsError ? error.code : "unknown",
          text: errorText(error, this.preferences.language),
          request,
        });
    }
  }
  private page(message: any): void {
    if (!this.listing || message.revision !== this.listing.revision) return;
    const filter = String(message.filter ?? "");
    const pageSize = normalizePageSize(message.pageSize);
    if (this.context.globalState.get("pageSize") !== pageSize)
      void this.context.globalState.update("pageSize", pageSize);
    this.send({
      type: "page",
      path: this.listing.path,
      connection: this.listing.connection,
      ...selectPage(
        this.listing.items,
        filter,
        Number(message.page),
        message.sort,
        message.descending === true,
        pageSize,
        typeof message.focusName === "string" ? message.focusName : undefined,
      ),
      filter,
      revision: this.listing.revision,
      pageRequest: message.pageRequest,
    });
  }
  private async diagnose(
    id: string,
    path: string,
    request?: number,
  ): Promise<void> {
    const controller = this.diagnosticWork.next();
    try {
      const client = await this.client(id);
      const result = await this.gate.run(controller.signal, async () => {
        const entry = await client.stat(path, controller.signal);
        if (entry.type === "DIRECTORY") {
          const items =
            this.listing?.connection === id && this.listing.path === path
              ? this.listing.items
              : await client.list(path, controller.signal);
          const file = items.find(
            (item) => item.type === "FILE" && item.length > 0,
          );
          if (!file)
            return this.t(
              "No non-empty file in this folder to check.",
              "当前目录没有可供检查的非空文件。",
            );
          await client.read(
            joinPath(path, file.pathSuffix),
            1,
            controller.signal,
          );
        } else await client.read(path, 1, controller.signal);
      });
      if (this.diagnosticWork.isCurrent(controller))
        this.send({ type: "diagnosed", connection: id, text: result, request });
    } catch (error) {
      if (this.diagnosticWork.isCurrent(controller))
        this.send({
          type: "diagnosed",
          connection: id,
          code: error instanceof HdfsError ? error.code : "unknown",
          request,
          text: errorText(error, this.preferences.language),
        });
    }
  }
  private async previewInline(
    id: string,
    path: string,
    previewRequest: number,
    encoding: unknown = "auto",
  ): Promise<void> {
    const controller = this.inlineWork.next();
    const base = {
      language: this.preferences.language,
      path,
      connection: this.connections.find((c) => c.id === id)?.name,
      host: this.host,
    };
    const emit = (content: object) => {
      if (this.inlineWork.isCurrent(controller))
        this.send({
          type: "previewResult",
          previewRequest,
          content: { ...base, ...content },
        });
    };
    emit({ type: "loading" });
    try {
      const client = await this.client(id);
      const content = await this.gate.run(controller.signal, () =>
        readPreview(
          client,
          path,
          this.preferences,
          controller.signal,
          encoding,
        ),
      );
      emit(content);
    } catch (error) {
      emit({
        type: "error",
        code: error instanceof HdfsError ? error.code : "unknown",
        text: errorText(error, this.preferences.language),
      });
    }
  }
  private async preview(
    id: string,
    path: string,
    encoding: unknown = "auto",
  ): Promise<void> {
    let controller = this.previewWork.next();
    if (!this.panel) this.open("browse");
    this.previewPanel?.dispose();
    const panel = vscode.window.createWebviewPanel(
      "hdfsLite.preview",
      posix.basename(path),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "dist", "web"),
        ],
      },
    );
    this.previewPanel = panel;
    let ready: (() => void) | undefined;
    const loaded = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const load = async () => {
      if (this.previewPanel !== panel) return;
      controller = this.previewWork.next();
      const active = controller;
      const selectedEncoding = normalizeEncoding(encoding);
      const base = {
        language: this.preferences.language,
        path,
        connection: this.connections.find((c) => c.id === id)?.name,
        host: this.host,
      };
      void panel.webview.postMessage({ type: "loading", ...base });
      try {
        const client = await this.client(id);
        const content = await this.gate.run(active.signal, () =>
          readPreview(
            client,
            path,
            this.preferences,
            active.signal,
            selectedEncoding,
          ),
        );
        if (!active.signal.aborted && this.previewPanel === panel)
          void panel.webview.postMessage({ ...base, ...content });
      } catch (error) {
        if (!active.signal.aborted && this.previewPanel === panel)
          void panel.webview.postMessage({
            type: "error",
            code: error instanceof HdfsError ? error.code : "unknown",
            ...base,
            text: errorText(error, this.preferences.language),
          });
      }
    };
    panel.webview.onDidReceiveMessage((message) => {
      if (message.type === "ready") ready?.();
      if (message.type === "download") void this.download(id, path);
      if (message.type === "cancel") controller.abort();
      if (message.type === "retry") void load();
      if (message.type === "encoding") {
        encoding = normalizeEncoding(message.encoding);
        void load();
      }
      if (message.type === "settings") {
        this.settingsPreview = {
          connection: id,
          path,
          encoding: normalizeEncoding(encoding),
        };
        this.settingsFocus =
          typeof message.focus === "string" ? message.focus : undefined;
        this.open("settings", id);
      }
      if (message.type === "parent") {
        this.open("browse");
        void this.navigate(id, posix.dirname(path));
      }
      if (message.type === "browse") {
        this.panel?.reveal();
        this.send({ type: "focusFiles" });
      }
    });
    panel.onDidDispose(() => {
      controller.abort();
      ready?.();
      if (this.previewPanel === panel) this.previewPanel = undefined;
    });
    panel.webview.html = this.html(panel.webview, "preview");
    await loaded;
    if (controller.signal.aborted) return;
    await load();
  }
  private async fileOperation(m: any) {
    const client = await this.client(String(m.connection));
    if (client.connection.readOnly) throw new HdfsError("readOnly");
    const zh = this.preferences.language === "zh-CN";
    const controller = new AbortController();
    this.operations.add(controller);
    try {
      const path = normalizePath(m.path);
      if (m.action === "delete") {
        const paths: string[] = Array.isArray(m.paths) ? m.paths : [path];
        const removed: string[] = [];
        if (paths.some((p) => normalizePath(p) === "/"))
          throw new HdfsError("path");
        const label = zh ? "确认删除" : "Delete";
        if (
          (await vscode.window.showWarningMessage(
            label,
            {
              modal: true,
              detail:
                paths.length === 1
                  ? paths[0]
                  : `${paths.length} ${zh ? "项" : "items"}`,
            },
            label,
          )) !== label
        )
          return;
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: zh ? "正在删除" : "Deleting",
            cancellable: true,
          },
          async (_, token) => {
            const sub = token.onCancellationRequested(() => controller.abort());
            try {
              for (const target of paths) {
                if (controller.signal.aborted) break;
                await client.remove(target, controller.signal, true);
                removed.push(target);
              }
            } finally {
              sub.dispose();
            }
          },
        );
        const places = this.context.globalState.get<any>("places", {});
        const entry = places[m.connection];
        if (entry?.favorites.length && removed.length) {
          const deleted = new Set(removed);
          entry.favorites = entry.favorites.filter(
            (favorite: { path: string }) => {
              let parent = favorite.path;
              while (parent !== "/") {
                if (deleted.has(parent)) return false;
                parent = posix.dirname(parent);
              }
              return true;
            },
          );
          await this.context.globalState.update("places", places);
          this.send({ type: "places", places });
        }
      } else {
        const rename = m.action === "rename";
        const value = await vscode.window.showInputBox({
          title: rename
            ? zh
              ? "重命名"
              : "Rename"
            : zh
              ? "新建文件夹"
              : "New folder",
          value: rename ? posix.basename(path) : "",
          placeHolder: rename ? undefined : zh ? "文件夹名称" : "Folder name",
          valueSelection: rename
            ? [0, posix.basename(path).length - posix.extname(path).length]
            : undefined,
          validateInput: (value) =>
            !value ||
            value === "." ||
            value === ".." ||
            /[\/\x00-\x1f]/.test(value)
              ? zh
                ? "请输入有效名称。"
                : "Enter a valid name."
              : undefined,
        });
        if (value === undefined || (rename && value === posix.basename(path)))
          return;
        const destination = joinPath(
          rename ? posix.dirname(path) : path,
          value,
        );
        if (rename) {
          await client.rename(path, destination, controller.signal);
          const places = this.context.globalState.get<any>("places", {});
          const entry = places[m.connection];
          if (entry) {
            for (const p of entry.favorites)
              if (p.path === path || p.path.startsWith(path + "/")) {
                if (p.name === posix.basename(p.path) && p.path === path)
                  p.name = posix.basename(destination);
                p.path = destination + p.path.slice(path.length);
              }
            await this.context.globalState.update("places", places);
            this.send({ type: "places", places });
          }
        } else {
          if (await client.exists(destination, controller.signal))
            throw new HdfsError("exists");
          await client.mkdir(destination, controller.signal);
        }
      }
      this.refresh();
      this.send({ type: "filesChanged" });
    } finally {
      this.operations.delete(controller);
    }
  }
  private async download(id: string, path: string): Promise<void> {
    const generation = this.treeGeneration;
    try {
      const client = await this.client(id);
      await this.refreshTransferAvailability();
      if (generation !== this.treeGeneration) return;
      await this.downloads.open(client, path);
    } catch (error) {
      const retry = this.t("Retry", "重试"),
        settings = this.t("Settings", "设置");
      const action = await vscode.window.showErrorMessage(
        errorText(error, this.preferences.language),
        retry,
        settings,
      );
      if (generation !== this.treeGeneration) return;
      if (action === retry) await this.download(id, path);
      if (action === settings) this.open("settings");
    }
  }
  dispose(): void {
    this.saveCheck.cancel();
    this.navigation.cancel();
    this.diagnosticWork.cancel();
    this.previewWork.cancel();
    this.inlineWork.cancel();
    for (const controller of this.operations) controller.abort();
    this.panel?.dispose();
    this.previewPanel?.dispose();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
