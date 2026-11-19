# Third-party notices

The extension implementation and geometric icon are original.

PDF rendering bundles Mozilla PDF.js (`pdfjs-dist` 6.5.438), licensed under Apache License 2.0. Its complete license is included at `dist/licenses/pdfjs-LICENSE`. Copyright notices in the PDF.js distribution are preserved. Source: https://github.com/mozilla/pdf.js

PDF.js character maps retain their upstream notices. Bundled standard fonts retain `dist/web/standard_fonts/LICENSE_FOXIT` (PDFium BSD-style license) and `LICENSE_LIBERATION` (SIL Open Font License). These files are included in the VSIX.

PDF.js's compatibility build includes core-js 3.51.0 (MIT); its complete upstream license is included at `dist/licenses/core-js-LICENSE`. Source: https://github.com/zloirock/core-js/tree/v3.51.0 . Bundled JBIG2, OpenJPEG and QCMS image decoders retain their upstream licenses in `dist/web/wasm/` (PDFium BSD-style, Apache 2.0, BSD-style and MIT notices, as applicable). The bundled ICC profile retains its CC0 license in `dist/web/iccs/LICENSE`. PDF scripting and its QuickJS runtime are not shipped.

Direct HTTP uses bundled Undici 8.12.4 (MIT), including its upstream notices, at `dist/licenses/undici-LICENSE`. Source: https://github.com/nodejs/undici . The dependency is locked in package-lock.json. It prevents editor-level proxy overrides from routing remote cluster requests through a local proxy.

Text previews bundle CodeMirror's view 6.43.15 and state 6.7.6 (MIT), with the read-only viewport, selection, wrapping, line numbers and search features. CodeMirror search (MIT) retains its license at `dist/licenses/@codemirror-search-LICENSE`. Source: https://codemirror.net/ . Their MIT licenses are included at `dist/licenses/@codemirror-view-LICENSE` and `dist/licenses/@codemirror-state-LICENSE`. Bundled MIT dependencies `@marijn/find-cluster-break`, `crelt`, `style-mod` and `w3c-keyname` each retain their complete license in `dist/licenses/`. Exact versions are recorded in package-lock.json.

TypeScript, esbuild, tsx, jsdom and vsce are build/test tools; their runtime code is not included in the extension host bundle. Node built-ins and the editor's stable public extension API provide filesystem access. No native add-on or Java runtime is shipped.
