import * as vscode from "vscode";
import { diskService } from "./disk-host";
import { transferCommand } from "./transfer";
import { remoteLabelCommand, workspaceRemoteLabel } from "./remote-label";
import { FileAccess } from "./file-access";
const files = new FileAccess();
let service: ReturnType<typeof diskService> | undefined;
export function activate(context: vscode.ExtensionContext) {
  service = diskService(
    context,
    (language) => (language === "zh-CN" ? "本机" : "This computer"),
    false,
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("_hdfsFileManager.reveal", (path: string) =>
      vscode.env.openExternal(vscode.Uri.file(path)),
    ),
    vscode.commands.registerCommand("_hdfsFileManager.files", (message) =>
      files.reply(message),
    ),
    vscode.commands.registerCommand(remoteLabelCommand, workspaceRemoteLabel),
    vscode.commands.registerCommand(transferCommand, (message) =>
      service!.handle(message),
    ),
  );
}
export async function deactivate() {
  await service?.dispose();
  await files.dispose();
}
