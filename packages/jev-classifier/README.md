# @mohan-cao/jev-classifier

Harness-agnostic System One (Jev) classifier. Given a request — and optionally recent
conversation — it decides what kind of answer the request needs, supplies the steering text
for that shape, and, after generation, judges whether the answer met its obligation.

It contains **no harness code**: no session access, no UI, no credential storage, and no
dependencies. A harness supplies the API key, the conversation history, and somewhere to
render the result. The Pi implementation lives in
[`@mohan-cao/pi-jev-response-router`](https://www.npmjs.com/package/@mohan-cao/pi-jev-response-router).

## Install

```bash
npm install @mohan-cao/jev-classifier
```

## Usage

```ts
import {
  TtlCache,
  classifyWithJev,
  formatVerifyStatus,
  policyFor,
  premisePolicyFor,
  verifyResponse,
  type RouterConfig,
} from "@mohan-cao/jev-classifier";

const config: RouterConfig = {
  endpoint: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest",
  timeoutMs: 5_000,
  retries: 2,
  decompositionThreshold: 0.6,
  boundedVerificationThreshold: 0.6,
  premiseDefectThreshold: 2.8,
  historyTurns: 4,
  cacheTtlMs: 300_000,
  cacheMaxEntries: 64,
  verify: true,
  verifyEvasiveThreshold: 0.6,
  verifyAnswersThreshold: 0.35,
  verifyObligationThreshold: 1.5,
};

// before generation
const decision = await classifyWithJev(prompt, apiKey, config, signal, history);
const policy = policyFor(decision.mode); // undefined for `normal`
const premise = premisePolicyFor(
  decision.mode,
  decision.signals.premiseDefect,
  config.premiseDefectThreshold,
);

// after generation
const verdict = await verifyResponse(request, response, apiKey, config, signal);
const status = formatVerifyStatus(verdict, "compact");
```

## What it decides

| question | type | drives |
| --- | --- | --- |
| `requires_decomposition` | Noul | response-shape policy |
| `bounded_verification` | Noul | response-shape policy |
| `premise_defect` | Score 0–3 | corrective modifier |
| `answers_question` | Noul | verification flag |
| `evasive` | Noul | verification flag |
| `obligation_unmet` | Score 0–3 | verification flag |

The response shape is composed in code with **decomposition taking precedence** and `normal`
as the residual, so `normal` never competes in an argmax. `premise_defect` is a modifier, not
a mode, and is never applied to `bounded_verification`, which already emits a verdict and
corrections.

## Two post-generation judgments

Both read the conversation, and each is its own call — separate from verification (which reads
only the last exchange) and from each other. Questions sharing a call can perturb each other;
`implementation_ready` did exactly that, which is why it was removed.

```ts
// model nudge
const phase = await judgePhase(turns, apiKey, config, signal);
const recommendation = phaseRecommendation(phase, ctx.model?.id, phaseConfig);
const nudge = formatPhaseNudge(recommendation, "compact"); // "↪ build · <model>"

// coaching hint
const trajectory = await judgeTrajectory(turns, apiKey, config, signal);
const hint = formatCoaching(trajectory, "compact", trajectoryConfig.trajectoryConfidenceThreshold);
```

| question | judge | drives |
| --- | --- | --- |
| `next_phase` (build / design / general) | `judgePhase` | which model suits the next work |
| `trajectory` (converging / stuck_detail / stuck_framing / early) | `judgeTrajectory` | the coaching hint |

They are **orthogonal**: a conversation can be stuck while implementing, or framing a problem
badly during general conversation. Neither gates the other.

The nudge is a **report, not a controller**. Jev never emits `stay` — whether a nudge is shown
is decided in code by comparing the observed phase to the phase the running model serves. An
unmapped model yields no nudge, because we cannot say it is wrong.

Both gates are `0.7`, measured rather than guessed. `stuck_detail` requires *escalation or
repetition*, not mere unresolvedness — an early design conversation that keeps opening questions
is not a spiral.

## Decision log

`DecisionRecord` is the shape of one settled turn — judgments, probabilities, and model ids,
never conversation text. Where it goes is the harness's business; the Pi extension appends it as
JSONL under the agent config directory.

Acceptance of a model nudge is derived by diffing consecutive records (`recommendedModel` at
turn N vs `modelRunning` at turn N+1), which is the only correctness proxy available without
hand-labelling.

## Design notes

**Observe vs decide.** Jev only observes — what shape the request needs, whether a premise is
sound, whether the answer met its obligation. Everything that *decides* (mode precedence,
thresholds, which flag wins, whether to render anything) is deterministic code. This is why
`stay` is not a Jev output and why `genuinely_tricky` was removed: it measured the question and
stamped the verdict on the answer.

**Thresholds are evidence-based.** The decomposition threshold is `0.6`, not `0.5`, because
conversation history inflates the score by +0.06–0.13 and `0.5` sat inside that noise band.
`obligation_unmet` gates on the expected score rather than `P(level 3)`, because the canonical
"technically true but useless" answer scores `P(3)=0.30` but `E=2.30`. See
`scripts/jev-eval.mjs` in the repository for the harness that produced these numbers.

**Prompt specs are a seam.** All question wording lives in `questions.ts` and is isolated from
transport, composition, and policies, so it can be replaced by a prompt-management loop
without touching anything else.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
