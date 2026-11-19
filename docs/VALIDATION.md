# HDFS File Manager 0.1.0 validation

## First-release extension IDs, 2026-11-19

- Rebuilt both 0.1.0 packages with the IDs `daniel-chenjh.hdfs-file-manager` and `daniel-chenjh.hdfs-file-manager-local`. The main package lists the new Local Transfer ID. The private cross-host commands use a separate namespace from the previously published companion.
- All 144 automated tests passed, including the cross-host transfer tests. Both new VSIX files installed in isolated macOS VS Code and Cursor directories alongside the earlier Local Transfer package. These were VSIX installs. Clean-profile installation and automatic Local Transfer installation from each marketplace still require verification after publication.

## GitHub release preparation, 2026-11-19

- Both VSIX manifests and shipped READMEs now link to the HDFS File Manager repository. The extension IDs and runtime code remain the same.
- The original Windows Actions run failed when two tests created local filenames containing `?`. Disk fixtures now use Windows-compatible names and directory junctions. The redirected HDFS fixture still includes `?` in its source path. All 144 tests passed locally after these changes.
- The full `npm audit` returned zero findings. The previously reported packaging-tool advisory was [withdrawn](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).

## macOS Remote SSH installation and transfer locations, 2026-11-18

- Installed only the main VSIX from isolated Remote SSH windows in VS Code 1.146.0 and Cursor 3.30.14. VS Code pulled the published Local Transfer package into the local test Profile. Cursor had the main package on the SSH host and no Local Transfer package on the Mac. The Local Transfer listing was unavailable through Open VSX during this run. Both registries still need a fresh-install check after publication.
- Made Local Transfer optional at runtime. With it absent, both editors opened the HDFS browser and showed only the SSH host for uploads, single-file downloads, and folder downloads. Both opened the remote file picker and saved a fixture file on the SSH host with bytes matching the source. With the companion installed locally, both editors showed both locations again. All of these transfer checks used a fictional fixture.
- All 144 automated tests passed, including the effective SSH download default when the saved preference points to an unavailable local companion.

## Package documentation refresh, 2026-11-18

Added installation instructions to both READMEs. The refreshed main VSIX changed only the two README entries. Every other ZIP entry, including the extension manifest and runtime bundles, matched the Windows-tested package byte for byte. The Local Transfer archive was retained. See the release artifact checksums in `artifacts/SHA256SUMS`.

## Windows 11 native desktop acceptance, 2026-11-18

- Tested Windows 11 build 26300 with VS Code 1.146.0 x64 and Cursor 3.30.14 x64. GPT-6.2 Sol (high) ran engineering checks, and GPT-6.1 Terra (max) exercised the native interfaces serially.
- Installed the same audited main and companion VSIX files in separate VS Code and Cursor QA profiles. Both editors used the Windows file and folder pickers for local single-file transfers. Round-trip SHA-256 matched, Copy path wrote the destination to the Windows clipboard, and Open location opened the expected folder in File Explorer.
- Both editors exercised Windows-local and SSH-host uploads and downloads from Remote SSH windows. Native picker selection, clipboard paths, Open location, and SHA-256 checks confirmed the correct host. SSH batch downloads to Windows preserved nested files and empty directories. A separate fictional fixture served all uploads and modifications.
- Both editors listed a real HDFS directory, previewed representative JSON and PDF files, and downloaded a PDF through the Windows folder picker. The downloaded bytes matched the source by SHA-256. The real connection was read-only throughout.
- Local QA covered WebHDFS in VS Code and HttpFS in Cursor, plus browsing, filtering, paging, favorites, directory operations, image and text preview, recursive transfer, and language and preview-limit settings. Windows runtime checks covered pagination fallback, Unicode paths, write rejection, streaming hashes, and preservation of an existing download after failure. The Mac source suite also passed all 142 tests.
- Cursor reconnected during the first larger PDF preview. A second six-page PDF passed preview, download, and byte verification after reconnecting. The first sample was not repeated.
- The Windows, WSL, and SSH test processes and temporary files were removed. The original VSIX archives stayed byte-identical throughout.

## Release name and settings, 2026-11-18

