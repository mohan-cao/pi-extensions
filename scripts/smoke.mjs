#!/usr/bin/env node
/**
 * End-to-end smoke test for the Jev Pi extension.
 *
 * Packs both packages, installs them into a throwaway Pi agent directory, drives
 * a real `pi --mode rpc` process, and asserts on what the extension actually
 * prints. Exits 0 on pass, 1 on fail. Nothing outside the temp directory is
 * touched — in particular your real ~/.pi and the workspace node_modules.
 *
 * Usage (from the repo root):
 *
 *   node scripts/smoke.mjs                 # auto-detect the sandbox
 *   node scripts/smoke.mjs --runtime=wsl   # force a backend
 *   node scripts/smoke.mjs --keep          # keep the sandbox for inspection
 *   node scripts/smoke.mjs --verbose       # stream the child's stderr
 *   node scripts/smoke.mjs --no-build      # skip the build (packing `dist` as-is)
 *
 * Sandbox backends, cheapest first:
 *
 *   docker | podman   a real container (node:<major>-slim), work dir bind-mounted
 *   wsl               the existing WSL distro + a node unpacked into its cache
 *   none              the host, in temp directories, with a clean agent dir
 *
 * `none` is not theatre: a fresh `PI_CODING_AGENT_DIR` and a fresh npm prefix
 * give the same isolation that matters here (packed artifact, no stale prefs, no
 * workspace resolution). The container backends add OS isolation on top.
 *
 * Deliberately no credentials and no model calls: every assertion is about
 * install, load, and command behaviour, so this is safe and deterministic as a
 * pre-push gate. Exercising the classification hooks needs a live key and is a
 * separate concern.
 *
 * Wrapper form (driver) prepares a work dir and re-invokes this same file inside
 * the sandbox with `--payload <dir>`, so there is one file to maintain and the
 * payload depends only on node builtins + npm.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROUTER_PACKAGE = "@mohan-cao/pi-jev-response-router";
const ROUTER_DIR = "packages/pi-jev-response-router";
const CLASSIFIER_DIR = "packages/jev-classifier";
const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const PI_ENTRY = "dist/bundle/cli.js";

// ---------------------------------------------------------------- assertions

class SmokeFailure extends Error {}

function assert(condition, message) {
  if (!condition) throw new SmokeFailure(message);
}

function assertMatch(value, pattern, message) {
  assert(typeof value === "string" && pattern.test(value), `${message} (got ${JSON.stringify(value)})`);
}

// -------------------------------------------------------------------- shell

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

/**
 * Run a command line. Passing the whole line as a string (rather than an args
 * array) avoids Node's DEP0190 warning about `shell: true` alongside args;
 * interpolated values go through `quote()`.
 */
