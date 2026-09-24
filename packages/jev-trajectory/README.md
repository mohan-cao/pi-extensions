# @mohan-cao/jev-trajectory

The progress signal: **two orthogonal Jev judgments per settled turn** — did it
advance the work, did it reopen something — composed into four outcomes, plus
pure arithmetic over a series of them.

```bash
npm install @mohan-cao/jev-trajectory
```

```ts
import { judgeTrajectory, summarizeProgress } from "@mohan-cao/jev-trajectory";

const judgment = await judgeTrajectory(turns, apiKey, jevConfig);
// { progress: "mixed", advanceConfidence: 0.9, regressConfidence: 0.8 }

summarizeProgress(series, 0.7);
// { counted: 8, advanced: 4, regressed: 3, mixed: 2,
//   advancedRate: 0.5, regressedRate: 0.375, mixedRate: 0.25,
//   net: 0.125, oscillation: 2, longestStall: 3 }
```

## Two questions, not one scale

| `advance?` | `regress?` | outcome |
| --- | --- | --- |
| no | no | `held` |
| yes | no | `advanced` |
| no | yes | `regressed` |
| yes | yes | `mixed` |

A turn can genuinely do both — settle the API shape and reopen the storage
choice — and a single axis cannot say so. **This is the same reason
classification asks two Nouls rather than one Choice**: a single axis makes the
residual compete in an argmax. Forcing a two-dimensional turn onto one line is
the same mistake.

`mixed` is not a failure state. Neither is `regressed`: reopening a detail that
turned out to rest on a false premise is how a wrong premise gets caught.

## There is no `stuck` value

An earlier version classified turns as `converging | stuck_detail | stuck_framing
| early`. The objection that killed it is worth keeping: *if something is in
progress and not converging, is it stuck?* That vocabulary answered yes by
omission — it had no place for a turn that neither advanced nor revisited, and
both `stuck` labels were **verdicts rather than observations**.

Divergence is therefore *recorded, not named*. The reader decides whether a
series is a correction cycle or a spiral; naming it would be the same overreach
as recommending a model.

## The aggregates

| aggregate | reading |
| --- | --- |
| `net` | mean of the −1/0/+1 series, with `mixed` cancelling to zero. Positive means progressing, *even with much still open* |
| `oscillation` | direction reversals. `held` and `mixed` are pauses, not reversals |
| `longestStall` | longest run that did not net forward — `mixed` counts as not netting forward |
| `advancedRate`, `regressedRate` | **marginals**, so they overlap on `mixed`. The gap between `mixedRate` and what independence would predict is the interesting part |

Percentiles and variance are deliberately absent. Over a window this short they
are noise, and over a three-valued series spread is nearly redundant with the
proportions.

## Where the pieces live

- **This package** — the questions, the judge, and pure aggregation. No I/O, no
  state, no rendering.
- **The host** — the window, the reset point, and the wording. The tally is
  cumulative from the last **state transition** and resets to `0/0` there, which
  the host decides because a phase change is not this package's concern.

## Caveats

- **No eval baselines.** The old cases — `detail-spiral`, `framing-loop`,
  `design-open` — were labelled against the retired categories. Until they are
  re-baselined against the rates, this signal is **unvalidated**.
- **The four outcomes may be too coarse, or fine enough.** An ordinal five-point
  scale was considered: it would make the expected value continuous, which makes
  spread meaningful, but only if the judge produces non-uniform distributions.
  **That is measurable** — look at whether the distributions concentrate or
  spread before adding resolution. This signal already flips near-chance at
  three points, so more points are not obviously more information.
- **A turn counts only when both answers are confident.** The gate is on the
  weaker of the two, which keeps one denominator and makes the rates comparable.
  Below it the turn is excluded, not forced to `held`.
- **Sensitivity falls as the stretch lengthens.** A three-turn spiral inside a
  forty-turn stretch barely moves the rates. If that becomes a problem the fix is
  a second, shorter measure alongside this one.
- **Never used in a real session.** Like everything here, it is younger than the
  problem it is meant to observe.

## License

Apache-2.0.
