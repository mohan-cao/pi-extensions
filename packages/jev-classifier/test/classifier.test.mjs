import assert from "node:assert/strict";
import test from "node:test";

import {
  FOOTER_MODES,
  PHASES,
  TtlCache,
  buildState,
  classifyWithJev,
  composeMode,
  formatCoaching,
  formatPhaseNudge,
  formatVerifyStatus,
  parseChoiceAnswer,
  parseClassificationResponse,
  parseNoulAnswer,
  parseScoreAnswer,
  phaseRecommendation,
  policyFor,
  premisePolicyFor,
} from "../dist/index.js";

const thresholds = {
  decompositionThreshold: 0.6,
  boundedVerificationThreshold: 0.6,
};

function noulResponse(decomposition, boundedVerification, premiseDefect = 0, model = "jev-1.13.0") {
  return {
    model,
    answers: {
      requires_decomposition: { type: "noul", noul: decomposition },
      bounded_verification: { type: "noul", noul: boundedVerification },
      premise_defect: {
        type: "score",
        score: premiseDefect,
        confidence: 0.9,
        legend: { 0: "sound", 1: "slip", 2: "narrow", 3: "misleading" },
        probabilities: { 0: 0.1, 1: 0.1, 2: 0.1, 3: 0.7 },
      },
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
  const result = parseClassificationResponse(noulResponse(0.82, 0.11, 2.4), thresholds);

  assert.equal(result.mode, "decomposition_required");
  assert.equal(result.confidence, 0.82);
  assert.equal(result.signals.decomposition, 0.82);
  assert.equal(result.signals.boundedVerification, 0.11);
  assert.equal(result.signals.premiseDefect, 2.4);
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

test("specialized modes produce policies and normal does not", () => {
  assert.match(policyFor("bounded_verification"), /Correct, Partially correct, or Incorrect/);
  assert.match(policyFor("decomposition_required"), /minimum useful subquestions/);
  assert.equal(policyFor("normal"), undefined);
});

test("premise correction applies above threshold and never for bounded verification", () => {
  assert.equal(premisePolicyFor("normal", 1.0, 2.8), undefined);
  assert.match(premisePolicyFor("normal", 3.0, 2.8), /state the correction/);
  assert.match(premisePolicyFor("decomposition_required", 3.0, 2.8), /state the correction/);
  // Bounded verification already emits a verdict and corrections.
  assert.equal(premisePolicyFor("bounded_verification", 3.0, 2.8), undefined);
});

test("buildState includes bounded history only when present", () => {
  assert.deepEqual(buildState("hi", []), { user_request: "hi" });
  assert.deepEqual(buildState("hi", [{ role: "assistant", text: "hello" }]), {
    recent_conversation: ["assistant: hello"],
    user_request: "hi",
  });
});

test("classifyWithJev sends both nouls, the premise score, and bounded history", async () => {
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
        premiseDefectThreshold: 2.8,
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
    assert.equal(result.signals.premiseDefect, 0);
    assert.equal(seen.url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers.Authorization, "Bearer test-key");

    const body = JSON.parse(seen.init.body);
    assert.equal(body.model, "jev-latest");
    assert.equal(body.questions.requires_decomposition.type, "noul");
    assert.equal(body.questions.bounded_verification.type, "noul");
    assert.equal(body.questions.premise_defect.type, "score");
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

test("footer modes are the documented set", () => {
  assert.deepEqual([...FOOTER_MODES], ["compact", "icons", "off"]);
});

const phaseConfig = {
  routes: {
    build: { model: "build-model" },
    design: { model: "design-model" },
    general: { model: "general-model" },
  },
  phaseConfidenceThreshold: 0.7,
  implementationReadyThreshold: 0.5,
  trajectoryConfidenceThreshold: 0.7,
  historyTurns: 8,
};

function judgment(overrides = {}) {
  return {
    phase: "build",
    phaseConfidence: 0.9,
    implementationReady: 0.9,
    trajectory: "converging",
    trajectoryConfidence: 0.9,
    ...overrides,
  };
}

test("phaseRecommendation fires only on a known mismatch", () => {
  // On the design model, work moving to build, corroborated.
  assert.deepEqual(phaseRecommendation(judgment(), "design-model", phaseConfig), {
    phase: "build",
    model: "build-model",
    currentPhase: "design",
  });
  // Already on the right model.
  assert.equal(phaseRecommendation(judgment(), "build-model", phaseConfig), undefined);
  // Unmapped model — we cannot say it is wrong, so stay quiet.
  assert.equal(phaseRecommendation(judgment(), "something-else", phaseConfig), undefined);
  // Low phase confidence.
  assert.equal(
    phaseRecommendation(judgment({ phaseConfidence: 0.4 }), "design-model", phaseConfig),
    undefined,
  );
});

test("design to build requires implementation_ready", () => {
  assert.equal(
    phaseRecommendation(judgment({ implementationReady: 0.2 }), "design-model", phaseConfig),
    undefined,
  );
  // The gate applies only to that transition.
  assert.ok(
    phaseRecommendation(
      judgment({ phase: "general", implementationReady: 0.2 }),
      "design-model",
      phaseConfig,
    ),
  );
});

test("formatPhaseNudge renders by footer mode", () => {
  const recommendation = phaseRecommendation(judgment(), "design-model", phaseConfig);
  assert.equal(formatPhaseNudge(recommendation), "↪ build · build-model");
  assert.equal(formatPhaseNudge(recommendation, "icons"), "↪🔨");
  assert.equal(formatPhaseNudge(recommendation, "off"), undefined);
  assert.equal(formatPhaseNudge(undefined), undefined);
});

test("formatCoaching gates on trajectory confidence", () => {
  assert.equal(formatCoaching(judgment()), undefined);
  assert.equal(
    formatCoaching(judgment({ trajectory: "stuck_detail", trajectoryConfidence: 0.98 })),
    "♾️ paralysis",
  );
  assert.equal(
    formatCoaching(judgment({ trajectory: "stuck_framing", trajectoryConfidence: 1 }), "icons"),
    "🖼️",
  );
  // Below threshold — the false positive the eval measured at 0.45.
  assert.equal(
    formatCoaching(judgment({ trajectory: "stuck_detail", trajectoryConfidence: 0.45 })),
    undefined,
  );
});

test("parseChoiceAnswer validates the choice against the allowed set", () => {
  const parsed = parseChoiceAnswer(
    {
      answers: {
        next_phase: { type: "choice", choice: "build", confidence: 0.9, probabilities: { build: 0.9 } },
      },
    },
    "next_phase",
    PHASES,
  );
  assert.equal(parsed.choice, "build");
  assert.equal(parsed.confidence, 0.9);

  assert.throws(
    () =>
      parseChoiceAnswer(
        {
          answers: {
            next_phase: { type: "choice", choice: "nonsense", confidence: 1, probabilities: {} },
          },
        },
        "next_phase",
        PHASES,
      ),
    /Unexpected next_phase choice/,
  );
});