- All 142 automated tests passed. Coverage includes immediate field validation, queued preference writes, preserving connection drafts during language changes, Auto resolution for Chinese and other locales, and returning to the originating preview after saving its limit.
- A background Chromium session exercised the production webview with a fictional Remote SSH connection. Wide dark and narrow light layouts were inspected. The info tooltip, invalid value, language switching, and persistence of the preview limit and download destination were checked through the rendered controls.
- The final main VSIX installed through the VS Code and Cursor desktop CLIs in isolated local directories. The package display name is **HDFS File Manager**, the extension ID is `daniel-chenjh.hdfs-explorer`, and the version is `0.1.0`. The published companion's existing VSIX was retained byte-for-byte. Main VSIX SHA-256 `998baed4b20673b9eb6338ae1b256bfd9115086a5f703f8c82da6c5ad6370c9e`.
- This pass used fixture data and did not modify HDFS. Native Remote SSH interaction and installation of the main extension from a marketplace were not repeated for this build.

## Transfer counts and extension details, 2026-11-18

- Transfer totals count regular files. Directory creation and empty-folder preservation still run in both directions, and directory failures still appear in failure details. Historical tasks with mixed totals keep their status and byte count.
- Automated regression coverage includes an all-skipped recursive download, an empty-folder upload and download, recovery from directory and file failures, and transfer-panel dismissal. All 139 tests passed.
- On macOS, the isolated VS Code QA window dismissed Transfers when clicking the explorer outside the panel. Its installed extension details rendered the English guide and the Simplified Chinese section directly. Both local QA profiles and both SSH extension hosts received the development package. Current cluster verification only read metadata from the isolated QA directory.

## File management and preview UI review, 2026-11-18

The review covered selection and batch download, favorites, transfer history, and the text preview. Screenshots used fictional data in the production webview UI fixture. Dark, light and narrow layouts were inspected, including a 365-pixel-wide preview. Raw screenshots remain outside the repository.

- Multi-selection keeps the row highlight in sync with its checkbox. The whole-list selection action appears after the current page is selected. The Remote SSH batch dialog shows the item count and sample names before choosing a destination.
- Favorites were checked for navigation back to the chosen item, stable keyboard focus, and the ability to remove an entry from the list. Transfer history was checked for independent scrolling, a fixed header, and **Copy path** before **Open location**.
- Text search uses a compact toolbar with match navigation and a no-match state. The search query stays active when switching between the original JSON and two-space indentation. Escape dismisses search without closing the preview. Line numbers are separated from the text and can be toggled.
- Native Cursor on macOS: used the QA profile to verify search, indentation, Escape, two selected rows, opening and cancelling the native batch destination picker, favorites navigation and transfer history. This pass used fictional files and did not repeat the full four-environment native acceptance below.
- The build and both VSIX packages passed 138 tests, formatting and the package privacy audit.

## File management development validation, 2026-11-18

Native scenario review covered four editor environments.

- Automated checks: 137 tests passed, TypeScript and build passed. New integration coverage includes encoded two-step upload, interim HTTP 100 Continue, native WebHDFS batch listing, read-only mutation guards, recursive disk upload/download, empty folders, symlink skipping, byte equality, all three conflict policies, cancellation cleanup/continuation, permission correction with failed-item retry, refreshed source metadata on retry, full-disk stopping/continuation, cross-host error serialization, Shift selection/focus and bookmark ordering.
- Preview regression: five isolated rounds passed, with 95 completed previews, 50 cancelled previews, 55 total cancellations and 15 byte-verified downloads. The legacy-encoding case now verifies an encoding correction followed by successful GBK decoding.
- Streaming write/read stress: ten rounds of 128 MiB upload, download/hash verification and upload cancellation. Post-round heap stayed around 11–12 MiB, array buffers around 0.3 MiB, and open connections returned to zero each round. Across the repeated runs, RSS rose during warm-up within roughly 170–203 MiB; the retained heap stayed stable. These figures include the fictional streaming server in the same process and are not whole-editor measurements.
- A separate 2 GiB upload/download round matched SHA-256, completed cancellation, and ended with zero open connections (about 198 MiB RSS / 11 MiB heap in the latest run). No whole-file source/destination buffer was used by the stress fixture.
- Actual HDFS: dedicated disposable directory, no writes to business files. Verified folder creation, eight fictional text/data/code/PDF files uploaded and read back byte-for-byte, renaming, batch listing and deletion of a disposable subdirectory. Private paths, addresses and receipts remain outside the project.
- Fixed two actual write-transport incompatibilities: native DataNode interim HTTP 100 Continue responses and the editor proxy wrapper around high-level HTTP requests. Dedicated Node HTTP(S) ClientRequest instances handle both; native cluster uploads and independent-request comparisons passed after the corrections.
- Native review also found and corrected conflict choices hidden behind a modal, literal null text, misleading local transfer labels, progress updates replacing the Cancel button, and byte counts inflated by cancelled attempts. Cancelled upload/download and failed-download retries have exact successful-byte regression assertions. Progress updates no longer rewrite the durable task history; checkpoints remain at file boundaries and state changes.
- Dependency review: `npm audit --omit=dev` reports zero findings. Full `npm audit` reports four affected development dependencies along the packaging-tool chain (`vsce → tinyglobby/fdir → picomatch`), all from the same [unpatched upstream glob ReDoS advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). This tool processes the project-owned packaging patterns; it is not extension runtime code. The affected modules are absent from both built bundles and VSIX file inventories. This remains an upstream development-tooling limitation; no forced tool downgrade was applied.
- Package privacy: working files, tracked/index blobs, build output and actual VSIX contents passed the private-marker and allowlist audit. No publication was attempted.

