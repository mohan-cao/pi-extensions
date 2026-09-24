import assert from "node:assert/strict";
import test from "node:test";

import {
  FOOTER_MODES,
  TtlCache,
  formatCoaching,
  judgeTrajectory,
  parseChoiceAnswer,
  parseNoulAnswer,
  parseScoreAnswer,
} from "../dist/index.js";

/** A stand-in for the phase vocabulary, which @mohan-cao/jev-phase owns. */
const CHOICES = ["build", "design", "general"];

/** Transport settings for a Jev call. The endpoint is stubbed in these tests. */
const routerConfig = {
  endpoint: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest",
  timeoutMs: 1000,
  retries: 0,
};

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

test("footer modes are the documented set", () => {
  assert.deepEqual([...FOOTER_MODES], ["compact", "icons", "off"]);
});

test("judgeTrajectory sends only the trajectory question", async () => {
  const originalFetch = globalThis.fetch;
  const questionsSeen = [];

  globalThis.fetch = async (_url, init) => {
    questionsSeen.push(Object.keys(JSON.parse(init.body).questions));
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          trajectory: {
            type: "choice",
            choice: "converging",
            confidence: 0.9,
            probabilities: { converging: 0.9 },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const trajectory = await judgeTrajectory([{ role: "user", text: "hi" }], "k", routerConfig);

    assert.equal(trajectory.trajectory, "converging");
    // The phase question belongs to @mohan-cao/jev-phase; it must not be asked
    // here. The matching assertion for that side lives in that package's tests.
    assert.deepEqual(questionsSeen, [["trajectory"]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function trajectoryJudgment(overrides = {}) {
  return { trajectory: "converging", trajectoryConfidence: 0.9, ...overrides };
}

test("formatCoaching gates on trajectory confidence", () => {
  assert.equal(formatCoaching(trajectoryJudgment()), undefined);
  assert.equal(
    formatCoaching(trajectoryJudgment({ trajectory: "stuck_detail", trajectoryConfidence: 0.98 })),
    "♾️ paralysis",
  );
  assert.equal(
    formatCoaching(
      trajectoryJudgment({ trajectory: "stuck_framing", trajectoryConfidence: 1 }),
      "icons",
    ),
    "🖼️",
  );
  // Below threshold — the false positive the eval measured at 0.45.
  assert.equal(
    formatCoaching(trajectoryJudgment({ trajectory: "stuck_detail", trajectoryConfidence: 0.45 })),
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
    CHOICES,
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
        CHOICES,
      ),
    /Unexpected next_phase choice/,
  );
});
