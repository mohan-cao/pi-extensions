import assert from "node:assert/strict";
import test from "node:test";

import {
  PROGRESS,
  PROGRESS_QUESTION,
  judgeTrajectory,
  summarizeProgress,
} from "../dist/index.js";

const jevConfig = {
  endpoint: "https://example.test/v1/systemone",
  model: "jev-latest",
  timeoutMs: 5_000,
  retries: 0,
};

function judgment(progress, progressConfidence = 0.9) {
  return { progress, progressConfidence };
}

test("PROGRESS is the documented set, with no stuck value", () => {
  assert.deepEqual([...PROGRESS], ["regressed", "held", "advanced"]);
  assert.equal(PROGRESS.includes("stuck_detail"), false);
});

test("the question is phase-agnostic and treats agreement as advancing", () => {
  assert.match(PROGRESS_QUESTION.instructions, /any kind of work/);
  assert.match(PROGRESS_QUESTION.criteria.advanced, /converged on agreement/);
});

test("judgeTrajectory sends only the progress question", async () => {
  const originalFetch = globalThis.fetch;
  const questionsSeen = [];

  globalThis.fetch = async (_url, init) => {
    questionsSeen.push(Object.keys(JSON.parse(init.body).questions));
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          progress: {
            type: "choice",
            choice: "advanced",
            confidence: 0.83,
            probabilities: { advanced: 0.83 },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await judgeTrajectory([{ role: "user", text: "hi" }], "k", jevConfig);

    assert.equal(result.progress, "advanced");
    assert.equal(result.progressConfidence, 0.83);
    assert.equal(result.model, "jev-1.13.0");
    // The verify and phase questions belong to their own packages.
    assert.deepEqual(questionsSeen, [["progress"]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("judgeTrajectory rejects a choice outside the vocabulary", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        answers: {
          progress: {
            type: "choice",
            choice: "stuck_detail",
            confidence: 1,
            probabilities: {},
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    await assert.rejects(
      () => judgeTrajectory([{ role: "user", text: "hi" }], "k", jevConfig),
      /Unexpected progress choice/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("summarizeProgress returns zeros for an empty series", () => {
  assert.deepEqual(summarizeProgress([], 0.7), {
    counted: 0,
    advanced: 0,
    net: 0,
    oscillation: 0,
    longestStall: 0,
    regressedShare: 0,
  });
});

test("summarizeProgress excludes turns below the confidence gate", () => {
  // The low-confidence turn is dropped, not counted as `held`.
  const summary = summarizeProgress(
    [judgment("advanced"), judgment("regressed", 0.4), judgment("advanced")],
    0.7,
  );
  assert.equal(summary.counted, 2);
  assert.equal(summary.advanced, 2);
  assert.equal(summary.regressedShare, 0);
});

test("summarizeProgress computes net, stall, and share", () => {
  const summary = summarizeProgress(
    [judgment("advanced"), judgment("advanced"), judgment("held"), judgment("regressed")],
    0.7,
  );
  assert.equal(summary.counted, 4);
  assert.equal(summary.advanced, 2);
  // (1 + 1 + 0 - 1) / 4
  assert.equal(summary.net, 0.25);
  assert.equal(summary.longestStall, 2);
  assert.equal(summary.regressedShare, 0.25);
});

test("oscillation counts reversals, not pauses", () => {
  // A pause does not change direction, so advanced/held/regressed is one reversal.
  assert.equal(
    summarizeProgress([judgment("advanced"), judgment("held"), judgment("regressed")], 0.7)
      .oscillation,
    1,
  );
  // Thrashing is four.
  assert.equal(
    summarizeProgress(
      [
        judgment("advanced"),
        judgment("regressed"),
        judgment("advanced"),
        judgment("regressed"),
        judgment("advanced"),
      ],
      0.7,
    ).oscillation,
    4,
  );
  // A steady run has none.
  assert.equal(
    summarizeProgress([judgment("advanced"), judgment("advanced"), judgment("held")], 0.7)
      .oscillation,
    0,
  );
});

test("a correction cycle and a spiral differ in the aggregates, not the verdict", () => {
  // High regressed *with* high advanced: healthy reopening.
  const cycle = summarizeProgress(
    [judgment("advanced"), judgment("regressed"), judgment("advanced"), judgment("regressed")],
    0.7,
  );
  // Regressed with nothing advancing: a spiral.
  const spiral = summarizeProgress(
    [judgment("held"), judgment("regressed"), judgment("regressed"), judgment("held")],
    0.7,
  );

  assert.equal(cycle.regressedShare, spiral.regressedShare);
  assert.ok(cycle.net > spiral.net);
  assert.equal(cycle.advanced, 2);
  assert.equal(spiral.advanced, 0);
});
