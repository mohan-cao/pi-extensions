import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPhaseConfig } from "../dist/config.js";
import { appendDecision, decisionLogPath } from "../dist/decision-log.js";
import piJevResponseRouter from "../dist/index.js";
import { loadPreferences, preferencesPath, savePreferences } from "../dist/preferences.js";
import { ProgressTally } from "../dist/progress.js";

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

const PHASE_ENV_NAMES = [
  "PI_JEV_PHASE_BUILD_MODEL",
  "PI_JEV_PHASE_DESIGN_MODEL",
  "PI_JEV_PHASE_GENERAL_MODEL",
];

function withPhaseEnv(values, run) {
  const previous = PHASE_ENV_NAMES.map((name) => process.env[name]);
  for (const name of PHASE_ENV_NAMES) delete process.env[name];
  for (const [name, value] of Object.entries(values)) process.env[name] = value;

  try {
    return run();
  } finally {
    PHASE_ENV_NAMES.forEach((name, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
}

test("phase routes prefer a preference over the environment", () => {
  withPhaseEnv({ PI_JEV_PHASE_BUILD_MODEL: "from-env", PI_JEV_PHASE_DESIGN_MODEL: "env" }, () => {
    assert.equal(loadPhaseConfig().routes.build.model, "from-env");
    // A preference wins over the variable...
    assert.equal(loadPhaseConfig({ build: "from-prefs" }).routes.build.model, "from-prefs");
    // ...and an empty string is an explicit clear, not "fall through to env".
    assert.equal(loadPhaseConfig({ build: "" }).routes.build, undefined);
    // Untouched phases still fall through.
    assert.equal(loadPhaseConfig({ build: "from-prefs" }).routes.design.model, "env");
    assert.equal(loadPhaseConfig().routes.general, undefined);
  });
});

test("preferences keep valid phase routes and drop the rest", () => {
  withAgentDir(() => {
    assert.equal(savePreferences({ routes: { build: "model-b", design: "" } }), true);
    assert.deepEqual(loadPreferences().routes, { build: "model-b", design: "" });

    writeFileSync(
      preferencesPath(),
      JSON.stringify({ routes: { build: "ok", bogus: "x", design: 7 } }),
    );
    assert.deepEqual(loadPreferences().routes, { build: "ok" });
  });
});

test("jev-router route sets, lists, picks, and clears phase routes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-route-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousEnv = PHASE_ENV_NAMES.map((name) => process.env[name]);
  process.env.PI_CODING_AGENT_DIR = dir;
  for (const name of PHASE_ENV_NAMES) delete process.env[name];

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
    let picker;
    const ctx = {
      ui: {
        notify: (message, type) => notifications.push({ message, type }),
        setStatus: () => {},
        select: async (title, options) => {
          picker = { title, options };
          return options[0];
        },
      },
      hasUI: true,
      modelRegistry: {
        getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }),
        getAvailable: () => [
          { id: "model-a", provider: "p1" },
          { id: "model-b", provider: "p1" },
          { id: "model-a", provider: "p2" },
        ],
      },
      signal: undefined,
    };
    const last = () => notifications.at(-1)?.message ?? "";

    await handler("route", ctx);
    assert.match(last(), /Jev phase routes:/);
    assert.match(last(), /build: unset/);

    await handler("route build model-b", ctx);
    assert.match(last(), /Jev build route set to model-b/);
    assert.equal(loadPreferences().routes.build, "model-b");

    // Persisted, and now reported as coming from the preferences file.
    await handler("route", ctx);
    assert.match(last(), /build: model-b \(preference\)/);

    // Without a model id the picker opens, deduped by id, with a clear entry.
    await handler("route design", ctx);
    assert.equal(picker.title, "Model for the design phase");
    assert.deepEqual(picker.options.slice(0, 2), ["model-a", "model-b"]);
    assert.match(picker.options.at(-1), /clear/);
    assert.equal(loadPreferences().routes.design, "model-a");

    await handler("route nope model-x", ctx);
    assert.match(last(), /Unknown phase "nope"/);

    await handler("route build clear", ctx);
    assert.match(last(), /Jev build route cleared/);
    assert.equal(loadPreferences().routes.build, "");

    // A cleared route is gone from the listing, not reported as a model.
    await handler("route", ctx);
    assert.match(last(), /build: unset/);
  } finally {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    PHASE_ENV_NAMES.forEach((name, index) => {
      const value = previousEnv[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
    rmSync(dir, { recursive: true, force: true });
  }
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

// --- ProgressTally: the host side of the progress signal -------------------
//
// The aggregation itself is tested in @mohan-cao/jev-trajectory. What is tested
// here is the window: when the series resets, and how the ratio renders.

const ADVANCED = { advanceConfidence: 0.9, regressConfidence: 0.1 };
const HELD = { advanceConfidence: 0.1, regressConfidence: 0.1 };
const MIXED = { advanceConfidence: 0.9, regressConfidence: 0.9 };

test("ProgressTally starts at 0/0 and counts what advances", () => {
  const tally = new ProgressTally();
  assert.equal(tally.format("compact", 0.7), "0/0");

  tally.record(ADVANCED, "design");
  tally.record(HELD, "design");
  // A mixed turn had something advance, so it counts toward the numerator.
  tally.record(MIXED, "design");

  assert.equal(tally.format("compact", 0.7), "2/3");
});

test("ProgressTally resets when the phase changes", () => {
  const tally = new ProgressTally();
  tally.record(ADVANCED, "design");
  tally.record(ADVANCED, "design");
  assert.equal(tally.format("compact", 0.7), "2/2");

  // A phase change starts a new trajectory, so only the new phase's turn counts.
  tally.record(HELD, "build");
  assert.equal(tally.format("compact", 0.7), "0/1");
});

test("ProgressTally does not reset while the phase holds", () => {
  const tally = new ProgressTally();
  tally.record(ADVANCED, "design");
  tally.record(ADVANCED, "design");
  tally.record(ADVANCED, "design");
  assert.equal(tally.format("compact", 0.7), "3/3");
});

test("ProgressTally does not reset on its first turn", () => {
  const tally = new ProgressTally();
  tally.record(ADVANCED, "build");
  assert.equal(tally.format("compact", 0.7), "1/1");
});

test("ProgressTally tolerates an unknown phase without resetting", () => {
  const tally = new ProgressTally();
  tally.record(ADVANCED, "design");
  // The phase judgment may be disabled or have failed open. That is not a
  // transition, so the series carries on rather than silently restarting.
  tally.record(ADVANCED, undefined);
  tally.record(ADVANCED, "design");
  assert.equal(tally.format("compact", 0.7), "3/3");
});

test("ProgressTally applies the confidence gate, and off renders nothing", () => {
  const tally = new ProgressTally();
  tally.record(ADVANCED, "build");
  // One answer is unsure, so the turn does not count at all.
  tally.record({ advanceConfidence: 0.95, regressConfidence: 0.4 }, "build");

  assert.equal(tally.format("compact", 0.7), "1/1");
  assert.equal(tally.format("off", 0.7), undefined);
  // Numbers only: the ratio is already the compact form, so icons matches.
  assert.equal(tally.format("icons", 0.7), "1/1");
});

test("ProgressTally.reset clears the series", () => {
  const tally = new ProgressTally();
  tally.record(ADVANCED, "build");
  tally.reset();
  assert.equal(tally.format("compact", 0.7), "0/0");
});