Native acceptance uses VS Code 1.146.0 and Cursor 3.30.14 on macOS, with separate QA Profiles and Linux Remote SSH extension hosts. Existing work windows and configuration are preserved.

| Environment | Observed native workflows |
| --- | --- |
| VS Code, local | Fictional directory upload and recursive download, empty directories, exact byte/hash checks, all three conflict policies, paging and Shift selection, bookmark ordering. A separate read-only real connection listed files and previewed PDF through an existing accessible endpoint. |
| Cursor, local | Fictional JSON upload, preview and download with matching source/server/target hashes, Open location reaching the actual Finder folder, cancellation, failed-item details and retry. The follow-up also verified recursive downloads, nested empty directories and all three conflict choices. A separate read-only real connection listed files and previewed PDF. |
| VS Code, Remote SSH | Actual HDFS isolated-directory create/upload/rename/delete, both local and SSH upload origins and download destinations with byte/hash verification. Controlled slow/error fixture: cancellation, preview retry, partial batch failure and failed-only retry. |
| Cursor, Remote SSH | Actual HDFS isolated-directory create/upload/rename/delete, both upload origins and download destinations with byte/hash verification. PDF continuous scrolling, JSON search/line numbers/lossless display formatting, bookmarks, read-only action visibility and corrected-source retry. |

All real business files remained read-only. Controlled automated tests covered unreachable endpoints, permission denial and disk-full behavior. This pass covered macOS clients and a Linux SSH host. See the Windows 11 section for the later desktop acceptance and the release guide for registry verification.

Post-fix native rechecks passed: VS Code Remote SSH and Cursor local cancelled a 64 MiB download, retried the same task from zero and completed with exactly 64 MiB in the UI and the target file, matching SHA-256. The SSH case also retained keyboard focus on Cancel across progress updates and cancelled with Space. Both editors opened the correct settings page from a read-only connection tree menu.

Final packages were installed and reloaded in both local QA Profiles and both SSH extension hosts. Actual main/web bundles matched the reviewed package in all four environments; local helper bundles matched on both editors. Package manifests also matched after excluding editor-generated installation metadata. Main VSIX SHA-256: `e92fcb555d7169f283ac4054e868d6a429c5a4e9f7990d2b3d8eae4c27011986`; local companion: `771ffe52de81f3a614252a0c9a0fb82faf418b534e15ba048123368aaee82b08`.

The three initial fictional fixture services were stopped, and their listener ports were verified closed. Pre-existing connectivity services remained running. Private evidence remains outside the repository. Current package lists and checksums are regenerated in the ignored artifacts directory.

Native follow-up: Cursor downloaded a fictional folder tree via the system folder picker. Three files matched source bytes and both empty directories were retained. Repeated downloads into the same destination preserved originals and created byte-identical numbered copies with Keep both, preserved edited local bytes with Skip (three skipped, zero bytes written), and restored source bytes with Replace. No business data was changed. The batch destination picker now leaves its confirmation label to the system, consistent with single-file downloads and upload source selection. After rebuilding, both macOS editors displayed the Chinese native Open, Cancel and New Folder buttons. Cursor's file-source picker was also confirmed in the native UI. The updated package passed all 137 automated tests and was installed in the four QA windows.