function sh(command, options = {}) {
  return execFileSync(command, {
    shell: true,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    cwd: options.cwd,
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function shProbe(command) {
  try {
    return sh(command, { stdio: "pipe" }).trim();
  } catch {
    return undefined;
  }
}

function which(name) {
  return shProbe(process.platform === "win32" ? `where ${name}` : `command -v ${name}`);
}

/** Reads and parses, naming the file when it is missing or malformed. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SmokeFailure(`could not read JSON from ${path}: ${error.message}`);
  }
}

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Pi's JS entry point. Spawning this with the current node avoids both the
 * Windows `.cmd` shim (which needs a shell) and Node's DEP0190 warning about
 * `shell: true` plus an args array.
 */
function piEntry(nodeModulesDir) {
  const entry = join(nodeModulesDir, ...PI_PACKAGE.split("/"), ...PI_ENTRY.split("/"));
  assert(existsSync(entry), `pi entry point not found at ${entry}`);
  return entry;
}

// ------------------------------------------------------------------ reporting

const results = [];

function report(name, ok, detail) {
  results.push({ name, ok, detail });
  const glyph = ok ? "\u2714" : "\u2716";
  const suffix = ok || !detail ? "" : `\n      ${detail}`;
  process.stdout.write(`  ${glyph} ${name}${suffix}\n`);
}

async function check(name, run) {
  try {
    await run();
    report(name, true);
    return true;
  } catch (error) {
    report(name, false, error instanceof Error ? error.message : String(error));
    return false;
  }
}

// ------------------------------------------------------------------ runtimes

const NODE_MAJOR = Number(process.versions.node.split(".")[0]);

function toWslPath(winPath) {
  // C:\Users\me\x -> /mnt/c/Users/me/x
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
  assert(match, `cannot translate ${winPath} to a WSL path`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

/**
 * Unpacks a node into the WSL distro's cache. Written to a file and executed,
 * rather than passed inline: a multi-line `bash -lc` argument does not survive
 * cmd.exe on Windows. No root, no distro changes. The tarball ships npm too,
 * which the payload needs for the install step.
 */
const WSL_BOOTSTRAP = `set -e
CACHE="$HOME/.cache/pi-smoke"
mkdir -p "$CACHE" && cd "$CACHE"
if [ ! -x node/bin/node ]; then
  DIR="https://nodejs.org/dist/latest-v22.x"
  FILE=$(curl -fsSL "$DIR/" | grep -o "node-v[0-9.]*-linux-__ARCH__\\.tar\\.xz" | head -1)
  curl -fsSL -o n.tar.xz "$DIR/$FILE"
  mkdir -p node
  tar -xJf n.tar.xz -C node --strip-components=1
  rm -f n.tar.xz
fi
node/bin/node -v
`;

/** A node bin directory inside WSL, or `undefined` when the distro already has one. */
function ensureWslNode(workDir, verbose) {
  if (shProbe(`wsl -e bash -lc "command -v node"`)) return undefined;

  const arch = shProbe(`wsl -e bash -lc "uname -m"`) === "aarch64" ? "arm64" : "x64";
  const script = join(workDir, "wsl-bootstrap.sh");
  writeFileSync(script, WSL_BOOTSTRAP.replace("__ARCH__", arch));

  const output = sh(`wsl -e bash -lc ${quote(`bash ${quote(toWslPath(script))}`)}`, {
    stdio: verbose ? "inherit" : "pipe",
  });
  const version = String(output).trim().split("\n").pop();
  assertMatch(version, /^v\d+/, "could not bootstrap node inside WSL");
  return "$HOME/.cache/pi-smoke/node/bin";
}

function resolveRuntime(requested, workDir, verbose) {
  const have = (name) => Boolean(which(name));

  if (requested !== "auto") {
    if (requested === "none") return { kind: "none" };
    if (requested === "wsl") {
      assert(have("wsl"), "wsl not found on PATH");
      return { kind: "wsl", path: ensureWslNode(workDir, verbose) };
    }
    assert(have(requested), `${requested} not found on PATH`);
    return { kind: "docker", engine: requested };
  }

  for (const engine of ["docker", "podman"]) {
    if (have(engine)) return { kind: "docker", engine };
  }

  if (have("wsl")) {
    try {
      return { kind: "wsl", path: ensureWslNode(workDir, verbose) };
    } catch {
      // Distro present but unusable (no curl, no network). Fall back to the host.
    }
  }

  return { kind: "none" };
}

function runInSandbox(runtime, workDir, options) {
  const { verbose } = options;
  const inside = (path) => (runtime.kind === "wsl" ? toWslPath(path) : path);
  const args = [
    `--payload ${quote(inside(workDir))}`,
    options.piVersion ? `--pi-version=${options.piVersion}` : "",
    // A host pi binary is only meaningful for the host backend; a Windows path
    // would be nonsense inside a container or a WSL distro.
    options.piBin && runtime.kind === "none" ? `--pi-bin=${quote(options.piBin)}` : "",
    verbose ? "--verbose" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (runtime.kind === "none") {
    return sh(`${quote(process.execPath)} ${quote(join(workDir, "payload.mjs"))} ${args}`, {
      stdio: "inherit",
    });
  }

  if (runtime.kind === "docker") {
    // `--mount` is used over `-v` because it handles Windows source paths.
    const command = [
      runtime.engine,
      "run --rm",
      `--mount ${quote(`type=bind,source=${workDir},target=/smoke`)}`,
      "-w /smoke",
      `node:${NODE_MAJOR}-slim`,
      `sh -lc ${quote(`node /smoke/payload.mjs ${args}`)}`,
    ].join(" ");
    return sh(command, { stdio: "inherit" });
  }

  const nodeEnv = runtime.path ? `export PATH=${runtime.path}:$PATH; ` : "";
  const command = `wsl -e bash -lc "cd ${inside(workDir)} && ${nodeEnv}node payload.mjs ${args}"`;
  return sh(command, { stdio: "inherit" });
}

// ------------------------------------------------------------------- payload

const SMOKE_MODELS = {
  // A closed port: nothing here is ever called, we only need getAvailable() to
  // be non-empty so the model picker opens deterministically without credentials.
  providers: {
    smoke: {
      baseUrl: "http://127.0.0.1:9/v1",
      api: "openai-completions",
      apiKey: "smoke",
      models: [{ id: "smoke-build" }, { id: "smoke-design" }, { id: "smoke-general" }],
    },
  },
};

class PiRpc {
  #child;
  #records = [];
  #waiters = [];
  #seq = 0;
  #buffer = "";
  #stderr = "";
  #exit;

  constructor(bin, args, { env, cwd, verbose }) {
    this.#child = spawn(process.execPath, [bin, ...args], { env, cwd });
    this.selectResponse = null;

    this.#child.stdout.on("data", (chunk) => this.#ingest(chunk.toString()));
    this.#child.stderr.on("data", (chunk) => {
      this.#stderr += chunk.toString();
      if (verbose) process.stderr.write(`    [pi] ${chunk}`);
    });
    this.#exit = new Promise((done) => this.#child.on("exit", (code) => done(code ?? -1)));
  }

  /** LF-only framing, as the protocol requires (readline also splits on U+2028/29). */
  #ingest(chunk) {
    this.#buffer += chunk;
    let index;
    while ((index = this.#buffer.indexOf("\n")) !== -1) {
      const line = this.#buffer.slice(0, index).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line.trim()) continue;

      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue; // Not a protocol record (a stray log line); stdout is otherwise reserved.
      }
      this.#records.push(record);
      this.#handle(record);
    }
  }

  #handle(record) {
    if (record.type === "extension_ui_request" && record.method === "select") {
      const value = this.selectResponse ? this.selectResponse(record) : record.options[0];
      // An explicit `cancelled` record: JSON.stringify would drop `value: undefined`.
      this.send(
        value === undefined
          ? { type: "extension_ui_response", id: record.id, cancelled: true }
          : { type: "extension_ui_response", id: record.id, value },
      );
    }
    for (const waiter of [...this.#waiters]) {
      if (record === waiter.record) {
        this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(record);
      }
    }
    this.#pump();
  }

  #pump() {
      for (const waiter of [...this.#waiters]) {
        const found = this.#records.slice(waiter.from).find(waiter.predicate);
        if (found === undefined) continue;
        this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(found);
      }
  }

  send(record) {
    this.#child.stdin.write(`${JSON.stringify(record)}\n`);
  }

  mark() {
    return this.#records.length;
  }

  waitFor(predicate, label, from = 0, timeoutMs = 20_000) {
    const found = this.#records.slice(from).find(predicate);
    if (found !== undefined) return Promise.resolve(found);

    return new Promise((resolve_, reject) => {
      const waiter = { predicate, from, resolve: resolve_, record: undefined };
      waiter.timer = setTimeout(() => {
        this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
        reject(new SmokeFailure(`timed out waiting for ${label}\n      stderr: ${this.#stderr.trim().slice(-600)}`));
      }, timeoutMs);
      this.#waiters.push(waiter);
    });
  }

  /** Send a slash command and wait for its own response record. */
  async command(message) {
    const id = `req-${++this.#seq}`;
    this.send({ id, type: "prompt", message });
    const response = await this.waitFor(
      (record) => record.type === "response" && record.id === id,
      `response to ${message}`,
    );
    assert(response.success !== false, `${message} was rejected: ${response.error ?? "unknown error"}`);
    return response;
  }

  /** Run a command and wait for the notify it produces. */
  async notify(message, pattern) {
    const from = this.mark();
    await this.command(message);
    const record = await this.waitFor(
      (r) => r.type === "extension_ui_request" && r.method === "notify" && pattern.test(r.message),
      `a notify matching ${pattern} from ${message}`,
      from,
    );
    return record.message;
  }

  notifies() {
    return this.#records
      .filter((r) => r.type === "extension_ui_request" && r.method === "notify")
      .map((r) => r.message);
  }

  async shutdown() {
    this.#child.stdin.end();
    return this.#exit;
  }

  tail() {
    return this.#stderr.trim().slice(-600);
  }

  kill() {
    this.#child.kill();
  }
}

function installPi(sandbox, version, verbose) {
  const prefix = join(sandbox, "pi");
  mkdirSync(prefix, { recursive: true });
  const spec = version ? `${PI_PACKAGE}@${version}` : PI_PACKAGE;
  sh(`npm install --no-audit --no-fund --loglevel=error --prefix ${quote(prefix)} ${quote(spec)}`, {
    stdio: verbose ? "inherit" : "pipe",
  });

  return piEntry(join(prefix, "node_modules"));
}

async function payload(workDir, options) {
  const { verbose } = options;
  const sandbox = mkdtempSync(join(tmpdir(), "pi-smoke-"));
  const agentDir = join(sandbox, "agent");
  const cwd = join(sandbox, "cwd");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });

  const tarballs = readdirSync(workDir).filter((name) => name.endsWith(".tgz"));
  const classifier = tarballs.find((name) => name.includes("jev-classifier"));
  const router = tarballs.find((name) => name.includes("pi-jev-response-router"));
  assert(classifier && router, `expected both tarballs in ${workDir}, found: ${tarballs.join(", ")}`);

  process.stdout.write(`  sandbox: ${sandbox}\n`);

  // Install the local tarballs into the agent's npm dir — the same place
  // `pi install npm:<pkg>` would put them, so the layout under test is real.
  const npmDir = join(agentDir, "npm");
  mkdirSync(npmDir, { recursive: true });
  writeFileSync(
    join(npmDir, "package.json"),
    `${JSON.stringify({ name: "pi-smoke-agent", private: true }, null, 2)}\n`,
  );
  await check("both packages install into the agent npm dir", () => {
    sh(
      `npm install --no-audit --no-fund --loglevel=error --prefix ${quote(npmDir)} ` +
        `${quote(join(workDir, classifier))} ${quote(join(workDir, router))}`,
      { stdio: verbose ? "inherit" : "pipe" },
    );
    const installed = join(npmDir, "node_modules", ...ROUTER_PACKAGE.split("/"));
    assert(existsSync(join(installed, "package.json")), `${ROUTER_PACKAGE} missing after install`);
    // The generated package.json is what a second `pi install` would have produced.
    const manifest = readJson(join(installed, "package.json"));
    assert(
      !JSON.stringify(manifest.dependencies ?? {}).includes("workspace:"),
      "packed manifest still contains a workspace: protocol",
    );
  });

  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ packages: [`npm:${ROUTER_PACKAGE}`] }, null, 2)}\n`,
  );
  writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(SMOKE_MODELS, null, 2)}\n`);

  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    // Keep the extension's own writes inside the sandbox.
    HOME: sandbox,
    USERPROFILE: sandbox,
  };
  delete env.PI_JEV_PHASE_BUILD_MODEL;
  delete env.PI_JEV_PHASE_DESIGN_MODEL;
  delete env.PI_JEV_PHASE_GENERAL_MODEL;

  let piBin = options.piBin;
  if (!piBin) {
    const installed = await check("pi installs from npm", () => {
      piBin = installPi(sandbox, options.piVersion, verbose);
    });
    if (!installed) return finish(sandbox, options);
  }

  const pi = new PiRpc(
    piBin,
    ["--mode", "rpc", "--no-session", "--no-approve", "--no-context-files"],
    { env, cwd, verbose },
  );

  try {
    await check("the extension is registered as /jev-router", async () => {
      pi.send({ id: "commands", type: "get_commands" });
      const response = await pi.waitFor(
        (r) => r.type === "response" && r.command === "get_commands" && r.success !== false,
        "get_commands response",
      );
      const command = response.data.commands.find((c) => c.name === "jev-router");
      assert(command, "/jev-router is not registered — the extension did not load");
      assert(command.source === "extension", `expected an extension command, got source=${command.source}`);
      // The description is derived from the command table, so this also proves the
      // table itself loaded rather than a stale build.
      assertMatch(command.description ?? "", /status/, "command description is missing verbs");
      assertMatch(command.description ?? "", /route <phase>/, "command description is missing `route`");
    });

    await check("help lists the router commands", async () => {
      const message = await pi.notify("/jev-router help", /\/jev-router status/);
      assertMatch(message, /\/jev-router route <phase> \[model\]/, "help is missing the route command");
    });

    await check("status reports the router as on, with no routes", async () => {
      const message = await pi.notify("/jev-router status", /Jev router: on/);
      assertMatch(message, /phaseRoutes=none/, "status should report no routes");
      assertMatch(message, /currentModel=/, "status should report the running model");
    });

    await check("a route can be set by model id", async () => {
      await pi.notify("/jev-router route build smoke-build", /Jev build route set to smoke-build/);
      await pi.notify("/jev-router route general smoke-general", /Jev general route set to smoke-general/);
    });

    await check("routes are reported with their source", async () => {
      const message = await pi.notify("/jev-router route", /build: smoke-build \(preference\)/);
      assertMatch(message, /design: unset/, "unset phases should read as unset");
      assertMatch(message, /general: smoke-general \(preference\)/, "general route is missing");
    });

    await check("the model picker opens and its choice is saved", async () => {
      pi.selectResponse = (record) => {
        assertMatch(record.title, /Model for the design phase/, "unexpected picker title");
        assert(record.options.includes("smoke-design"), `picker is missing smoke-design: ${record.options.join(",")}`);
        assertMatch(record.options.at(-1) ?? "", /clear/, "picker has no clear entry");
        return "smoke-design";
      };
      await pi.notify("/jev-router route design", /Jev design route set to smoke-design/);
    });

    await check("cancelling the picker leaves the route alone", async () => {
      pi.selectResponse = () => undefined;
      const before = pi.notifies().length;
      await pi.command("/jev-router route design");
      await delay(500);
      assert(pi.notifies().length === before, "cancelling the picker should not notify");
      await pi.notify("/jev-router route", /design: smoke-design/);
    });

    await check("a route can be cleared", async () => {
      await pi.notify("/jev-router route build clear", /Jev build route cleared/);
      const message = await pi.notify("/jev-router route", /Jev phase routes:/);
      assertMatch(message, /build: unset/, "a cleared route should read as unset");
    });

    // Ahead of the bad-argument checks, which overwrite the `build` route.
    await check("preferences persist to the sandbox, not the real agent dir", async () => {
      const path = join(agentDir, "pi-jev-response-router.json");
      assert(existsSync(path), `preferences were not written to ${path}`);
      const prefs = readJson(path);
      assert(prefs.routes?.general === "smoke-general", "the general route is missing from prefs");
      assert(prefs.routes?.build === "", "a cleared route should persist as an empty string");
      assert(prefs.routes?.design === "smoke-design", "the picked route is missing from prefs");
    });

    await check("unknown phases and bad arguments are rejected", async () => {
      await pi.notify("/jev-router route nonsense model-x", /Unknown phase "nonsense"/);
      await pi.notify("/jev-router route build sideways model", /Jev build route set to sideways model/);
      await pi.notify("/jev-router footer sideways", /Unknown footer mode/);
      await pi.notify("/jev-router log sideways", /Usage: \/jev-router log on\|off/);
    });

    await check("footer and toggle changes persist", async () => {
      await pi.notify("/jev-router footer icons", /Jev footer mode: icons/);
      await pi.notify("/jev-router coaching off", /coaching hint disabled/);
      const prefs = readJson(join(agentDir, "pi-jev-response-router.json"));
      assert(prefs.footer === "icons", `expected footer=icons, got ${prefs.footer}`);
      assert(prefs.coaching === false, `expected coaching=false, got ${prefs.coaching}`);
    });

    await check("the decision log is written, and holds no conversation text", async () => {
      // Commands do not settle a turn, so no record is expected yet; the toggle
      // and the path being reported is what is checkable without a model call.
      const message = await pi.notify("/jev-router status", /decisions=/);
      assertMatch(message, /log=on/, "the decision log should be on by default");
    });

    await check("pi exits cleanly when stdin closes", async () => {
      const code = await pi.shutdown();
      assert(code === 0, `expected exit code 0, got ${code}\n      stderr: ${pi.tail()}`);
    });
  } finally {
    pi.kill();
  }

  return finish(sandbox, options);
}

