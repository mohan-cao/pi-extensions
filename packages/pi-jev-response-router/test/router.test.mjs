import assert from "node:assert/strict";
import test from "node:test";

import { parseClassificationResponse } from "../dist/jev-client.js";
import { policyFor } from "../dist/policies.js";

test("parses Jev choice responses", () => {
  const result = parseClassificationResponse({
    model: "jev-1.13.0",
    answers: {
      response_mode: {
        type: "choice",
        choice: "bounded_verification",
        confidence: 0.91,
        probabilities: {
          bounded_verification: 0.93,
          decomposition_required: 0.04,
          normal: 0.03,
        },
      },
    },
  });

  assert.equal(result.mode, "bounded_verification");
  assert.equal(result.confidence, 0.91);
  assert.equal(result.model, "jev-1.13.0");
});

test("rejects unknown response modes", () => {
  assert.throws(
    () =>
      parseClassificationResponse({
        answers: {
          response_mode: {
            type: "choice",
            choice: "invented_mode",
            confidence: 1,
            probabilities: { invented_mode: 1 },
          },
        },
      }),
    /Unexpected Jev response mode/,
  );
});

test("specialized modes produce policies and normal does not", () => {
  assert.match(policyFor("bounded_verification"), /Correct, Partially correct, or Incorrect/);
  assert.match(policyFor("decomposition_required"), /minimum useful subquestions/);
  assert.equal(policyFor("normal"), undefined);
});

test("classifyWithJev sends native System One shape", async () => {
  const { classifyWithJev } = await import("../dist/jev-client.js");
  const originalFetch = globalThis.fetch;
  let seen;

  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          response_mode: {
            type: "choice",
            choice: "decomposition_required",
            confidence: 0.8,
            probabilities: {
              bounded_verification: 0.1,
              decomposition_required: 0.85,
              normal: 0.05,
            },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await classifyWithJev(
      "Should we replace Postgres with Redis?",
      "test-key",
      {
        endpoint: "https://api.typesafe.ai/v1/systemone",
        model: "jev-latest",
        timeoutMs: 1000,
        retries: 0,
        minConfidence: 0,
      },
    );

    assert.equal(result.mode, "decomposition_required");
    assert.equal(seen.url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers.Authorization, "Bearer test-key");

    const body = JSON.parse(seen.init.body);
    assert.equal(body.model, "jev-latest");
    assert.equal(body.state.user_request, "Should we replace Postgres with Redis?");
    assert.equal(body.questions.response_mode.type, "choice");
    assert.equal(
      body.questions.response_mode.criteria.decomposition_required.includes("tradeoffs"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
