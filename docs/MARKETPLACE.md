# Marketplace listing

Both 0.1.0 packages are ready for their new listing IDs. The Visual Studio Marketplace publisher and Open VSX namespace use `daniel-chenjh`. Open VSX namespace ownership is pending.

| Field | Value |
| --- | --- |
| Display name | HDFS File Manager |
| Package name | hdfs-file-manager |
| Initial version | 0.1.0 |
| Short description | A lightweight HDFS file browser for VS Code and Cursor. Add a connection to browse, preview, upload, and download files. |
| Categories | Other; Data Science |
| Keywords | hdfs, hadoop, webhdfs, httpfs, explorer |
| License | MIT, with bundled third-party notices |
| Icon | media/icon.png — original geometric folder |
| Overview | README.md includes a Simplified Chinese quick start; README.zh-CN.md is the standalone guide. |
| Repository | [Daniel-ChenJH/HDFS-File-Manager](https://github.com/Daniel-ChenJH/HDFS-File-Manager) |
| Support | [GitHub Issues](https://github.com/Daniel-ChenJH/HDFS-File-Manager/issues) |
| Publisher / namespace | `daniel-chenjh` |
| Extension ID | `daniel-chenjh.hdfs-file-manager` |

The overview includes setup, file management and the optional read-only connection mode, direct network routing, Remote SSH save location, supported authentication and boundaries. No telemetry or third-party preview service is included. Screenshots are optional for the first listing; private acceptance screenshots must never be uploaded.

The main extension lists **HDFS File Manager Local Transfer** (`daniel-chenjh.hdfs-file-manager-local`) in its extension pack. The companion adds local uploads and downloads in Remote SSH windows. When it is unavailable, transfers use the SSH host. Publish the companion before the main extension on each marketplace. Clean-profile installation and update checks cover both packages.

The release checklist covers package checksums, submission, and clean-profile installation in both editors. [Release guide](RELEASE.md)
