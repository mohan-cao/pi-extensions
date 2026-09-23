import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendDecision, decisionLogPath } from "../dist/decision-log.js";
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

test("decision log appends one JSON line per record", () => {
  withAgentDir((dir) => {
    assert.equal(decisionLogPath(), join(dir, "jev-decisions.jsonl"));

    assert.equal(
      appendDecision({
        at: "2026-01-01T00:00:00.000Z",
        mode: "bounded_verification",
        signals: { decomposition: 0.1, boundedVerification: 0.9, premiseDefect: 0 },
        modelRunning: "model-a",
        recommendedModel: "model-b",
        coachingHint: false,
      }),
      true,
    );
    appendDecision({
      at: "2026-01-01T00:01:00.000Z",
      mode: "normal",
      signals: { decomposition: 0.1, boundedVerification: 0.1, premiseDefect: 0 },
    });

    const lines = readFileSync(decisionLogPath(), "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).recommendedModel, "model-b");
    assert.equal(JSON.parse(lines[1]).mode, "normal");
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

    await handler("coaching off", ctx);
    assert.match(last(), /coaching hint disabled/);
    assert.equal(loadPreferences().coaching, false);

    await handler("coaching sideways", ctx);
    assert.match(last(), /Usage: \/jev-router coaching on\|off/);

    await handler("log off", ctx);
    assert.match(last(), /decision log disabled/);
    assert.equal(loadPreferences().log, false);

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

    await handler("help", ctx);
    assert.match(last(), /\/jev-router status/);
    assert.match(last(), /\/jev-router footer compact\|icons\|off/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
