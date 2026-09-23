import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TtlCache } from "../dist/cache.js";
import { loadPreferences, preferencesPath, savePreferences } from "../dist/preferences.js";
import { FOOTER_MODES } from "../dist/types.js";
import piJevResponseRouter from "../dist/index.js";
import { buildState } from "../dist/context.js";
import {
  classifyWithJev,
  composeMode,
  parseClassificationResponse,
  parseNoulAnswer,
  parseScoreAnswer,
} from "../dist/jev-client.js";
import { policyFor } from "../dist/policies.js";
import { formatVerifyStatus } from "../dist/verify.js";

const thresholds = {
  decompositionThreshold: 0.5,
  boundedVerificationThreshold: 0.6,
};

function noulResponse(decomposition, boundedVerification, model = "jev-1.13.0") {
  return {
    model,
    answers: {
      requires_decomposition: { type: "noul", noul: decomposition },
      bounded_verification: { type: "noul", noul: boundedVerification },
    },
  };
}

test("composeMode gives decomposition precedence over bounded verification", () => {
  assert.equal(composeMode({ decomposition: 0.9, boundedVerification: 0.95 }, thresholds), "decomposition_required");
  assert.equal(composeMode({ decomposition: 0.7, boundedVerification: 0.2 }, thresholds), "decomposition_required");
});

test("composeMode falls back to normal below both thresholds", () => {
  assert.equal(composeMode({ decomposition: 0.2, boundedVerification: 0.1 }, thresholds), "normal");
  // A 0.4 bounded signal is exactly what the old single-choice argmax would
  // have mis-routed; it must now stay normal.
  assert.equal(composeMode({ decomposition: 0.3, boundedVerification: 0.4 }, thresholds), "normal");
});

test("composeMode selects bounded verification when only that clears", () => {
  assert.equal(composeMode({ decomposition: 0.1, boundedVerification: 0.8 }, thresholds), "bounded_verification");
});

test("parseClassificationResponse composes signals into a result", () => {
  const result = parseClassificationResponse(noulResponse(0.82, 0.11), thresholds);

  assert.equal(result.mode, "decomposition_required");
  assert.equal(result.confidence, 0.82);
  assert.equal(result.signals.decomposition, 0.82);
  assert.equal(result.signals.boundedVerification, 0.11);
  assert.equal(result.probabilities.decomposition_required, 0.82);
  assert.equal(result.model, "jev-1.13.0");
});

test("parseClassificationResponse rejects non-noul answers", () => {
  assert.throws(
    () =>
      parseClassificationResponse(
        {
          answers: {
            requires_decomposition: {
              type: "choice",
              choice: "normal",
              confidence: 1,
              probabilities: { normal: 1 },
            },
            bounded_verification: { type: "noul", noul: 0.1 },
          },
        },
        thresholds,
      ),
    /Expected a noul answer/,
  );
});

test("parseNoulAnswer clamps and validates the probability", () => {
  assert.equal(parseNoulAnswer({ answers: { x: { type: "noul", noul: 1.7 } } }, "x"), 1);
  assert.equal(parseNoulAnswer({ answers: { x: { type: "noul", noul: -0.2 } } }, "x"), 0);
  assert.throws(() => parseNoulAnswer({ answers: {} }, "x"), /missing answers.x/);
});

test("specialized modes produce policies and normal does not", () => {
  assert.match(policyFor("bounded_verification"), /Correct, Partially correct, or Incorrect/);
  assert.match(policyFor("decomposition_required"), /minimum useful subquestions/);
  assert.equal(policyFor("normal"), undefined);
});

test("buildState includes bounded history only when present", () => {
  assert.deepEqual(buildState("hi", []), { user_request: "hi" });
  assert.deepEqual(buildState("hi", [{ role: "assistant", text: "hello" }]), {
    recent_conversation: ["assistant: hello"],
    user_request: "hi",
  });
});

test("classifyWithJev sends two noul questions and bounded history", async () => {
  const originalFetch = globalThis.fetch;
  let seen;

  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify(noulResponse(0.05, 0.9)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await classifyWithJev(
      "UDP preserves datagram boundaries, right?",
      "test-key",
      {
        endpoint: "https://api.typesafe.ai/v1/systemone",
        model: "jev-latest",
        timeoutMs: 1000,
        retries: 0,
        ...thresholds,
        historyTurns: 4,
        cacheTtlMs: 0,
        cacheMaxEntries: 0,
        verify: false,
        verifyEvasiveThreshold: 0.6,
        verifyAnswersThreshold: 0.35,
        verifyObligationThreshold: 1.5,
      },
      undefined,
      [{ role: "user", text: "tell me about UDP" }],
    );

    assert.equal(result.mode, "bounded_verification");
    assert.equal(seen.url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers.Authorization, "Bearer test-key");

    const body = JSON.parse(seen.init.body);
    assert.equal(body.model, "jev-latest");
    assert.equal(body.questions.requires_decomposition.type, "noul");
    assert.equal(body.questions.bounded_verification.type, "noul");
    assert.deepEqual(body.state.recent_conversation, ["user: tell me about UDP"]);
    assert.equal(body.state.user_request, "UDP preserves datagram boundaries, right?");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TtlCache expires, evicts, and can be disabled", () => {
  const cache = new TtlCache(50, 2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get("b"), undefined);

  const disabled = new TtlCache(1000, 0);
  disabled.set("a", 1);
  assert.equal(disabled.get("a"), undefined);
});

test("formatVerifyStatus renders by footer mode and clears when ok", () => {
  const base = { answersQuestion: 0.9, evasive: 0.1, obligationUnmet: 0.2 };
  assert.equal(formatVerifyStatus({ ...base, flag: "ok" }), undefined);
  assert.equal(formatVerifyStatus({ ...base, flag: "evasive" }), "🤷 evasive");
  assert.equal(formatVerifyStatus({ ...base, flag: "unmet" }), "🚩 unmet");
  assert.equal(formatVerifyStatus({ ...base, flag: "evasive" }, "icons"), "🤷");
  assert.equal(formatVerifyStatus({ ...base, flag: "unmet" }, "icons"), "🚩");
  assert.equal(formatVerifyStatus({ ...base, flag: "unmet" }, "off"), undefined);
});

test("parseScoreAnswer returns the expected score and level probabilities", () => {
  const parsed = parseScoreAnswer(
    {
      answers: {
        obligation_unmet: {
          type: "score",
          score: 2.4,
          confidence: 0.8,
          legend: { 0: "a", 1: "b", 2: "c", 3: "d" },
          probabilities: { 0: 0.1, 1: 0.1, 2: 0.2, 3: 0.6 },
        },
      },
    },
    "obligation_unmet",
  );

  assert.equal(parsed.score, 2.4);
  assert.equal(parsed.probabilities["3"], 0.6);
  assert.throws(
    () => parseScoreAnswer({ answers: {} }, "obligation_unmet"),
    /missing answers.obligation_unmet/,
  );
});

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
      savePreferences({ enabled: false, debug: true, verify: false, footer: "icons" }),
      true,
    );
    assert.deepEqual(loadPreferences(), {
      enabled: false,
      debug: true,
      verify: false,
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

test("footer modes are the documented set", () => {
  assert.deepEqual([...FOOTER_MODES], ["compact", "icons", "off"]);
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
