#!/usr/bin/env node
/**
 * Version-discipline checks for the workspace packages.
 *
 * Four checks, because they fail independently:
 *
 *   step     the local version has not gone backwards, and has advanced by at
 *            most one component (0.4.2 -> 0.4.3, not -> 0.4.5)
 *   content  what `pack` produces for a version matches what npm published at
 *            that same version — a version identifies a fixed content
 *   audit    replays the published version history against the `step` rule, so
 *            the rule is validated against releases that already happened
 *   build    `pnpm -r build` succeeds (only with --build)
 *
 * `content` is the check this was written after: a package whose source changed
 * while its version stayed put, so `^0.1.0` kept resolving to a stale artifact.
 *
 * The package list and its order come from the workspace graph, not a
 * hand-maintained array — `pnpm -r run` is topologically sorted by default, and
 * `workspace:` is self-identifying, so the edges need no extra bookkeeping.
 *
 * The other two do **not** catch that class, which is worth stating plainly:
 *
 *   - `step` is satisfied by never bumping, so it was green on the commit that
 *     broke the release;
 *   - a monorepo build is satisfied by internal coherence, and the failure was
 *     workspace-vs-published, not workspace-vs-workspace.
 *
 * Usage:
 *   node scripts/check-versions.mjs              # step + content, exit 1 on failure
 *   node scripts/check-versions.mjs --audit       # also replay published history
 *   node scripts/check-versions.mjs --build       # also pnpm -r build
 *   node scripts/check-versions.mjs --no-content  # skip the network-heavy check
 *
 * Exits non-zero on any failure. Safe to run on push to main, and again inside
 * the publish job — publishing is irreversible, so the check belongs on both
 * sides of the tag.
 *
 * Expects a clean `dist`. A fresh CI checkout is clean by construction; on a
 * long-lived local tree run `pnpm -r clean && pnpm -r build` first, or stale
 * compiled output from a moved file shows up as a content difference.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const results = [];
let failed = false;

function fail(check, message) {
  failed = true;
  results.push({ check, ok: false, message });
  process.stdout.write(`  \u2716 ${check}: ${message}\n`);
}

function pass(check, message) {
  results.push({ check, ok: true, message });
  process.stdout.write(`  \u2714 ${check}: ${message}\n`);
}

function skip(check, message) {
  results.push({ check, ok: true, skipped: true, message });
  process.stdout.write(`  \u2013 ${check}: ${message}\n`);
}

/**
 * Quote for the shell that `shell: true` selects — cmd.exe on Windows. That
 * means backslashes must be left alone: `JSON.stringify` would double them and
 * cmd would pass the doubled form through literally.
 */
function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function sh(command, options = {}) {
  try {
    return execFileSync(command, {
      shell: true,
      encoding: "utf8",
      stdio: "pipe",
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    }).trim();
  } catch (error) {
    // Surface the tail of stderr: a bare "command failed" hides the reason.
    const stderr = String(error.stderr ?? "")
      .trim()
      .split("\n")
      .slice(-6)
      .join("\n      ");
    throw new Error(`command failed: ${command}${stderr ? `\n      ${stderr}` : ""}`);
  }
}

function trySh(command) {
  try {
    return sh(command);
  } catch {
    return undefined;
  }
}

/** Wrapped so malformed input names its source instead of surfacing a bare SyntaxError. */
function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`could not parse JSON from ${label}: ${error.message}`);
  }
}

function readJson(path) {
  return parseJson(readFileSync(path, "utf8"), path);
}

function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function sameVersion(a, b) {
  const left = parse(a);
  const right = parse(b);
  return Boolean(left && right && left.every((value, index) => value === right[index]));
}

/**
 * `at most one component advanced, and the lower ones reset`.
 * Returns undefined when the move is legal, otherwise why it is not.
 */
function stepProblem(from, to) {
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return `cannot compare "${from}" with "${to}"`;

  const [major, minor, patch] = b;
  if (major !== a[0]) {
    return major === a[0] + 1 && minor === 0 && patch === 0
      ? undefined
      : `major jumped from ${from} to ${to} (expected ${a[0] + 1}.0.0)`;
  }
  if (minor !== a[1]) {
    return minor === a[1] + 1 && patch === 0
      ? undefined
      : `minor jumped from ${from} to ${to} (expected ${a[0]}.${a[1] + 1}.0)`;
  }
  if (patch !== a[2]) {
    return patch === a[2] + 1 ? undefined : `patch jumped from ${from} to ${to}`;
  }
  return undefined;
}

