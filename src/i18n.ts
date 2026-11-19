import { HdfsError, Language } from "./model";
const errors: Record<string, [string, string]> = {
  connectionChanged: [
    "This connection changed. Start a new transfer with the current connection.",
    "连接已更改，请使用当前连接重新发起传输。",
  ],
  selectionLimit: [
    "This selection is too large. Select a folder or fewer items.",
    "所选项目过多，请选择目录或减少项目数量。",
  ],
  diskSpace: [
    "Not enough disk space. Choose another destination or free some space.",
    "磁盘空间不足，请更换目标位置或释放空间。",
  ],
  localPermission: [
    "Cannot access this file or folder. Choose another location.",
    "无法访问此文件或文件夹，请选择其他位置。",
  ],
  sourceMissing: [
    "The source file no longer exists. Select it again.",
    "源文件已不存在，请重新选择。",
  ],
  writeUnsupported: [
    "This service does not support this operation.",
    "此服务不支持该操作。",
  ],
  sourceLink: [
    "Choose the actual file or folder. Symbolic links are not uploaded.",
    "请选择实际文件或目录，暂不上传符号链接。",
  ],
  sourceSelection: [
    "Select the same source files or folders to continue.",
    "请选择原来的源文件或文件夹以继续。",
  ],
  readOnly: ["This connection is read only.", "此连接已开启仅只读。"],
  exists: ["An item with this name already exists.", "已存在同名项目。"],
  operationFailed: [
    "The server could not complete this operation. Refresh and try again.",
    "操作未完成，请刷新后重试。",
  ],
  depth: [
    "This folder is too deeply nested. Select a smaller subfolder.",
    "目录层级过深，请选择其中的子目录。",
  ],
  manifestLimit: [
    "This transfer has too many items. Select a smaller folder and retry.",
    "传输项目过多，请选择较小的子目录重试。",
  ],
  busy: [
    "There are too many active tasks. Wait for a task to finish.",
    "当前任务较多，请等待部分任务完成。",
  ],
  destination: [
    "The destination does not exist. Choose Browse to select another folder.",
    "目标路径不存在。点击浏览以选择其他路径。",
  ],
  filename: [
    "Enter a valid filename for the selected computer.",
    "请输入所选计算机支持的文件名。",
  ],
  destinationHost: [
    "Choose a folder on the selected computer.",
    "请选择当前所选主机上的文件夹。",
  ],
  destinationChanged: [
    "The destination changed. Check the filename and try again.",
    "目标文件已发生变化，请检查文件名后重试。",
  ],
  localTransfer: [
    "Install or enable HDFS File Manager Local Transfer on your computer, then reload this window.",
    "请在本机安装或启用 HDFS File Manager Local Transfer，再重新加载此窗口。",
  ],
  endpoint: [
    "Enter an HTTP(S) API base URL without credentials, query or fragment.",
    "请输入 HTTP(S) API 基础地址，不含凭据、查询参数或片段。",
  ],
  endpointPrefix: [
    "The service address is incomplete. Check the ending, usually /webhdfs/v1.",
    "服务地址不完整。请检查地址末尾，通常应为 /webhdfs/v1。",
  ],
  path: [
    "Enter an absolute HDFS path starting with /.",
    "请输入以 / 开头的 HDFS 绝对路径。",
  ],
  name: ["Enter a connection name.", "请输入连接名称。"],
  username: ["Enter a valid username.", "请输入有效的用户名。"],
  timeoutSetting: [
    "Timeout must be between 2 and 300 seconds.",
    "超时时间须为 2 至 300 秒。",
  ],
  preferences: [
    "Choose a supported language and preview limit.",
    "请选择支持的语言和预览大小。",
  ],
  auth: ["Select a supported authentication method.", "请选择支持的认证方式。"],
  secret: [
    "Enter the password or token in Settings.",
    "请在设置中填写密码或令牌。",
  ],
  unauthorized: [
    "Authentication failed. Update credentials in Settings, then retry.",
    "认证失败。请在设置中修改凭据后重试。",
  ],
  forbidden: [
    "Access denied for this path. Check the selected identity in Settings or choose a permitted path.",
    "当前路径无访问权限。请在设置中检查身份，或选择有权访问的路径。",
  ],
  requestDenied: [
    "The service refused this request. Check the service address and authentication details.",
    "服务拒绝了请求。请检查服务地址和身份认证信息。",
  ],
  connectionMissing: [
    "The service or starting folder could not be found. Check the service address and starting path.",
    "找不到服务或起始目录。请检查服务地址和起始路径。",
  ],
  missing: [
    "This path no longer exists. Refresh the parent folder or enter another path.",
    "路径不存在。请刷新上级目录或输入其他路径。",
  ],
  dns: [
    "This host cannot resolve the server name. Check the connection address.",
    "当前主机无法解析服务地址。请检查连接地址。",
  ],
  network: [
    "The connection was interrupted or the service is unreachable from this host.",
    "连接已中断，或当前主机无法访问服务。",
  ],
  loopbackRefused: [
    "No service is listening at this local address. Check the connection address or SSH forwarding.",
    "此本地地址没有服务监听。请检查连接地址或 SSH 转发。",
  ],
  refused: [
    "The host refused the connection. Check the address and port in Settings, then retry.",
    "主机拒绝连接。请在设置中检查地址和端口后重试。",
  ],
  timeout: [
    "Request timed out. Retry or adjust the timeout in Settings.",
    "请求超时。请重试，或在设置中调整超时时间。",
  ],
  tls: [
    "Certificate verification failed. Use an endpoint trusted by the extension host.",
    "证书验证失败。请使用扩展宿主信任的服务地址。",
  ],
  redirect: [
    "The server returned an invalid or looping redirect.",
    "服务返回了无效或循环重定向。",
  ],
  downgrade: [
    "The server redirected HTTPS to insecure HTTP. Use a consistently configured endpoint.",
    "服务将 HTTPS 重定向到了 HTTP。请使用协议配置一致的入口。",
  ],
  response: [
    "The server did not return a valid WebHDFS response. Check the API base URL in Settings.",
    "服务未返回有效的 WebHDFS 响应。请检查设置中的 API 基础地址。",
  ],
  limit: [
    "This response exceeds the supported size. Open a smaller directory.",
    "响应超过大小限制。请打开较小的目录。",
  ],
  cancelled: ["Cancelled.", "已取消。"],
  changed: [
    "The file changed while reading. Refresh and retry.",
    "读取期间文件发生变化。请刷新后重试。",
  ],
  destinationBusy: [
    "A download to this destination is already running. Choose another file or wait for it to finish.",
    "此位置已有下载任务。请选择其他文件，或等待下载完成。",
  ],
  save: [
    "Could not save the file. Choose a writable destination with enough free space.",
    "无法保存文件。请选择有写入权限且空间充足的位置。",
  ],
  unknown: ["The operation failed. Try again.", "操作未能完成，请重试。"],
};
export function tr(language: Language, en: string, zh: string): string {
  return language === "zh-CN" ? zh : en;
}
export function errorText(error: unknown, language: Language): string {
  const filesystem: Record<string, string> = {
    ENOSPC: "diskSpace",
    EDQUOT: "diskSpace",
    EACCES: "localPermission",
    EPERM: "localPermission",
    ENOENT: "sourceMissing",
    EMFILE: "busy",
  };
  const code =
    error instanceof HdfsError
      ? error.code
      : filesystem[(error as any)?.code] || "unknown";
  const pair = errors[code];
  let message = pair
    ? pair[language === "zh-CN" ? 1 : 0]
    : tr(
        language,
        "Server request failed (" +
          code.replace(/[^a-z0-9]/gi, "") +
          "). Retry or check the endpoint.",
        "服务请求失败（" +
          code.replace(/[^a-z0-9]/gi, "") +
          "）。请重试或检查地址。",
      );
  if (error instanceof HdfsError && error.stage === "datanode")
    message = tr(language, "File reading: ", "读取文件：") + message;
  return message;
}
