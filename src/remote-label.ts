import * as vscode from "vscode";

export const remoteLabelCommand = "_hdfsFileManager.remoteLabel";
export function workspaceRemoteLabel(): string | undefined {
  const uris = [
    vscode.workspace.workspaceFile,
    ...(vscode.workspace.workspaceFolders || []).map((folder) => folder.uri),
  ];
  for (const uri of uris) {
    if (
      uri?.scheme !== "vscode-remote" ||
      !uri.authority.startsWith("ssh-remote+")
    )
      continue;
    const value = uri.authority.slice("ssh-remote+".length);
    // Remote SSH can encode authorities as a hex JSON object.
    try {
      const decoded =
        /^7b[0-9a-f]+7d$/i.test(value) && value.length % 2 === 0
          ? JSON.parse(Buffer.from(value, "hex").toString("utf8"))?.hostName
          : decodeURIComponent(value);
      if (
        typeof decoded === "string" &&
        decoded &&
        !/[\x00-\x1f]/.test(decoded)
      )
        return decoded;
    } catch {
      /* Use the generic SSH label when no public URI identifies the host. */
    }
  }
}