function publishedVersions(name) {
  const raw = trySh(`npm view ${name} versions --json`);
  if (!raw) return [];
  const parsed = parseJson(raw, `npm view ${name} versions`);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function latestVersion(name) {
  return trySh(`npm view ${name} dist-tags.latest`);
}

// ---------------------------------------------------------------- tar reading

function readString(block, start, length) {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

/** 512-byte tar headers: name 0..100, size 124..136, typeflag 156, prefix 345..500. */
function readOctets(block, start, length) {
  return Number.parseInt(readString(block, start, length).trim() || "0", 8);
}

/**
 * Text files get their line endings normalised before hashing: a Windows
 * working tree has CRLF while a Linux CI checkout has LF, and that difference
 * is environmental rather than a content change. Sniffed for NUL rather than
 * keyed off extensions, so extensionless files like LICENSE are covered.
 */
function normalizeBody(body) {
  if (body.subarray(0, 8000).includes(0)) return body;
  return Buffer.from(body.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}

/**
 * sha256 per file, straight from the tarball.
 *
 * Deliberately not shelling out to `tar`: on a Windows host that resolves to
 * bsdtar, which reads the `C:` in an absolute path as a remote host name.
 * Reading in-process keeps this portable and dependency-free.
 *
 * Handles ustar prefixes and GNU long-name entries. Other special entries
 * (pax headers, directories, symlinks) are skipped.
 */
function tarballHashes(tarball) {
  const archive = gunzipSync(readFileSync(tarball));
  const hashes = new Map();
  let offset = 0;
  let longName;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = readOctets(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    offset += 512;

    const body = archive.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    if (type === "L") {
      longName = body.toString("utf8").replace(/\0+$/, "");
      continue;
    }

    const path = (longName ?? (prefix ? `${prefix}/${name}` : name)).replace(/^package\//, "");
    longName = undefined;
    if (!path || type !== "0") continue;

    hashes.set(path, createHash("sha256").update(normalizeBody(body)).digest("hex"));
  }

  return hashes;
}

function diffHashes(a, b) {
  const only = (left, right) => [...left.keys()].filter((key) => !right.has(key)).sort();
  const changed = [...a.keys()].filter((key) => b.has(key) && a.get(key) !== b.get(key)).sort();
  return { added: only(a, b), removed: only(b, a), changed };
}

function findTarball(dir, spec) {
  const tarball = readdirSync(dir).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error(`packing produced no tarball for ${spec}`);
  return join(dir, tarball);
}

/**
 * The local side must be packed with pnpm, not npm: npm leaves the `workspace:`
 * protocol in the published manifest verbatim, which is the 0.4.0 bug. pnpm
 * rewrites it to the real range, and is what the publish workflow uses.
 */
function packLocal(dir, packageDir) {
  // `--pack-destination` does not create the directory, and a missing one exits
  // non-zero with nothing useful on stderr.
  mkdirSync(dir, { recursive: true });
  sh(`pnpm --dir ${quote(packageDir)} pack --pack-destination ${quote(dir)}`);
  return findTarball(dir, packageDir);
}

function packPublished(dir, name, version, cwd) {
  mkdirSync(dir, { recursive: true });
  sh(`npm pack ${name}@${version} --pack-destination ${quote(dir)}`, { cwd });
  return findTarball(dir, `${name}@${version}`);
}

// -------------------------------------------------------------------- checks

function checkStep(version, name) {
  const latest = latestVersion(name);
  if (!latest) {
    skip("step", "package is not on npm yet");
    return;
  }
  if (sameVersion(version, latest)) {
    // Same version is allowed here; `content` is what decides whether it is.
    pass("step", `matches published latest ${latest}`);
    return;
  }

  const problem = stepProblem(latest, version);
  if (problem) fail("step", problem);
  else pass("step", `${latest} -> ${version}`);
}

function checkContent(dir, name, version, root) {
  if (!publishedVersions(name).includes(version)) {
    skip("content", `${version} is not published yet — nothing to compare against`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "ver-check-"));
  try {
    const local = tarballHashes(packLocal(join(work, "local"), resolve(dir)));
    const published = tarballHashes(packPublished(join(work, "published"), name, version, root));
    const { added, removed, changed } = diffHashes(local, published);

    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
      pass("content", `${local.size} files match what npm published at ${version}`);
      return;
    }

    const parts = [];
    if (added.length) parts.push(`${added.length} added`);
    if (removed.length) parts.push(`${removed.length} removed`);
    if (changed.length) parts.push(`${changed.length} changed`);
    const sample = [...added, ...removed, ...changed].slice(0, 4).join(", ");
    fail(
      "content",
      `${version} is already published but its content differs (${parts.join(", ")}): ${sample}\n` +
        `      a published version cannot change — bump it`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The workspace packages, from pnpm rather than a hand-maintained list, with
 * the root excluded.
 */
function workspacePackages(root) {
  const raw = sh(`pnpm list -r --depth -1 --json`, { cwd: root });
  const entries = parseJson(raw, "pnpm list -r --depth -1 --json");
  return entries
    .filter((entry) => resolve(entry.path) !== root)
    .map((entry) => ({
      name: entry.name,
      version: entry.version,
      dir: resolve(entry.path),
      manifest: readJson(join(entry.path, "package.json")),
    }));
}

/**
 * `workspace:` is self-identifying, so the graph edges need no pnpm call: a
 * dependency written as `workspace:^` is by definition a workspace edge.
 */
function workspaceDeps(manifest, names) {
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, spec]) => String(spec).startsWith("workspace:"))
    .map(([dependency]) => dependency)
    .filter((dependency) => names.has(dependency));
}

/**
 * Dependencies first — the same order pnpm itself uses, since `pnpm -r run` is
 * topologically sorted by default. This replaces the hand-written "publish the
 * classifier first" note with the graph it was describing.
 */
function topoOrder(packages) {
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  const ordered = [];
  const done = new Set();

  const visit = (name, stack) => {
    if (done.has(name)) return;
    if (stack.has(name)) throw new Error(`workspace dependency cycle through ${name}`);
    stack.add(name);
    for (const dependency of workspaceDeps(byName.get(name).manifest, new Set(byName.keys()))) {
      visit(dependency, stack);
    }
    stack.delete(name);
    done.add(name);
    ordered.push(byName.get(name));
  };

  for (const entry of packages) visit(entry.name, new Set());
  return ordered;
}

function checkPackage(dir, { content, root }) {
  const { name, version } = readJson(join(dir, "package.json"));
  process.stdout.write(`\n${name} @ ${version}\n`);
  checkStep(version, name);
  if (content) checkContent(dir, name, version, root);
  else skip("content", "disabled");
}

function audit(name) {
  const versions = publishedVersions(name);
  if (versions.length < 2) {
    skip("audit", `${name}: fewer than two published versions`);
    return;
  }

  const violations = [];
  for (let i = 1; i < versions.length; i += 1) {
    const problem = stepProblem(versions[i - 1], versions[i]);
    if (problem) violations.push(problem);
  }

  if (violations.length === 0) {
    pass("audit", `${name}: ${versions.length} published versions all advance by one step`);
  } else {
    fail("audit", `${name}: ${violations.join("; ")}`);
  }
}

// ---------------------------------------------------------------------- main

const argv = process.argv.slice(2);
const content = !argv.includes("--no-content");
const root = resolve(import.meta.dirname, "..");

process.stdout.write("Version discipline\n");

let packages = [];
try {
  packages = topoOrder(workspacePackages(root));
  process.stdout.write(`\nworkspace order (from the graph): ${packages.map((p) => p.name).join(" -> ")}\n`);
} catch (error) {
  fail("workspace", error.message);
}

for (const entry of packages) {
  try {
    checkPackage(entry.dir, { content, root });
  } catch (error) {
    // A checker that dies on the first surprise cannot report the rest.
    fail("package", `${entry.name}: ${error.message}`);
  }
}

if (argv.includes("--audit")) {
  process.stdout.write("\nPublished history\n");
  for (const entry of packages) audit(entry.name);
}

if (argv.includes("--build")) {
  process.stdout.write("\nBuild\n");
  try {
    sh(`pnpm --dir ${quote(root)} -r build`, { stdio: "inherit" });
    pass("build", "all workspace packages build");
  } catch (error) {
    fail("build", error.message);
  }
}

const failedCount = results.filter((result) => !result.ok).length;
process.stdout.write(`\n${results.length - failedCount}/${results.length} checks passed\n`);
process.exit(failed ? 1 : 0);
