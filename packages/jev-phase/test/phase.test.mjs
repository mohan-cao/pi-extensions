import assert from "node:assert/strict";
import test from "node:test";

import {
  PHASES,
  formatPhaseNudge,
  judgePhase,
  phaseRecommendation,
} from "../dist/index.js";

/** Jev transport settings. The endpoint is stubbed, so only the shape matters. */
const routerConfig = {
  endpoint: "https://example.test/v1/systemone",
  model: "jev-latest",
  timeoutMs: 5_000,
  retries: 0,
};

test("PHASES is the documented vocabulary", () => {
  assert.deepEqual([...PHASES], ["build", "design", "general"]);
});

test("judgePhase sends only the phase question", async () => {
  const originalFetch = globalThis.fetch;
  const questionsSeen = [];

  globalThis.fetch = async (_url, init) => {
    questionsSeen.push(Object.keys(JSON.parse(init.body).questions));
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          next_phase: {
            type: "choice",
            choice: "build",
            confidence: 0.9,
            probabilities: { build: 0.9 },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const phase = await judgePhase([{ role: "user", text: "hi" }], "k", routerConfig);

    assert.equal(phase.phase, "build");
    assert.equal(phase.phaseConfidence, 0.9);
    assert.equal(phase.model, "jev-1.13.0");
    // The trajectory question belongs to @mohan-cao/jev-classifier and must not
    // be asked here. The matching assertion for that side lives in its tests.
    assert.deepEqual(questionsSeen, [["next_phase"]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const phaseConfig = {
  routes: {
    build: { model: "build-model" },
    design: { model: "design-model" },
    general: { model: "general-model" },
  },
  phaseConfidenceThreshold: 0.7,
  historyTurns: 8,
};

function judgment(overrides = {}) {
  return { phase: "build", phaseConfidence: 0.9, ...overrides };
}

test("phaseRecommendation fires only on a known mismatch", () => {
  // On the design model, work moving to build.
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

test("a phase with no configured route yields no recommendation", () => {
  const routes = { build: { model: "build-model" } };
  assert.equal(
    phaseRecommendation(judgment(), "design-model", { ...phaseConfig, routes }),
    undefined,
  );
});

test("formatPhaseNudge renders by footer mode", () => {
  const recommendation = phaseRecommendation(judgment(), "design-model", phaseConfig);
  assert.equal(formatPhaseNudge(recommendation), "↪ build · build-model");
  assert.equal(formatPhaseNudge(recommendation, "icons"), "↪🔨");
  assert.equal(formatPhaseNudge(recommendation, "off"), undefined);
  assert.equal(formatPhaseNudge(undefined), undefined);
});
