// Resolve a release tag of the form `<package-name>@<version>` to a workspace
// package directory, asserting that the tag version matches the manifest.
//
// Used by .github/workflows/publish.yml. Prints a JSON summary and, when
// GITHUB_OUTPUT is set, writes `name`, `version`, and `dir` outputs.
//
// Example:
//   node scripts/resolve-package.mjs "@mohan-cao/pi-jev-response-router@0.2.0"

import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(repoRoot, "packages");

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) {
  console.error("usage: node scripts/resolve-package.mjs <package-name>@<version>");
  process.exit(1);
}

// Split on the last `@` so scoped names (`@scope/pkg@1.0.0`) parse correctly.
const separator = tag.lastIndexOf("@");
if (separator <= 0 || separator === tag.length - 1) {
  console.error(
    `::error::tag "${tag}" is not in <package-name>@<version> form (e.g. @mohan-cao/pi-jev-response-router@0.2.0)`,
  );
  process.exit(1);
}

const name = tag.slice(0, separator);
const version = tag.slice(separator + 1);

const manifests = existsSync(packagesDir)
  ? readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(packagesDir, entry.name, "package.json"))
      .filter((manifestPath) => existsSync(manifestPath))
  : [];

let match;
for (const manifestPath of manifests) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name === name) {
    match = { manifest, manifestPath };
    break;
  }
}

if (!match) {
  const known = manifests
    .map((manifestPath) => JSON.parse(readFileSync(manifestPath, "utf8")).name)
    .join(", ");
  console.error(`::error::no workspace package named "${name}" (known: ${known || "none"})`);
  process.exit(1);
}

if (match.manifest.version !== version) {
  console.error(
    `::error::tag ${tag} does not match ${name} version ${match.manifest.version}`,
  );
  process.exit(1);
}

const dir = dirname(match.manifestPath).slice(repoRoot.length + 1).replaceAll("\\", "/");
const outputs = { name, version, dir };

if (process.env.GITHUB_OUTPUT) {
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

console.log(JSON.stringify(outputs, null, 2));
