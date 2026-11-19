import { readFileSync } from "node:fs";
const p = JSON.parse(readFileSync("package.json", "utf8"));
const companion = JSON.parse(readFileSync("companion/package.json", "utf8"));
const failures = [];
if (
  companion.publisher !== p.publisher ||
  companion.version !== p.version ||
  !p.extensionPack?.includes(`${companion.publisher}.${companion.name}`)
)
  failures.push("Align the companion publisher/version and extension pack ID.");
if (!p.publisher || /development|placeholder|example/.test(p.publisher))
  failures.push("Confirm a production publisher ID.");
for (const field of ["repository", "homepage", "bugs"])
  if (!p[field]) failures.push(`Set the reviewed public ${field} URL.`);
for (const field of ["repository", "homepage", "bugs"])
  if (!companion[field])
    failures.push(`Set the companion public ${field} URL.`);
const changelogVersion = /^## (\d+\.\d+\.\d+)(?:\s|$)/m.exec(
  readFileSync("CHANGELOG.md", "utf8"),
)?.[1];
if (changelogVersion !== p.version)
  failures.push("Align the changelog version with the main manifest.");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  "Identity metadata checks passed. Complete the manual acceptance and registry checks in docs/RELEASE.md.",
);
