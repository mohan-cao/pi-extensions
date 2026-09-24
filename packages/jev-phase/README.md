# @mohan-cao/jev-phase

The phase signal, extracted from `@mohan-cao/jev-classifier`: one Jev Choice
judgment answering *what kind of work does this conversation need next* —
`build`, `design`, or `general`.

```bash
npm install @mohan-cao/jev-phase
```

```ts
import { judgePhase, NEXT_PHASE_QUESTION, PHASES } from "@mohan-cao/jev-phase";

const judgment = await judgePhase(turns, apiKey, routerConfig);
// { phase: "design", phaseConfidence: 0.83, model: "jev-1.13.0" }
```

## Scope: an indicator, not a router

This is deliberately a small component. It reports where a session sits; it does
not decide what you should do about it.

That is not modesty, it is the design. The reader of the signal — the human in
the loop — is the one who knows whether a session is advancing toward its goal
or circling one part of the problem. Reading `design` makes that judgement
explicit; no internal measurement can make it for them. A component that
recommended a model instead would be substituting for a preference the user
already holds, and the inputs that would justify it (risk, verification cost,
tolerance for a wrong path) are local knowledge a session does not have.

So the supported use is the status indicator. `PhaseConfig.routes`,
`phaseRecommendation`, and `formatPhaseNudge` are the earlier routing experiment,
kept because they are harmless and the data is interesting — but nothing here
should be treated as advice about which model to run.

See `docs/design/classifier-scope.md` in the repository for the rule this
follows and the verdicts on the other signals.

## API

| export | purpose |
| --- | --- |
| `judgePhase(turns, apiKey, config, signal?)` | one Jev Choice call → `PhaseJudgment` |
| `NEXT_PHASE_QUESTION` | the question spec, for reuse or inspection |
| `PHASES`, `Phase` | the vocabulary |
| `phaseRecommendation(judgment, currentModelId, config)` | the routing experiment |
| `formatPhaseNudge(recommendation, mode)` | status string, or `undefined` to clear |

## Notes

- **Its own call.** Not shared with verification or the trajectory judgment.
  Questions sharing a call can perturb each other.
- **`general` is a residual, not a category.** It means "neither implementation
  nor design specifically describes this", which includes prose and mixed work.
- **A `phaseConfidence` below the configured threshold means no nudge**, not a
  low-quality judgment. Near-ties are reported as such rather than resolved.

## License

Apache-2.0.