## 2026-11-18 file management interface follow-up

The upload sheet now shows the destination, applicable source choices and selected items. The editor prompts for conflicts after finding a matching file. Transfer records show the correct destination host and provide Copy path before Open location. Active upload journals stay out of the interrupted-upload recovery action. A folder refresh preserves the transfer panel.

The updated package passed 137 tests, including a clipboard assertion for the actual recorded directory, upload picker cancellation and stale replies, and upload/download conflict choices. In Cursor's local QA profile, native checks covered selecting and uploading a fictional CSV, byte equality, the refreshed folder and retained transfer panel, Copy path feedback, folder creation and renaming, and cancelling the delete confirmation. VS Code local and Cursor Remote SSH also opened the updated upload sheet; the SSH sheet showed both source hosts without starting a transfer. Both editors' local and SSH QA windows were updated. No business HDFS data was modified.

## 2026-11-17 task-flow review and recovery follow-up

**120 automated tests passed**, including new regressions for cancellation restoring the previous directory, retained host-side paging, independent settings drafts, download keyboard focus, stale filename tooltip timers and connection-scoped errors/paths. Type checking, build, formatting and whitespace checks passed.

This review followed concrete tasks: enter a folder, interrupt a request, recover from an error, change connection settings, inspect a file and choose a download destination. It found and fixed:

- Network-error recovery still linked to the removed diagnostics control. It now opens and focuses the service address.
- Cancelled navigation discarded the previous rows. The last successful listing, filter, page and scroll now remain available after cancelling a replacement request; paging still works. This adds no directory-history cache or recursive reads.
- Adding a connection could discard unrelated global-preference edits. Both adding and switching connections now preserve those drafts; only connection edits need a discard decision.
- Home/End toggled download targets instead of selecting the first/last target, and the asynchronous folder reply could steal keyboard focus. Both behaviors now follow the selected target and preserve focus.
- A delayed filename tooltip could interrupt a menu. Opening a popup cancels pending tooltip timers, and filename hover cannot replace an open listbox. Filename tooltips inside file-information dialogs also use the dialog's top layer.
- Escape did not cancel a connection check. It now uses the same cancellation flow as the Cancel button, while result dialogs still require confirmation.
- Removing a failed connection could carry its error and pending path into the remaining connection. Both stale values are cleared when the connection context changes.

Native acceptance ran in both **VS Code Remote SSH** and **Cursor Remote SSH** QA windows. An isolated fictional WebHDFS fixture provided stalled and interrupted requests. In both editors, cancellation restored rows and paging; network recovery focused the URL field; download Home/End kept focus after location lookup; preference values survived Add connection; Escape cancelled a check while retaining input. The failed-connection removal was repeated after the final fix: the real connection showed its own starting path without the old error. Temporary fixture connections were removed and the original global preferences were retained.

Real HDFS acceptance remained read-only. Both editors opened an authorized PDF and advanced through the continuous scroller using Page Down. Both also previewed the authorized JSON sample and downloaded it through the actual SSH-to-Mac flow into an isolated local directory. The two downloaded files matched a fresh independent HDFS read in byte count and SHA-256; private files and the checksum receipt remain outside this project. The real file-row context menu offered preview, editor-tab preview, download, copy path/name and file information. Closing file information with Escape returned focus to its original button in both editors. No HDFS source data was modified. A hidden browser supplemented the native task-flow checks, and is not counted as real HDFS acceptance.

Existing work windows were preserved and temporary fixtures were cleaned up. Package privacy and installed-bundle identity checks passed.

## 2026-11-17 acceptance feedback: settings, encoding and filenames

Final automated checks: **113 tests passed**, type checking, production build, formatting and whitespace checks. New regressions cover the independent automatic-encoding label, named decoding failures, checked connection saves, cancellation before persistence, stale replies, last-connection identity reset and welcome-view disposal. Cancelling keeps the form locked until the host acknowledges the abort, so an immediate retry cannot overtake an unfinished check.

Both editor versions below were reread. Native acceptance used the existing isolated QA profiles on the Linux SSH host and new, separate **HDFS Explorer Onboarding QA** profiles on the Mac. Real HDFS operations were limited to authorized directory listings, metadata and read-only file reads. Local onboarding and cancellation used fictional WebHDFS samples. No business data or test screenshots were copied into this project.

