import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
const vsce = resolve("node_modules/@vscode/vsce/vsce");
for (const cwd of ["companion", "."]) {
  const manifest = JSON.parse(
    readFileSync(resolve(cwd, "package.json"), "utf8"),
  );
  execFileSync(
    process.execPath,
    [
      vsce,
      "package",
      "--no-dependencies",
      "--allow-missing-repository",
      "--out",
      resolve("artifacts", `${manifest.name}-${manifest.version}.vsix`),
    ],
    { cwd, stdio: "inherit" },
  );
}
