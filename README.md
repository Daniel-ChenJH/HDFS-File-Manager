# HDFS File Manager

<p>
  <img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-3d745a.svg">
  <a href="https://opensource.org/license/mit"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-4d637c.svg"></a>
  <a href="#zh-cn"><img alt="简体中文" src="https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-416b95.svg"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=daniel-chenjh.hdfs-file-manager"><img alt="Visual Studio Marketplace" src="https://img.shields.io/badge/VS%20Code-Marketplace-416b95.svg"></a>
  <a href="https://open-vsx.org/extension/daniel-chenjh/hdfs-file-manager"><img alt="Open VSX" src="https://img.shields.io/badge/Cursor-Open%20VSX-4d637c.svg"></a>
</p>

Add a WebHDFS or HttpFS connection to work with HDFS in VS Code or Cursor. Preview files in the editor and transfer them between HDFS, your computer and your SSH host.

## Getting started

1. Open **HDFS → Settings** from the activity bar, or run **HDFS: Settings** from the command palette.
2. Enter a name, the WebHDFS or HttpFS address (for example, `https://hdfs.example.org/webhdfs/v1`), your starting folder and authentication details.
3. Select **Save & open**, then confirm to start browsing.

Global settings save as you change them. The default language is **Auto**. A Chinese editor interface uses Simplified Chinese, and other editor languages use English.

## Browse, preview and transfer

- **Browse.** Double-click a folder row to enter it. Use the address bar, breadcrumbs or **Up** to navigate. Filter by name within the current folder, choose the page size in the footer, or star files and folders to revisit them from **Favorites**.
- **Preview.** Click a file row, or open it in a separate preview tab. Text, JSON, JSONL, CSV, TSV, logs and code are shown as text, with search, line numbers, word wrap and an encoding selector. **JSON indent** applies two-space indentation to the view. Images and PDFs open inline, and PDFs scroll continuously.
- **Download and upload.** Use the row actions, or select checkboxes to download a batch. Folder transfers are recursive and preserve the folder structure and empty folders. In Remote SSH, choose which computer to save to or upload from. The download defaults to the SSH host, and you can change it in **Settings**.
- **Resolve conflicts.** When a batch download or upload finds an existing file, choose **Keep both**, **Skip** or **Replace**. **Skip** leaves the existing file alone. Transfer totals count files only.
- **Manage.** Create folders, rename or permanently delete items if your HDFS permissions allow it. Turn on **Read only** in connection settings to disable those actions and uploads. To change a file's contents, download it, edit your copy and upload it with **Replace**.
- **Track.** Open **Transfers** to see progress, cancel a job, retry failed items, copy the destination path or open its location. Click outside the panel to close it. Closing the panel leaves transfers running.

Text preview reads the first 1 MiB by default, adjustable up to 4 MiB. PNG, JPEG, GIF, WebP, BMP and PDF default to 20 MiB, adjustable up to 50 MiB. Download the original if the format is unsupported or the media exceeds the preview limit. Transfers stream independently of the preview limits.

Supports anonymous access, a WebHDFS username, Basic/Bearer gateway credentials and existing delegation tokens. Interactive Kerberos sign-in, recursive search and permission editing are outside the current feature set. Credentials use the editor's secure storage. The extension collects no telemetry.

## Remote SSH

Connect to your SSH host from the editor. In that window, open **Extensions**, find **HDFS File Manager**, and select **Install in SSH: <host>**. Then add your HDFS connection from **HDFS → Settings** in that window. The SSH host must be able to reach the HDFS API and any DataNodes it redirects to.

**HDFS File Manager Local Transfer** adds your computer as an upload or download location in SSH windows. If you only see the SSH host, install Local Transfer on your computer and reload the remote window.

## Compatibility

Requires VS Code 1.109+ or a compatible Cursor desktop version. Local and Remote SSH workflows have been tested on macOS and Windows 11.

<a name="zh-cn"></a>

<h2 id="zh-cn">简体中文</h2>

### 开始使用

1. 点击活动栏 **HDFS → 设置**。
2. 填写名称、WebHDFS 或 HttpFS 地址（例如 `https://hdfs.example.org/webhdfs/v1`）、起始目录和认证信息。
3. 点击 **保存并打开**，确认后进入目录。

全局设置修改后自动保存。语言默认选 **Auto**，编辑器使用中文时显示简体中文，其余显示英文。

### 常用操作

- **浏览与收藏**。双击文件夹整行进入，使用地址栏、面包屑或「上级」跳转。筛选只查当前目录。行尾点星收藏，再点取消。
- **预览**。单击文件整行，支持在侧边或新标签页查看。文本支持查找、行号、自动换行和编码切换。JSON 缩进只改变显示，PDF 可连续滚动。文本默认读前 1 MiB，最高 4 MiB；图片和 PDF 默认 20 MiB，最高 50 MiB。
- **传输**。勾选多行可批量下载。上传和下载文件夹都会递归保留目录结构和空目录。Remote SSH 下可选本机或远端，下载默认位置在设置中修改。遇到同名文件时可保留两者、跳过或替换。传输统计只计文件。
- **管理**。支持新建目录、重命名和永久删除，操作受 HDFS 权限限制。开启「仅只读」可禁止上传和管理操作。要修改文件内容，可下载后编辑，再上传并选择「替换」。
- **记录**。在「传输」查看进度、重试失败项、复制路径或打开位置。点击面板外即可关闭，传输继续。

### Remote SSH

先在编辑器中连上 SSH 主机。在远程窗口的「扩展」面板里找到 **HDFS File Manager**，点击 **安装到 SSH: 主机名**。然后在同一窗口打开 **HDFS → 设置**，添加 HDFS 连接。SSH 主机需能访问 HDFS API 和重定向到的 DataNode。

**HDFS File Manager Local Transfer** 让你在 SSH 窗口中从本机上传或下载到本机。如果只看到 SSH 主机，可以在本机安装这个组件，再重新加载远程窗口。

### 兼容性

需要 VS Code 1.109 或以上版本，或兼容的 Cursor 桌面版。本机和 Remote SSH 流程均已在 macOS 和 Windows 11 上实测。

[Report an issue / 反馈问题](https://github.com/Daniel-ChenJH/HDFS-File-Manager/issues) · MIT license