| Workflow | VS Code | Cursor |
| --- | --- | --- |
| Wrong API suffix → result modal → confirmation → correct input | Passed on Remote SSH; incorrect address was not persisted | Passed on Remote SSH; incorrect address was not persisted |
| Save & open checks directory plus actual file read → success → confirmation → browse | Passed with real HDFS | Passed with real HDFS |
| Remote SSH alias in header | Matches the editor connection alias | Matches the editor connection alias |
| Download target label and nonexistent destination | Alias shown; nonexistent SSH folder showed the requested correction text | Alias shown; nonexistent Mac folder showed the requested correction text |
| Manual encoding → automatic option label → automatic recovery | Automatic option remained UTF-8 while UTF-16BE was selected; recovery passed | Same native workflow passed |
| Full filename tooltips in inline and separate preview | Passed with real files and fictional long filenames | Passed with real files and fictional long filenames |
| Empty sidebar → centered SVG and Add connection → Settings | Passed in an empty local profile | Passed in an empty local profile |
| Cancel connection check → retain draft → correct path → retry | Passed with an isolated stalled request | Passed with an isolated stalled request |
| Add connection → remove last connection → empty sidebar and fresh form | Passed after fixing a disposed-view error | Passed after the same lifecycle fix |

The last-connection lifecycle defect was found during native cleanup: a disposed welcome view interrupted the post-removal UI update. The provider now clears disposed views, and selection identity is reset after removal so another connection can be created. The full add/remove flow was repeated in both editors after the fix. Temporary fictional connections were removed; existing work windows and real connection settings were preserved.

Visual checks included themed removal pills, primary Confirm buttons, direct timeout controls, red encoding-error styling and a modal result with one confirmation action. A hidden browser supplemented the native checks for long-filename layout and encoding options. Browser fixtures are not counted as real HDFS acceptance.

Privacy review checks working files, Git index blobs, build outputs and every member of both VSIX archives. It uses private markers stored outside the repository and private-address patterns. Package inventories and checksums are generated from the release archives. The release guide tracks public registry verification.

## 2026-11-17 controls and text encoding follow-up

Automated checks: **109 tests passed**, with type checking and production build. Added coverage includes page-size persistence and item-position preservation, keyboard selection, settings return context, themed numeric controls and limit help, text decoding, incomplete multibyte characters, encoding correction, and wrap/focus preservation when changing encodings. Manual encoding errors retain the selector so the user can correct the choice.

The preview now supports UTF-8, UTF-16LE/BE, GBK, ASCII and ISO-8859-1. Automatic mode recognizes a UTF-16 byte-order mark and otherwise reads UTF-8. Other encodings, including UTF-16 without a byte-order mark, can be selected directly in the preview. ASCII rejects non-ASCII bytes; ISO-8859-1 preserves Latin-1 byte semantics. Encoding selection only changes the preview; it does not convert the source or the original download.

Native acceptance used the same isolated **HDFS Explorer QA** profiles and the editor versions listed below. Both extensions ran on the Linux SSH host. Real HDFS checks remained read-only; encoding samples were fictional files served by an isolated temporary WebHDFS fixture on that host.

| Workflow | VS Code Remote SSH | Cursor Remote SSH |
| --- | --- | --- |
| Real directory paging | Default 50; keyboard selection of 100 and 200; page count updated correctly | 50 → 20 → next page → 10 preserved the current item interval |
| Settings return | Back arrow returned to the file list | Back arrow retained the current page |
| Settings controls | Limit tooltip, Escape, increment/decrement, auth menu; original limits restored | Connection and language controls exercised in light theme |
| UTF-16 | LE/BE byte-order marks recognized; BOM-less sample corrected with the selector | Covered automatically |
| ASCII | Explicit selection rendered the sample | Wrong selection on GBK data showed correction and recovered |
| GBK and ISO-8859-1 | Covered automatically | Chinese GBK and Latin-1 accented text rendered correctly |
| Inline → editor tab, then encoding correction | Covered automatically | Latin-1 retained on expansion; wrong encoding and correction reused the same tab |
| Wrap state and encoding focus | Covered automatically | Wrap off survived encoding correction; focus returned to the encoding selector |

A hidden browser supplemented the native checks with dark, light and high-contrast themes and a 540-pixel-wide viewport. Dropdown menus stayed outside their own label/trigger, the footer menu opened upward when needed, and the settings limit explanations were available on hover/focus/click. High-contrast keyboard highlighting exposed a missing border fallback; that was fixed and visually rechecked. Preview formats remain visible, and connection diagnostics now sit inside the collapsed Network section.

