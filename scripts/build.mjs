import { build } from "esbuild";
import { mkdir, copyFile, cp, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await mkdir("artifacts", { recursive: true });
await rm("companion/dist", { recursive: true, force: true });
await mkdir("companion/media", { recursive: true });
await copyFile("LICENSE", "companion/LICENSE");
await copyFile("media/icon.png", "companion/media/icon.png");
await build({
  entryPoints: ["src/local-transfer.ts"],
  outfile: "companion/dist/extension.js",
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["vscode"],
  minify: true,
});
await build({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["vscode"],
  sourcemap: false,
  minify: true,
});
await build({
  entryPoints: ["web/app.js", "web/preview.js", "web/text-view.js"],
  outdir: "dist/web",
  bundle: true,
  format: "esm",
  target: "es2022",
  external: ["./pdf.mjs", "./text-view.js"],
  minify: true,
});
await copyFile("web/style.css", "dist/web/style.css");
for (const file of ["pdf.mjs", "pdf.worker.mjs"])
  await build({
    // Include upstream polyfills for editors at our supported runtime floor.
    entryPoints: [`node_modules/pdfjs-dist/legacy/build/${file}`],
    outfile: `dist/web/${file}`,
    format: "esm",
    target: "es2022",
    minify: true,
    legalComments: "inline",
  });
await cp("node_modules/pdfjs-dist/cmaps", "dist/web/cmaps", {
  recursive: true,
});
await cp("node_modules/pdfjs-dist/standard_fonts", "dist/web/standard_fonts", {
  recursive: true,
});
await cp("node_modules/pdfjs-dist/iccs", "dist/web/iccs", { recursive: true });
await cp("node_modules/pdfjs-dist/wasm", "dist/web/wasm", {
  recursive: true,
  // PDF scripting is unused; ship only image decoders and their licenses.
  filter: (path) => !/quickjs/i.test(path),
});
await mkdir("dist/licenses", { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/LICENSE",
  "dist/licenses/pdfjs-LICENSE",
);
await copyFile("node_modules/undici/LICENSE", "dist/licenses/undici-LICENSE");
await copyFile("licenses/core-js-LICENSE", "dist/licenses/core-js-LICENSE");
for (const name of [
  "@codemirror/view",
  "@codemirror/state",
  "@codemirror/search",
  "@marijn/find-cluster-break",
  "crelt",
  "style-mod",
  "w3c-keyname",
])
  await copyFile(
    `node_modules/${name}/LICENSE`,
    `dist/licenses/${name.replaceAll("/", "-")}-LICENSE`,
  );
