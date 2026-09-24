import assert from "node:assert/strict";
import test from "node:test";

import { formatVerifyStatus, verifyResponse } from "../dist/index.js";

const verifyConfig = {
  endpoint: "https://example.test/v1/systemone",
  model: "jev-latest",
  timeoutMs: 5_000,
  retries: 0,
  enabled: true,
  evasiveThreshold: 0.6,
  answersThreshold: 0.35,
  obligationThreshold: 1.5,
};

/** Stub the Jev call with fixed answers. */
function stubAnswers({ answersQuestion, evasive, obligationUnmet }) {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          answers_question: { type: "noul", noul: answersQuestion },
          evasive: { type: "noul", noul: evasive },
          obligation_unmet: {
            type: "score",
            score: obligationUnmet,
            confidence: 0.9,
            legend: {},
            probabilities: {},
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  return () => {
    globalThis.fetch = original;
  };
}

test("verifyResponse reports ok when nothing clears a threshold", async () => {
  const restore = stubAnswers({ answersQuestion: 0.86, evasive: 0.08, obligationUnmet: 0.94 });
  try {
    const result = await verifyResponse("req", "res", "k", verifyConfig);
    assert.equal(result.flag, "ok");
    assert.equal(result.answersQuestion, 0.86);
    assert.equal(result.evasive, 0.08);
    assert.equal(result.obligationUnmet, 0.94);
    assert.equal(result.model, "jev-1.13.0");
  } finally {
    restore();
  }
});

test("verifyResponse flags evasion before obligation", async () => {
  // Both conditions hold; evasion is checked first and wins.
  const restore = stubAnswers({ answersQuestion: 0.9, evasive: 0.8, obligationUnmet: 2.5 });
  try {
    const result = await verifyResponse("req", "res", "k", verifyConfig);
    assert.equal(result.flag, "evasive");
  } finally {
    restore();
  }
});

test("verifyResponse flags a low answer score as evasive", async () => {
  const restore = stubAnswers({ answersQuestion: 0.1, evasive: 0.05, obligationUnmet: 0.5 });
  try {
    const result = await verifyResponse("req", "res", "k", verifyConfig);
    assert.equal(result.flag, "evasive");
  } finally {
    restore();
  }
});

test("verifyResponse flags unmet obligation", async () => {
  const restore = stubAnswers({ answersQuestion: 0.9, evasive: 0.1, obligationUnmet: 2.2 });
  try {
    const result = await verifyResponse("req", "res", "k", verifyConfig);
    assert.equal(result.flag, "unmet");
  } finally {
    restore();
  }
});

test("formatVerifyStatus renders by footer mode and clears when ok", () => {
  const unmet = { flag: "unmet", answersQuestion: 0.9, evasive: 0.1, obligationUnmet: 2.2 };
  const evasive = { flag: "evasive", answersQuestion: 0.1, evasive: 0.9, obligationUnmet: 0.2 };
  const ok = { flag: "ok", answersQuestion: 0.9, evasive: 0.05, obligationUnmet: 0.2 };

  assert.equal(formatVerifyStatus(unmet), "🚩 unmet");
  assert.equal(formatVerifyStatus(evasive), "🤷 evasive");
  assert.equal(formatVerifyStatus(unmet, "icons"), "🚩");
  assert.equal(formatVerifyStatus(evasive, "icons"), "🤷");
  assert.equal(formatVerifyStatus(unmet, "off"), undefined);
  // Nothing to report, in every mode.
  assert.equal(formatVerifyStatus(ok), undefined);
  assert.equal(formatVerifyStatus(ok, "icons"), undefined);
});
