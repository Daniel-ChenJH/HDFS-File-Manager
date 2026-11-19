// Shared by the file browser and both preview surfaces.
export function recoveryActions(code, file = false) {
  const retry = { action: "retry", label: "retry" };
  const parent = { action: "parent", label: file ? "refreshFolder" : "up" };
  const settings = (focus, label = "connectionSettings") => ({
    action: "settings",
    label,
    focus,
  });
  switch (code) {
    case "missing":
      return file
        ? [parent]
        : [parent, { action: "editPath", label: "editPath" }];
    case "limit":
      return file ? [parent] : [{ action: "editPath", label: "editPath" }];
    case "path":
      return [{ action: "editPath", label: "editPath" }];
    case "secret":
    case "unauthorized":
      return [settings("auth", "editAuthentication")];
    case "forbidden":
      return [parent, settings("auth", "editAuthentication")];
    case "timeout":
      return [retry, settings("timeout", "network")];
    case "network":
      return [retry, settings("endpoint")];
    case "dns":
    case "refused":
    case "loopbackRefused":
    case "endpoint":
    case "response":
    case "tls":
    case "redirect":
    case "downgrade":
      return [settings("endpoint"), retry];
    default:
      return [retry];
  }
}
