import assert from "node:assert/strict";
import test from "node:test";

import {
  RESPONSE_MODES,
  buildState,
  classifyWithJev,
  composeMode,
  parseClassificationResponse,
  policyFor,
  premisePolicyFor,
} from "../dist/index.js";

const thresholds = {
  decompositionThreshold: 0.6,
  boundedVerificationThreshold: 0.6,
};

/** Transport settings plus this component's thresholds. No verify, no cache. */
const classifyConfig = {
  endpoint: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest",
  timeoutMs: 1000,
  retries: 0,
  ...thresholds,
  premiseDefectThreshold: 2.8,
  historyTurns: 4,
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

test("RESPONSE_MODES is the documented set", () => {
  assert.deepEqual([...RESPONSE_MODES], [
    "bounded_verification",
    "decomposition_required",
    "normal",
  ]);
});

test("composeMode gives decomposition precedence over bounded verification", () => {
  assert.equal(
    composeMode({ decomposition: 0.9, boundedVerification: 0.95 }, thresholds),
    "decomposition_required",
  );
  assert.equal(
    composeMode({ decomposition: 0.7, boundedVerification: 0.2 }, thresholds),
    "decomposition_required",
  );
});

test("composeMode falls back to normal below both thresholds", () => {
  assert.equal(composeMode({ decomposition: 0.2, boundedVerification: 0.1 }, thresholds), "normal");
  // A 0.4 bounded signal is exactly what the old single-choice argmax would
  // have mis-routed; it must now stay normal.
  assert.equal(composeMode({ decomposition: 0.3, boundedVerification: 0.4 }, thresholds), "normal");
});

test("composeMode selects bounded verification when only that clears", () => {
  assert.equal(
    composeMode({ decomposition: 0.1, boundedVerification: 0.8 }, thresholds),
    "bounded_verification",
  );
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

test("confidence is the winning mode's probability, in every mode", () => {
  // Guards the simplification that replaced the nested ternary: confidence must
  // still equal `probabilities[mode]`, not merely agree for decomposition.
  for (const [decomposition, bounded] of [
    [0.9, 0.1],
    [0.1, 0.9],
    [0.1, 0.1],
  ]) {
    const result = parseClassificationResponse(noulResponse(decomposition, bounded), thresholds);
    assert.equal(result.confidence, result.probabilities[result.mode]);
  }
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
      classifyConfig,
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