function finish(sandbox, options) {
  const failed = results.filter((result) => !result.ok);

  if (failed.length === 0 && options.keep) {
    process.stdout.write(`\n  sandbox kept: ${sandbox}\n`);
  } else if (!options.keep) {
    rmSync(sandbox, { recursive: true, force: true });
  }

  process.stdout.write(`\n  ${results.length - failed.length}/${results.length} checks passed\n`);

  if (failed.length > 0) {
    process.stdout.write(`\n  FAILED:\n${failed.map((f) => `    - ${f.name}`).join("\n")}\n`);
    if (options.keep) process.stdout.write(`\n  sandbox kept: ${sandbox}\n`);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

// -------------------------------------------------------------------- driver

function parseArgs(argv) {
  const options = {
    mode: "driver",
    runtime: "auto",
    verbose: false,
    keep: false,
    noBuild: false,
    workDir: undefined,
    piBin: undefined,
    piVersion: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const split = arg.startsWith("--") && arg.includes("=") ? arg.indexOf("=") : -1;
    const flag = split === -1 ? arg : arg.slice(0, split);
    const inline = split === -1 ? undefined : arg.slice(split + 1);
    // `--flag value` consumes the next argument; `--flag=value` does not.
    const take = () => {
      if (inline !== undefined) return inline;
      i += 1;
      return argv[i];
    };

    switch (flag) {
      case "--payload":
        options.mode = "payload";
        options.workDir = take();
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--keep":
        options.keep = true;
        break;
      case "--no-build":
        options.noBuild = true;
        break;
      case "--runtime":
        options.runtime = take();
        break;
      case "--work-dir":
        options.workDir = take();
        break;
      case "--pi-bin":
        options.piBin = take();
        break;
      case "--pi-version":
        options.piVersion = take();
        break;
      default:
        process.stderr.write(`Unknown argument: ${arg}\n`);
        process.exit(2);
    }
  }

  return options;
}

function repoRoot() {
  let dir = resolve(SELF, "..", "..");
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new SmokeFailure("could not find the repo root (no pnpm-workspace.yaml)");
}

async function driver(options) {
  const root = repoRoot();
  const workDir = options.workDir ?? mkdtempSync(join(tmpdir(), "pi-smoke-work-"));

  // Pack ships `dist`, so a stale build would let this pass against code that
  // is not the code in `src`. Build first, unless explicitly told not to.
  if (!options.noBuild) {
    process.stdout.write("  building\n");
    sh(`pnpm --dir ${quote(root)} -r build`, { stdio: options.verbose ? "inherit" : "pipe" });
  }

  // Pack on the host, where pnpm and the workspace are. The payload never needs
  // pnpm, so it can run unchanged inside a plain node container.
  mkdirSync(workDir, { recursive: true });
  for (const dir of [CLASSIFIER_DIR, ROUTER_DIR]) {
    process.stdout.write(`  packing ${dir}\n`);
    sh(
      `pnpm --dir ${quote(root)} --filter ${quote(`./${dir}`)} pack --pack-destination ${quote(workDir)}`,
      { stdio: options.verbose ? "inherit" : "pipe" },
    );
  }

  copyFileSync(SELF, join(workDir, "payload.mjs"));

  const version =
    options.piVersion ??
    readJson(join(root, "package.json")).devDependencies?.["@earendil-works/pi-coding-agent"]?.replace(
      /^[\^~]/,
      "",
    );
  const piBin = piEntry(join(root, "node_modules"));

  const runtime = resolveRuntime(options.runtime, workDir, options.verbose);
  process.stdout.write(`  runtime: ${runtime.kind}${runtime.engine ? ` (${runtime.engine})` : ""}\n`);
  if (runtime.kind === "none") {
    process.stdout.write("  no container runtime found — using a temp-dir sandbox on the host\n");
  }
  process.stdout.write("\n");

  try {
    runInSandbox(runtime, workDir, { verbose: options.verbose, piVersion: version, piBin });
  } catch (error) {
    // sh() throws on the payload's non-zero exit; that is the failing path.
    const status = error?.status ?? 1;
    if (status === 1) process.exit(1);
    process.stderr.write(`\n  smoke run could not start: ${error.message}\n`);
    process.exit(status);
  }
}

// ---------------------------------------------------------------------- main

const options = parseArgs(process.argv.slice(2));

if (options.mode === "payload") {
  try {
    await payload(options.workDir ?? ".", options);
  } catch (error) {
    process.stderr.write(`\n  smoke payload crashed: ${error?.stack ?? error}\n`);
    process.exit(1);
  }
} else {
  await driver(options);
}
