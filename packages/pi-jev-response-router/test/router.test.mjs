import assert from "node:assert/strict";
import test from "node:test";

import { TtlCache } from "../dist/cache.js";
import { buildState } from "../dist/context.js";
import {
  classifyWithJev,
  composeMode,
  parseClassificationResponse,
  parseNoulAnswer,
} from "../dist/jev-client.js";
import { policyFor } from "../dist/policies.js";

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
