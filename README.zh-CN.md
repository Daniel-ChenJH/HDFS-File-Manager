# HDFS File Manager

<p>
  <img alt="版本 0.1.0" src="https://img.shields.io/badge/version-0.1.0-3d745a.svg">
  <a href="https://opensource.org/license/mit"><img alt="MIT 许可证" src="https://img.shields.io/badge/license-MIT-4d637c.svg"></a>
  <a href="README.md"><img alt="English README" src="https://img.shields.io/badge/README-English-416b95.svg"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=daniel-chenjh.hdfs-file-manager"><img alt="Visual Studio Marketplace" src="https://img.shields.io/badge/VS%20Code-Marketplace-416b95.svg"></a>
  <a href="https://open-vsx.org/extension/daniel-chenjh/hdfs-file-manager"><img alt="Open VSX" src="https://img.shields.io/badge/Cursor-Open%20VSX-4d637c.svg"></a>
</p>

添加 WebHDFS 或 HttpFS 连接，即可在 VS Code 或 Cursor 里访问 HDFS。文件可直接在编辑器里预览，也可以在 HDFS 与本机或 SSH 主机之间传输。

## 开始使用

1. 在活动栏点击 **HDFS → 设置**，或在命令面板运行 **HDFS: 设置**。
2. 填写名称、WebHDFS 或 HttpFS 地址（例如 `https://hdfs.example.org/webhdfs/v1`）、起始目录和认证信息。
3. 点击 **保存并打开**，确认后进入目录。

全局设置修改后自动保存。语言默认选 **Auto**，编辑器使用中文时显示简体中文，其余显示英文。也可以手动指定 English 或简体中文。

## 浏览与预览

- 双击文件夹任意位置进入，使用地址栏、面包屑或「上级」跳转。文件名筛选只查当前目录。页脚可改为每页 10、20、50、100 或 200 项。
- 单击文件整行即可预览，也可以展开到独立标签页。支持文本、JSON、JSONL、CSV、TSV、日志、代码、PNG、JPEG、GIF、WebP、BMP 和 PDF。PDF 支持连续滚动。
- 文本可查找、切换行号和自动换行。JSON 缩进使用两个空格，再点恢复原文。编码可选 UTF-8、UTF-16LE/BE、GBK、ASCII 和 ISO-8859-1。
- 文本默认读前 1 MiB，可调至 4 MiB；图片和 PDF 默认 20 MiB，可调至 50 MiB。超限媒体和不支持预览的文件可以下载原件。
- 点击行尾星标收藏，再点取消。点开收藏中的项目可返回所在目录并定位到对应行。

## 文件管理与传输

- 从行尾下载单项，或勾选多行后批量下载。上传和下载文件夹都会递归保留目录结构和空目录，并跳过符号链接。文件通过流式传输，大小不受预览上限限制。
- Remote SSH 下，上传可选择本机或 SSH 主机作为来源，下载可保存到任一端。「设置 → 默认下载位置」可修改默认值，单次切换只影响当前下载。
- 上传和批量下载遇到同名文件时，可选「保留两者」「跳过」「替换」。跳过保留目标上的同名文件。传输统计只计文件。
- 支持新建目录、重命名和永久删除。操作受 HDFS 权限限制。开启连接的「仅只读」可禁止上传和管理操作。要修改文件内容，可下载后编辑，再上传并选择「替换」。
- 「传输」可看进度、取消、重试失败项、复制路径或打开保存位置。点面板外可关闭，进行中的任务继续运行。

支持匿名、WebHDFS 用户名、网关 Basic/Bearer 和已有 delegation token。暂不支持交互式 Kerberos 登录、递归搜索或权限修改。密码和令牌使用编辑器安全存储，插件不采集遥测。

## Remote SSH

先在编辑器中连上 SSH 主机。在远程窗口的「扩展」面板里找到 **HDFS File Manager**，点击 **安装到 SSH: 主机名**。然后在同一窗口打开 **HDFS → 设置**，添加 HDFS 连接。SSH 主机需能访问 HDFS API 和重定向到的 DataNode。

**HDFS File Manager Local Transfer** 让你在 SSH 窗口中从本机上传或下载到本机。如果只看到 SSH 主机，可以在本机安装这个组件，再重新加载远程窗口。

## 兼容性

需要 VS Code 1.109 或以上版本，或兼容的 Cursor 桌面版。本机和 Remote SSH 流程均已在 macOS 和 Windows 11 上实测。

[反馈问题](https://github.com/Daniel-ChenJH/HDFS-File-Manager/issues) · MIT 许可证
