# @mohan-cao/jev-trajectory

The progress signal: one signed Jev judgment per settled turn — did it **advance**
the work, **hold**, or **reopen** something — plus pure arithmetic over a series of
those judgments.

```bash
npm install @mohan-cao/jev-trajectory
```

```ts
import { judgeTrajectory, summarizeProgress } from "@mohan-cao/jev-trajectory";

const judgment = await judgeTrajectory(turns, apiKey, jevConfig);
// { progress: "advanced", progressConfidence: 0.83 }

summarizeProgress(series, 0.7);
// { counted: 8, advanced: 3, net: 0.25, oscillation: 1, longestStall: 2, regressedShare: 0.125 }
```

## This is a redesign, and the old vocabulary is gone

An earlier version classified each turn as `converging`, `stuck_detail`,
`stuck_framing`, or `early`. That was wrong, and the objection that killed it is
worth keeping: **if something is in progress and not converging, is it stuck?**

The old vocabulary answered yes by omission. It had `converging` and two flavours
of `stuck`, so a turn that neither advanced nor revisited had nowhere to go — and
both `stuck` labels were **verdicts rather than observations**. A component that
supplies a datum should not also supply the diagnosis.

### There is no `stuck` value

`regressed | held | advanced` are the only outcomes, and `held` is not a failure
state: a clarifying question, an agreed scope, or waiting on something all hold.

### Divergence is legitimate

Two cases prompted the redesign, and they behave differently:

- **Reopening on new information** — a detail believed settled turns out to rest
  on a false premise. This is how a wrong premise gets caught, and `regressed` is
  the honest record of it.
- **Disagreement** between the user and the model. Productive, and it looks
  exactly like a loop from the text.

Neither is named. `regressed` records that it happened; the reader decides whether
it was a correction or a spiral. Naming it would be the same overreach as
recommending a model.

### The aggregates are descriptive

| aggregate | reading |
| --- | --- |
| `net` | mean of the −1/0/+1 series. Positive means progressing, *even with much still open* |
| `oscillation` | direction reversals. A framing loop shows up here, not as a category |
| `longestStall` | longest run of `held` or `regressed` — no net progress for that many turns, stated as a fact |
| `regressedShare` | high alongside high `advanced` is a healthy correction cycle; alone it is a spiral |

Percentiles and variance are deliberately absent. Over a window this short they
are noise, and over a signed series spread is nearly redundant with the
proportions.

## Where the pieces live

- **This package** — the question, the judge, and pure aggregation. No I/O, no
  state, no rendering.
- **The host** — the window, the reset point, and the wording. The tally is
  cumulative from the last **state transition** and resets to `0/0` there, which
  the host decides because a phase change is not this package's concern.

## Caveats

- **No eval baselines.** The old cases — `detail-spiral`, `framing-loop`,
  `design-open` — were labelled against the retired categories and need
  re-baselining against the series. Until that happens this signal is
  **unvalidated**.
- **Sensitivity falls as the stretch lengthens.** A three-turn spiral inside a
  forty-turn stretch barely moves the tally. If that becomes a problem the fix is
  a second, shorter measure alongside this one.
- **Below the confidence gate, a turn is excluded** — neither number moves. It is
  not forced to `held`, which would inflate the denominator with turns the judge
  could not read.
- **Never used in a real session.** Like everything here, it is younger than the
  problem it is meant to observe.

## License

Apache-2.0.
