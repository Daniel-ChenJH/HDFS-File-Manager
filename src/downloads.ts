import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { Client } from "./client";
import { downloadName, Gate, HdfsError, Preferences } from "./model";
import { errorText } from "./i18n";
import { diskService } from "./disk-host";
import { transferCommand, TransferReply } from "./transfer";

type Target = "host" | "local";
type Choice = {
  id: string;
  client: Client;
  path: string;
  controller: AbortController;
  target: Target;
  busy: boolean;
};
export class Downloads {
  private disk;
  private choice?: Choice;
  private running = new Map<
    string,
    { controller: AbortController; target: Target }
  >();
  constructor(
    context: vscode.ExtensionContext,
    private preferences: () => Preferences,
    private send: (message: any) => void,
    private reveal: () => void,
    private gate: Gate,
    private localTransfer: () => boolean,
    private hostLabel: () => string = () => "SSH",
    private track: (event: any) => void = () => {},
  ) {
    this.disk = diskService(context, (language) =>
      vscode.env.remoteName
        ? this.hostLabel()
        : language === "zh-CN"
          ? "本机"
          : "This computer",
    );
  }
  private async call(target: Target, message: any): Promise<any> {
    let reply: TransferReply;
    if (target === "local" && vscode.env.remoteName) {
      if (!this.localTransfer()) throw new HdfsError("localTransfer");
      try {
        reply = await vscode.commands.executeCommand<TransferReply>(
          transferCommand,
          message,
        );
      } catch {
        throw new HdfsError("localTransfer");
      }
      if (!reply) throw new HdfsError("localTransfer");
    } else reply = await this.disk.handle(message);
    if (!reply.ok) throw new HdfsError(reply.code);
    return reply.value;
  }
  async open(client: Client, path: string) {
    this.close();
    this.choice = {
      id: randomUUID(),
      client,
      path,
      controller: new AbortController(),
      target: vscode.env.remoteName
        ? this.localTransfer()
          ? (this.preferences().downloadTarget ?? "host")
          : "host"
        : "local",
      busy: false,
    };
    this.reveal();
    this.ready();
  }
  ready() {
    const choice = this.choice;
    if (!choice) return;
    this.send({
      type: "downloadDialog",
      id: choice.id,
      target: choice.target,
      remote: !!vscode.env.remoteName,
      localTransfer: this.localTransfer(),
      hostName: this.hostLabel(),
      name: downloadName(choice.path),
      language: this.preferences().language,
    });
  }
  close() {
    if (!this.choice) return;
    const choice = this.choice;
    choice.controller.abort();
    this.choice = undefined;
    this.send({ type: "downloadClosed", id: choice.id });
  }
  async message(message: any) {
    const choice = this.choice;
    if (!choice || message.id !== choice.id) return;
    if (message.type === "downloadCancel") {
      this.close();
      return;
    }
    const target: Target =
      message.target === "local" || !vscode.env.remoteName ? "local" : "host";
    try {
      if (message.type === "downloadTarget") {
        choice.target = target;
        const info = await this.call(target, { op: "info" });
        if (this.choice !== choice || choice.controller.signal.aborted) return;
        this.send({
          type: "downloadLocation",
          id: choice.id,
          target,
          request: message.request,
          folder: info.folder,
          name: downloadName(choice.path, info.platform),
        });
      } else if (message.type === "downloadBrowse") {
        const info = await this.call(target, {
          op: "choose",
          folder: message.folder,
        });
        if (this.choice === choice)
          this.send({
            type: "downloadLocation",
            id: choice.id,
            target,
            request: message.request,
            folder: info.folder,
            chosen: true,
          });
      } else if (message.type === "downloadSubmit" && !choice.busy) {
        choice.busy = true;
        const language = this.preferences().language,
          zh = language === "zh-CN";
        const prepared = await this.call(target, {
          op: "prepare",
          folder: message.folder,
          name: message.name,
        });
        if (this.choice !== choice || choice.controller.signal.aborted) return;
        if (prepared.stamp !== null) {
          const replace = zh ? "替换" : "Replace";
          const answer = await vscode.window.showWarningMessage(
            zh ? `替换 ${message.name}？` : `Replace ${message.name}?`,
            { modal: true, detail: prepared.path },
            replace,
          );
          if (answer !== replace) {
            this.send({ type: "downloadError", id: choice.id, text: "" });
            return;
          }
        }
        if (this.choice !== choice || choice.controller.signal.aborted) return;
        const stat = await this.gate.run(choice.controller.signal, () =>
          choice.client.stat(choice.path, choice.controller.signal),
        );
        const started = await this.call(target, {
          op: "begin",
          folder: message.folder,
          name: message.name,
          stamp: prepared.stamp,
          size: stat.length,
          language,
        });
        if (choice.controller.signal.aborted) {
          await this.call(target, { op: "abort", id: started.id });
          return;
        }
        this.running.set(started.id, { controller: choice.controller, target });
        this.choice = undefined;
        this.send({ type: "downloadClosed", id: choice.id });
        void this.run(choice, target, started.id, stat.length, message);
      }
    } catch (error) {
      if (this.choice === choice && !choice.controller.signal.aborted)
        this.send({
          type: "downloadError",
          id: choice.id,
          target,
          request: message.request,
          code: error instanceof HdfsError ? error.code : "unknown",
          text: errorText(error, this.preferences().language),
        });
    } finally {
      choice.busy = false;
    }
  }
  private async run(
    choice: Choice,
    target: Target,
    id: string,
    size: number,
    destination: any,
  ) {
    this.track({
      id,
      client: choice.client,
      path: choice.path,
      target,
      folder: destination.folder,
      name: destination.name,
      status: "running",
      bytes: 0,
      controller: choice.controller,
    });
    let transferred = 0;
    try {
      await this.gate.run(choice.controller.signal, async () => {
        const sha256 = await choice.client.streamDownload(
          choice.path,
          size,
          choice.controller.signal,
          async (chunk, offset) => {
            await this.call(target, {
              op: "write",
              id,
              offset,
              data: chunk.toString("base64"),
            });
            transferred += chunk.length;
            this.track({ id, bytes: transferred });
          },
        );
        await this.call(target, { op: "commit", id, sha256 });
        this.track({ id, status: "completed", done: 1 });
      });
    } catch (error) {
      this.track({
        id,
        status: choice.controller.signal.aborted ? "cancelled" : "failed",
        error: choice.controller.signal.aborted
          ? undefined
          : errorText(error, this.preferences().language),
      });
      await this.call(target, { op: "abort", id }).catch(() => {});
      if (
        !choice.controller.signal.aborted &&
        !(error instanceof HdfsError && error.code === "cancelled")
      ) {
        const zh = this.preferences().language === "zh-CN",
          retry = zh ? "重试" : "Retry";
        const answer = await vscode.window.showErrorMessage(
          errorText(error, this.preferences().language),
          retry,
        );
        if (
          answer === retry &&
          !this.choice &&
          !choice.controller.signal.aborted
        ) {
          await this.open(choice.client, choice.path);
          this.send({
            type: "downloadRestore",
            target,
            folder: destination.folder,
            name: destination.name,
          });
        }
      }
    } finally {
      this.running.delete(id);
    }
  }
  cancelTransfer(id: string) {
    this.running.get(id)?.controller.abort();
  }
  cancelAll() {
    this.close();
    for (const [id, operation] of this.running) {
      operation.controller.abort();
      void this.call(operation.target, { op: "abort", id }).catch(() => {});
    }
  }
  dispose() {
    this.cancelAll();
    void this.disk.dispose();
  }
}
