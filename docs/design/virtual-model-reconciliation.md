# Phase routing as a virtual model

**Status:** accepted design, not built.

This document decides how the phase signal reaches the model-selection
decision. It supersedes the routing parts of
[`phase-recommendation.md`](./phase-recommendation.md) and adopts the
[first-party jev-router example](https://github.com/earendil-works/pi/blob/main/examples/extensions/jev-router.ts)
shape. All `jev-*` packages keep their contracts. The same tables apply to
[`virtual-models.md`](https://github.com/earendil-works/pi/blob/main/docs/virtual-models.md)
of pi 1.5.0.

## The problem

The phase signal judges once per agent run at run end. It predicts the next
turn's work type from up to eight prior turns. Measured over 327 logged turns:

- 47.5 % of judgments fall below the 0.7 render threshold. The footer stays
  dark.
- 24.5 % of judgments carry an actionable model recommendation.
- 33 % of adjacent turns change phase, so a third of the advice is stale when
  the user reads it.

The judgment arrives after the turn it describes. The decision it informs
happens before the next turn. The first-party example avoids this: it judges
the incoming prompt at the request boundary, commits the choice to router
state, and stops judging. This design moves the phase judgment to the same
moment without losing its semantics.

## The decision in one sentence

Register one virtual model. Judge the phase at the start of each user-driven
run with the same question, the same state payload, and the same confidence
scale. Record the judgment in router state every run. Switch the dispatched
model slowly, under damping.

## Registration and authentication

Register a virtual model with `registerVirtualModel`.

| field | value |
| --- | --- |
| `provider` | `jev` |
| `id` | `auto` |
| `name` | `Jev auto (phase)` |

Registration happens under the `jev` provider ID, which no catalog provider
uses. The virtual model is therefore always listed, and the code owns
availability instead of inheriting it.

The extension deletes its auth-only provider. `registerJevAuthProvider` and
`provider.ts` go. The two authentication entries for one key become one: the
built-in `typesafe` provider entry, or whichever provider the user is signed
into.

The classifier model is resolved at call time by a credential-first scan.

1. List the catalog's classifier models of every provider.
2. Keep the jev classifiers whose provider holds credentials.
3. Return the first in this preference order: `typesafe`, `opencode`,
   `vercel-ai-gateway`, `cloudflare-workers-ai`, `openrouter`.
4. `PI_JEV_CLASSIFIER` overrides the order with one `provider/model` pair.

The scan result is cached for the session. It is invalidated once when a call
fails. Resolution happens inside `route()`, so no extension API key handling
remains.

## The classification call

`route()` judges only on `reason === "user"`. It runs once per user-driven
run, the same cadence the run-end judgment had.

The call reuses `judgePhase` unchanged. The state payload is built from
`request.messages` with the same flattening rules as the run-end path:

- up to eight turns, `PI_JEV_PHASE_HISTORY_TURNS` still controls the count;
- every turn clamped to 2 000 characters;
- the current user prompt included in `user_request`.

A System One choice question answers with a full distribution
(`probabilities` per option). `PhaseJudgment` gains that distribution next to
`phaseConfidence`. The damping rule consumes it.

## Assessment against dispatch

The judgment and the model switch are two consumers of one answer. This
separation is the core rule of the design.

**Assessment. Router state always records the newest judgment.** The phase,
its confidence, and its distribution go into state on every user-driven run,
and the footer reads state. The footer stays as truthful as the run-end
signal. A weak judgment updates the assessment and changes nothing else.

**Dispatch. The model switches only under all of these conditions.**

1. A route exists for the judged phase in the route table.
2. The judged phase differs from the incumbent phase, or no incumbent phase
   exists yet.
3. `p(new phase)` is at or above `phaseConfidenceThreshold`, 0.7 by default.
4. `p(new phase)` exceeds `p(incumbent phase)` in the same new judgment by at
   least 0.15.
5. The previous run made no switch. The first switch of a session needs no
   confirmation.

Condition 4 is the margin rule. A switch between two confident answers in
different phases needs the loser to lose by more than 0.15. Conditions 1 to 4
still let two strong wins alternate. Condition 5 adds dwell: a run that
switched holds the new phase for at least one further run before another
switch. Assessment keeps updating throughout; only the committed model lags.

A weak judgment below the threshold keeps the incumbent model and records
`holdReason: "below-threshold"` in state. There are four hold reasons:
`below-threshold`, `thin-margin`, `confirm-pending`, and `no-route`.

## Dispatch targets

Route targets come from the existing sources, in this order: preferences
written by `/jev-router route`, then `PI_JEV_PHASE_BUILD_MODEL`,
`PI_JEV_PHASE_DESIGN_MODEL`, and `PI_JEV_PHASE_GENERAL_MODEL`. The route table
is unchanged.

| situation | dispatch |
| --- | --- |
| `reason === "user"`, assignment satisfied | physical model for the phase |
| phase has no route | incumbent model, or `previous` on the first run |
| `reason === "continuation"` or `"retry"` | `previous` or `failed`, never a fresh judgment |
| `reason === "direct"` | `previous`, else the `general` route, else the first credentialed model of the route table |

Targets are checked for credentials before return. A target without
credentials falls back to the incumbent model. `route()` throws only when no
credentialed model exists at all, because a throw errors the request.

Prompt-cache effects decide the cadence. Every provider holds its own cache,
and nothing shares across models. The dispatch rules above keep switches at
user-run boundaries, the natural cold point, and make the steady state one
model per run. A discussion of the miss costs belongs to the telemetry run,
not to the dispatcher.

## Behaviour of the two modes

**Auto mode.** The user selects `jev/auto`. Dispatch follows the rules above.
The `jev-next` footer shows the state's phase and confidence. The run-end
nudge stands down, because pi renders the physical model next to the
selection natively.

**Manual mode.** The user selects a physical model. Routing is absent. The
`agent_settled` path runs unchanged: turn-end phase judgment, nudge, verify,
trajectory, tally, and the decision log.

Every judgment, signal, and command in the repo works in both modes. The
progress tally reads the phase from router state in auto mode and from the
run-end judgment in manual mode.

## Telemetry

The decision log record gains fields.

| field | value |
| --- | --- |
| `phaseDispatched` | the dispatched model ID, absent on hold |
| `phaseHoldReason` | one of the four hold reasons, absent on dispatch |
| `classifierProvider` | the provider of the resolved classifier |

The record keeps the assessed phase, its confidence, and its distribution.
Routing value is therefore measurable from existing sessions without a
dedicated harness.

## What is not designed here

- The verify-correlation measurement. It tests whether phase-routed models
  verify better than un-routed ones. It stays open until the routing ships.
- Changes to the classification signal, the bounded-verification scope, or
  the progress signal. They are unaffected.
- A phase wordings re-run against prompt-shaped inputs. It happens before
  this design ships, through `scripts/jev-eval.mjs --phase-only`.
