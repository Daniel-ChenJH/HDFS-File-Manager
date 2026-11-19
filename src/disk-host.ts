import * as vscode from "vscode";
import { homedir, hostname } from "node:os";
import { TransferService } from "./transfer";
import { HdfsError } from "./model";

export function diskService(
  context: vscode.ExtensionContext,
  label: (language: string) => string,
  remoteHost = !!vscode.env.remoteName,
): TransferService {
  const folderKey =
    "downloadFolder:" + (remoteHost ? "remote:" + hostname() : "local");
  return new TransferService({
    cancelled: (id) => {
      void vscode.commands
        .executeCommand("_hdfsFileManager.cancelTransfer", id)
        .then(undefined, () => {});
    },
    folder: () => context.globalState.get<string>(folderKey, homedir()),
    remember: async (folder) => {
      await context.globalState.update(folderKey, folder);
    },
    choose: async (folder) => {
      const result = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(folder),
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      });
      if (!result?.[0]) return undefined;
      if (result[0].scheme !== "file") throw new HdfsError("destinationHost");
      return result[0].fsPath;
    },
    progress: (path, size, language, cancel, quiet) => {
      if (quiet) return { update() {}, close() {} };
      let finish!: () => void,
        reporter:
          | vscode.Progress<{ increment?: number; message?: string }>
          | undefined,
        previous = 0;
      const completed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      void vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title:
            (language === "zh-CN" ? "正在下载到 " : "Downloading to ") +
            label(language) +
            " · " +
            path,
          cancellable: true,
        },
        async (progress, token) => {
          reporter = progress;
          const subscription = token.onCancellationRequested(cancel);
          if (token.isCancellationRequested) cancel();
          try {
            await completed;
          } finally {
            subscription.dispose();
          }
        },
      );
      return {
        close: finish,
        update(bytes) {
          const percent = size ? (bytes / size) * 100 : 0;
          reporter?.report({
            increment: percent - previous,
            message: `${(bytes / 1048576).toFixed(1)} MiB`,
          });
          previous = percent;
        },
      };
    },
  });
}
