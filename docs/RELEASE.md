# Release HDFS File Manager

## 0.1.0 status

| Destination               | Ready to publish                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GitHub                    | Source and Issues are at `Daniel-ChenJH/HDFS-File-Manager`. Check the three-platform workflow before uploading.          |
| Visual Studio Marketplace | Submit two new listings. Upload Local Transfer first, then the main package.                                             |
| Open VSX                  | The namespace exists. After it is granted owner status, publish the Local Transfer package first, then the main package. |
| Cursor                    | Install and verify from Cursor after both Open VSX packages are public.                                                  |

The product name is **HDFS File Manager**, the publisher and namespace are `daniel-chenjh`, and the extension IDs are `daniel-chenjh.hdfs-file-manager` and `daniel-chenjh.hdfs-file-manager-local`. Both packages are version `0.1.0`. [Listing metadata](MARKETPLACE.md)

## 1. Verify the source and packages

Confirm that the current commit is on `main` and the Check workflow passes on macOS, Windows and Ubuntu. Keep generated bundles, VSIX files, private QA evidence and credentials out of Git. [Repository](https://github.com/Daniel-ChenJH/HDFS-File-Manager) · [Issues](https://github.com/Daniel-ChenJH/HDFS-File-Manager/issues) · [Actions](https://github.com/Daniel-ChenJH/HDFS-File-Manager/actions)

Use the reviewed packages already in `artifacts/`. From the project root on macOS, verify both hashes before uploading.

```sh
(cd artifacts && shasum -a 256 -c SHA256SUMS)
```

| File                                           | Use                                |
| ---------------------------------------------- | ---------------------------------- |
| `artifacts/hdfs-file-manager-0.1.0.vsix`       | Main extension for both registries |
| `artifacts/hdfs-file-manager-local-0.1.0.vsix` | Local Transfer for both registries |

For a future build, run `npm ci`, then `npm run release:check && npm run package && npm run audit:package`. Record the commit, SHA-256 values and contents of the resulting archives. Include the external private-marker file in the audit for a private QA workspace.

Local and Remote SSH workflows have been tested on macOS and Windows 11 in VS Code and Cursor. The Ubuntu desktop client still awaits native acceptance. The full `npm audit` remains part of Check. [Validation results](VALIDATION.md)

## 2. Publish to Visual Studio Marketplace

1. Sign in to the [Daniel-ChenJH publisher dashboard](https://marketplace.visualstudio.com/manage/publishers/daniel-chenjh).
2. Choose **New extension → Visual Studio Code** and upload `hdfs-file-manager-local-0.1.0.vsix`. Wait for verification and confirm that [HDFS File Manager Local Transfer 0.1.0](https://marketplace.visualstudio.com/items?itemName=daniel-chenjh.hdfs-file-manager-local) is publicly downloadable.
3. Choose **New extension → Visual Studio Code** again and upload `hdfs-file-manager-0.1.0.vsix`. Wait for verification and confirm that [HDFS File Manager 0.1.0](https://marketplace.visualstudio.com/items?itemName=daniel-chenjh.hdfs-file-manager) is publicly downloadable.
4. Create an empty VS Code Profile. In a local window, open **Extensions**, search `@id:daniel-chenjh.hdfs-file-manager`, and choose **Install**. Check the main version and whether **HDFS File Manager Local Transfer** was installed with it. In a separate clean test Profile, start with Remote SSH and choose **Install in SSH** on the main extension. Check whether the companion appears under **Local – Installed** after that single action. Confirm the main extension runs on the SSH host and can download a fictional file to the local machine.

The dashboard upload uses the signed-in publisher account. [Microsoft publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-an-extension)

The previously published `daniel-chenjh.hdfs-explorer-local` listing can coexist. Use the new Local Transfer package and a clean Profile to verify the new installation flow.

## 3. Publish to Open VSX

1. Sign in to GitHub as **Daniel-ChenJH** and open the [Claim namespace ownership form](https://github.com/EclipseFdn/open-vsx.org/issues/new?template=claim-namespace-ownership.yml). Enter `daniel-chenjh`, confirm the ownership and account-age statements if they apply, and select **Option 1 — VS Code Publisher with Repo**. In **Claim evidence**, link the [GitHub repository](https://github.com/Daniel-ChenJH/HDFS-File-Manager) and the [published Local Transfer extension](https://marketplace.visualstudio.com/items?itemName=daniel-chenjh.hdfs-file-manager-local). State that the repository is owned by your GitHub account. This request can start while Microsoft verifies the main package.
2. Wait for Open VSX to grant owner status. The namespace already exists, and the publisher agreement has been accepted. Owner status is required because the same identifiers are published on Microsoft Marketplace. [Open VSX namespace ownership](https://github.com/EclipseFdn/open-vsx.org/wiki/Managing-Namespaces#namespace-ownership)
3. Generate a fresh token from [Open VSX Access Tokens](https://open-vsx.org/user-settings/tokens). Paste it into the CLI's masked login prompt. From the project root, run the login command and publish Local Transfer.

```sh
npx --yes ovsx@1.4.0 login daniel-chenjh
npx --yes ovsx@1.4.0 publish artifacts/hdfs-file-manager-local-0.1.0.vsix
```

4. Check that [Local Transfer 0.1.0](https://open-vsx.org/extension/daniel-chenjh/hdfs-file-manager-local) is publicly downloadable, then publish the main VSIX and check its [Open VSX listing](https://open-vsx.org/extension/daniel-chenjh/hdfs-file-manager).

```sh
npx --yes ovsx@1.4.0 publish artifacts/hdfs-file-manager-0.1.0.vsix
```

[Open VSX publishing guide](https://github.com/EclipseFdn/open-vsx.org/wiki/Publishing-Extensions#publishing-with-the-ovsx-command)

## 4. Verify Cursor and future updates

Repeat both installation paths in separate clean Cursor Profiles, including the Remote SSH-first check for the companion under **Local – Installed**. Cursor uses a marketplace proxy and scans extensions separately, so verify availability inside Cursor after the Open VSX listings are live. [Cursor extension guide](https://cursor.com/help/customization/extensions)

Record the Git commit, published listing URLs and clean-profile installation results for both editors. Keep a test profile on 0.1.0 and verify automatic updates when the next real version is released. The first release verifies fresh installation. Update testing needs a later release.