Temporary encoding connections were removed after acceptance. Original connections, 50 items per page, 1 MiB text / 20 MiB media limits and existing work windows were preserved. The final packages were installed in both QA profiles and both SSH hosts; extension and webview bundle hashes match the final build. A real UTF-8 JSON preview was rechecked after the final VS Code reload. Source/build/VSIX privacy checks, formatting and `git diff --check` passed; artifact inventories and checksums were regenerated from the actual packages. No production HDFS data was changed. This pass did not repeat the real-file download checksum and preview stress runs recorded below; those remain separately dated evidence.

## 2026-11-17 usability follow-up

Automated checks: 98 tests passed, type checking and production build passed. Tests cover preview limit and authentication correction returning to the original file, standalone preview settings, diagnosis cancellation and stale results, cached-listing reuse, one-byte reads, empty-folder handling, contextual error recovery, download destinations and existing network/rendering regressions.

Editor versions reread:
- VS Code 1.146.0, commit 69047191fc427f2f92828279aae1d90d8eeda7ab, macOS arm64.
- Cursor 3.30.14, commit 5f54c8173e5552412beb40702adac16275677fa0, macOS arm64.

Native acceptance used the existing isolated **HDFS Explorer QA** profiles, with each editor's workspace extension running on a Linux SSH host. Existing work windows and profiles were preserved. Both QA windows reloaded after the packages were installed. Installed webview bundle checksums matched that pass's build.

| Workflow | VS Code Remote SSH | Cursor Remote SSH |
| --- | --- | --- |
| Real authorized directory listing and whole-row file selection | Passed, Chinese / dark theme | Passed, English / light theme |
| Settings → Connection diagnostics, with no routine success banner | Passed | Passed |
| Preview → adjust limit → apply → original file, retaining the directory filter | PDF limit raised from 1 to 20 MiB; actual PDF rendered | Text limit raised from 1 to 2 MiB; actual JSON prefix rendered |
| Standalone preview → settings → original file | Covered automatically | Passed natively, including restoring the original text limit |
| Missing path recovery within the authorized directory | Parent-folder action restored the listing | Edit-path action corrected the path and restored the listing |
| Original file downloaded to the Mac | Real PDF, approximately 20 MiB | Real JSON, approximately 27 MiB; initiated from the native row context menu |
| Destination correction | Remote folder picker also exercised | Nonexistent Mac folder showed an inline error, focused the folder field and retained filename/target; correction succeeded |
| Remote default and save location | SSH target selected by default; a small file saved to the isolated remote directory | SSH target selected by default before switching to Mac |
| Connection menu and reconnect | Menu available | Disconnect and reconnect passed |

Both Mac downloads were checked against fresh, independent read-only HDFS reads: byte counts and SHA-256 matched. The small remote download was also compared byte for byte against a fresh source read. Destination filenames, paths, raw checksums and source identities are retained only in the external private validation directory. Download progress names the selected destination and actual path; no success toast is added.

The final build was rechecked for the simplified over-limit preview: a single **Download original** action plus **Adjust preview limit**, with no redundant download icon or nonfunctional expand action. The PDF and text return workflows were repeated after the last UI-only change. Preview preferences were restored to 1 MiB text / 20 MiB media, and SSH remained the default download destination.

A hidden browser using fictional fixtures supplemented native acceptance for empty-folder diagnosis, focused settings, error actions and layout. It exposed a literal `null` in the diagnosis region; the rendering fix and a regression assertion are included. Browser fixture interactions are not counted as native editor or real HDFS acceptance.

Final checks: 98 tests passed; type checking, production build, formatting and `git diff --check` passed. The two actual VSIX files passed source/build/package privacy and allowlist checks. Package hashes and ZIP file lists are generated in `artifacts/`.

## Evidence and boundaries

Raw acceptance evidence remains outside the repository.

Private endpoints, paths, files, credentials and raw screenshots stay outside the project. Business HDFS validation stays read-only. The file-management pass writes only to its dedicated disposable test directory, and local fixture data is fictional.

The two packages use the confirmed `daniel-chenjh` identity. Registry installation, dependency installation and upgrades remain unverified. Open VSX namespace ownership is pending.
