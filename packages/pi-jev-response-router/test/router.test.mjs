import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import piJevResponseRouter from "../dist/index.js";
import { loadPreferences, preferencesPath, savePreferences } from "../dist/preferences.js";

function withAgentDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "jev-prefs-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return run(dir);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("preferences path honors PI_CODING_AGENT_DIR", () => {
  withAgentDir((dir) => {
    assert.equal(preferencesPath(), join(dir, "pi-jev-response-router.json"));
  });
});

test("preferences round-trip through the agent dir", () => {
  withAgentDir(() => {
    assert.deepEqual(loadPreferences(), {});

    assert.equal(
      savePreferences({ enabled: false, debug: true, verify: false, phase: false, footer: "icons" }),
      true,
    );
    assert.deepEqual(loadPreferences(), {
      enabled: false,
      debug: true,
      verify: false,
      phase: false,
      footer: "icons",
    });
  });
});

test("preferences ignore corrupt files and invalid values", () => {
  withAgentDir(() => {
    writeFileSync(preferencesPath(), "{ not json");
    assert.deepEqual(loadPreferences(), {});

    writeFileSync(
      preferencesPath(),
      JSON.stringify({ enabled: "yes", debug: 1, verify: true, footer: "bogus", extra: 1 }),
    );
    assert.deepEqual(loadPreferences(), { verify: true });
  });
});

test("jev-router dispatches commands by verb", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-cmd-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;

  try {
    const pi = {
      commands: new Map(),
      registerCommand(name, options) {
        this.commands.set(name, options);
      },
      registerProvider() {},
      on() {
        return () => {};
      },
    };
    piJevResponseRouter(pi);
    const handler = pi.commands.get("jev-router").handler;

    const notifications = [];
    const ctx = {
      ui: {
        notify: (message, type) => notifications.push({ message, type }),
        setStatus: () => {},
      },
      modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }) },
      signal: undefined,
    };
    const last = () => notifications.at(-1)?.message ?? "";

    await handler("verify off", ctx);
    assert.match(last(), /post-generation verification disabled/);
    assert.equal(loadPreferences().verify, false);

    await handler("debug on", ctx);
    assert.match(last(), /debug notifications enabled/);
    assert.equal(loadPreferences().debug, true);

    await handler("debug sideways", ctx);
    assert.match(last(), /Usage: \/jev-router debug on\|off/);

    await handler("phase off", ctx);
    assert.match(last(), /phase recommendation disabled/);
    assert.equal(loadPreferences().phase, false);

    await handler("phase sideways", ctx);
    assert.match(last(), /Usage: \/jev-router phase on\|off/);

    await handler("footer icons", ctx);
    assert.match(last(), /footer mode: icons/);
    assert.equal(loadPreferences().footer, "icons");

    await handler("footer sideways", ctx);
    assert.match(last(), /Unknown footer mode/);

    await handler("clear-cache", ctx);
    assert.match(last(), /cache cleared/);

    // Unknown verbs and empty input fall through to the status readout.
    await handler("status", ctx);
    assert.match(last(), /Jev router:/);
    await handler("", ctx);
    assert.match(last(), /Jev router:/);

    await handler("classify", ctx);
    assert.match(last(), /Usage: \/jev-router classify/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
