# @mohan-cao/jev-classify

The classification signal, extracted from `@mohan-cao/jev-classifier`: one Jev
call answering *what kind of response does the current request need*, plus the
response policy that follows from it.

```bash
npm install @mohan-cao/jev-classify
```

```ts
import { classifyWithJev, policyFor, premisePolicyFor } from "@mohan-cao/jev-classify";

const result = await classifyWithJev(prompt, apiKey, config, signal, history);
// { mode: "decomposition_required", confidence: 0.86, signals: { ... } }
```

| mode | policy |
| --- | --- |
| `decomposition_required` | decompose before concluding; name the controlling dependencies |
| `bounded_verification` | verdict-plus-corrections, at most three claims |
| `normal` | none — the residual |

## Design notes

**Two Noul questions and a Score, not one Choice.** A single 3-way Choice makes
`normal` a competing argmax candidate, and a decomposition-shaped request where
`normal` scored 0.40 and `decomposition_required` scored 0.35 got routed to
`normal`. Two orthogonal Noul signals composed in code keep `normal` as the
residual and give decomposition explicit precedence. The thresholds are
asymmetric — a higher bar for bounded verification than for decomposition —
because the failure modes are asymmetric.

**`normal` is a residual, not a category.** It means "neither of the two
questions cleared", which is why `policyFor("normal")` returns `undefined` and
no policy section is injected at all.

**Premise correction is a modifier, not a mode.** `premisePolicyFor` applies on
top of a mode, and deliberately never for `bounded_verification`, which already
emits verdicts and corrections — applying it there would duplicate them.

## Caveats

- **The thresholds are tuned against a synthetic eval set, not real usage.**
  `0.6` for both gates came from eight hand-written cases. Real conversations
  will cover cases those eight do not, so treat the gates as provisional until
  they have been measured against logged decisions.
- **History inflates the decomposition score.** Including prior turns measurably
  raises it, which is why the question is worded to judge the *current request
  only*. If that wording is ever loosened, the threshold has to move with it.
- **The classification cache is not here.** Caching is a host concern — this
  package makes a call when asked and holds no state.

## API

| export | purpose |
| --- | --- |
| `classifyWithJev(prompt, apiKey, config, signal?, history?)` | one Jev call → `ClassificationResult` |
| `parseClassificationResponse(payload, config)` | pure: Jev answers → result |
| `composeMode(signals, config)` | pure: signals → mode |
| `buildState(prompt, history)` | pure: the Jev `state` payload |
| `policyFor(mode)`, `premisePolicyFor(mode, defect, threshold)` | the prompt sections |
| `DECOMPOSITION_QUESTION`, `BOUNDED_VERIFICATION_QUESTION`, `PREMISE_DEFECT_QUESTION` | question specs |
| `ClassifyConfig` | transport settings plus the three thresholds and `historyTurns` |

## License

Apache-2.0.
