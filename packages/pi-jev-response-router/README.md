# @mohan-cao/pi-jev-response-router

pi extension that calls Jev before each agent run, selects a response policy, and
verifies the final answer.

- `bounded_verification` — at most three concrete claims/questions; answer with
  correct / partially correct / incorrect plus concise corrections.
- `decomposition_required` — important assumptions or tradeoffs materially affect
  the answer; decompose first, then synthesize.
- `normal` — leave Pi's normal response behavior unchanged.

Jev is called through its native HTTP API and is not registered as a chat model
for obvious reasons. The extension registers an auth-only pi provider so `/login`
can store and resolve the Jev API key using Pi's normal auth flow.

### How routing works

Rather than one mutually exclusive 3-way Choice (where `normal` competes in the
argmax), the classifier asks **narrow, independently evaluated questions**:

1. `requires_decomposition` — does a reliable answer require decomposition?
2. `bounded_verification` — is this at most three independently checkable claims?
3. `premise_defect` (Score 0–3) — does the request presuppose something false, or
   true only under a narrower framing than it implies?

The mode is composed in code with **decomposition taking precedence** and
`normal` as the residual, which keeps decomposition-shaped requests from being
misrouted as normal. `requires_decomposition` judges the current request only, so
an earlier answer's verbosity cannot inflate the score.

The selected policy is injected as a named **system-prompt section**
(`jev-response-policy`), so Pi emits a minimal prompt patch and the provider
cache prefix survives. (Returning `systemPrompt` would replace the whole prompt
on every mode change, i.e. a full cache miss.)

### Premise correction

`premise_defect` is a **modifier**, not a mode, so it composes with any response
shape. Above `PI_JEV_ROUTER_PREMISE_THRESHOLD` (default `2.8` of 3) a second
section (`jev-premise-policy`) asks the model to state the correction in one
sentence before answering. It is deliberately not applied to
`bounded_verification`, which already emits a verdict and corrections.

Level 2 of the scale ("worth naming, but the request is still answerable") is
logged but never acted on by default — that is the band for minor slips in
wording rather than wrong beliefs.

### Verification (signal only)

After a run settles, the final answer is sent back to Jev: does it address the
request, does it avoid committing where a position was called for, and did it
meet its obligation — correcting a false premise or surfacing the inputs the
answer actually depends on. The result is surfaced as a footer status:

- `🤷 evasive` — the answer dodged or did not commit
- `🚩 unmet` — technically true but it did not do the required work

The footer preference selects the rendering: `compact` (icon + label, default),
`icons` (glyph only), or `off`.

This is **verify-only**: it never retries or rewrites the answer. Retry is
deliberately out of scope for now.

### Two independent footer signals

Both run after generation, in parallel with verification. They are separate features with
separate toggles, because they are **orthogonal** — you can be stuck while implementing, or
framing a problem badly during general conversation.

**Model nudge** (`/jev-router phase on|off`) — what kind of work is next, and whether your
running model suits it:

- `↪ build · <model>` — the work moved; switch when you want to

Fires only when the running model is *known* to serve a different phase; an unmapped model
yields no nudge. It **never switches models and never blocks a prompt** — switch with `/model`,
and the nudge clears itself. Inert without routes configured.

**Coaching hint** (`/jev-router coaching on|off`) — is this conversation progressing?

- `♾️ paralysis` — analysis paralysis; consider zooming out
- `🖼️ framing` — the framing is the blocker, not the effort

Display-only. It never gates the model nudge and never changes routing.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PI_JEV_PHASE_BUILD_MODEL` | unset | Model that serves the `build` phase |
| `PI_JEV_PHASE_DESIGN_MODEL` | unset | Model that serves the `design` phase |
| `PI_JEV_PHASE_GENERAL_MODEL` | unset | Model that serves the `general` phase |
| `PI_JEV_PHASE_CONFIDENCE_THRESHOLD` | `0.7` | Minimum confidence before a model nudge |
| `PI_JEV_PHASE_HISTORY_TURNS` | `8` | Conversation turns supplied to the phase judge |
| `PI_JEV_TRAJECTORY_THRESHOLD` | `0.7` | Minimum confidence before a coaching hint |
| `PI_JEV_TRAJECTORY_HISTORY_TURNS` | `8` | Conversation turns supplied to the trajectory judge |

### Decision log

On by default: one JSON line per settled turn at `~/.pi/agent/jev-decisions.jsonl`
(`/jev-router log on|off`). It records **judgments, not conversation text** — the classification
mode and signals, the verification result, the phase and trajectory judgments, and the model
that answered.

Acceptance of a model nudge is derived by diffing consecutive records: if `recommendedModel` at
turn N equals `modelRunning` at turn N+1, the nudge was acted on. That is the only correctness
proxy available without hand-labelling — and it only produces data when routes are configured,
since without them no nudge ever fires.

### Install from npm

```bash
pi install npm:@mohan-cao/pi-jev-response-router
```

then start Pi and run `/login`, select **TypeSafe Jev (response router)** and
paste the TypeSafe API key.

You can also provide `TYPESAFE_API_KEY` in the environment. An explicitly stored
`/login` key takes precedence.

### Commands

```text
/jev-router help
/jev-router status
/jev-router on
/jev-router off
/jev-router verify on
/jev-router verify off
/jev-router phase on
/jev-router phase off
/jev-router coaching on
/jev-router coaching off
/jev-router log on
/jev-router log off
/jev-router debug on
/jev-router debug off
/jev-router footer compact
/jev-router footer icons
/jev-router footer off
/jev-router clear-cache
/jev-router classify UDP preserves datagram boundaries, right?
```

`/jev-router classify ...` lets you demo the Jev route without invoking the main
model.

### Configuration

All configuration is optional:

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | unset | Fallback Jev credential when no `/login` key is stored |
| `PI_JEV_ENDPOINT` | `https://api.typesafe.ai/v1/systemone` | Native System One endpoint |
| `PI_JEV_MODEL` | `jev-latest` | Jev model selector |
| `PI_JEV_ROUTER_TIMEOUT_MS` | `5000` | Per-request HTTP timeout |
| `PI_JEV_ROUTER_RETRIES` | `2` | Retries for HTTP 429/529 |
| `PI_JEV_ROUTER_DECOMPOSITION_THRESHOLD` | `0.6` | P(decomposition) at or above which decomposition wins |
| `PI_JEV_ROUTER_BOUNDED_THRESHOLD` | `0.6` | P(bounded verification) at or above which bounded verification wins |
| `PI_JEV_ROUTER_PREMISE_THRESHOLD` | `2.8` | Expected premise defect (0-3) at or above which the premise is corrected |
| `PI_JEV_ROUTER_HISTORY_TURNS` | `4` | Prior turns included in Jev state (0 disables) |
| `PI_JEV_ROUTER_CACHE_TTL_MS` | `300000` | Classification cache TTL (0 disables) |
| `PI_JEV_ROUTER_CACHE_MAX` | `64` | Classification cache entry cap |
| `PI_JEV_ROUTER_VERIFY` | `true` | Post-generation verification on by default |
| `PI_JEV_ROUTER_VERIFY_EVASIVE_THRESHOLD` | `0.6` | P(evasive) at or above which to flag the answer as evasive |
| `PI_JEV_ROUTER_VERIFY_ANSWERS_THRESHOLD` | `0.35` | P(answers the request) at or below which to flag the answer as evasive |
| `PI_JEV_ROUTER_VERIFY_OBLIGATION_THRESHOLD` | `1.5` | Expected obligation failure (0-3) at or above which to flag the answer as unmet |

`PI_JEV_ROUTER_MIN_CONFIDENCE` is deprecated. In `0.1.x` it was effectively a
no-op (confidence is in `[0, 1]` and the default was `0`). It now serves as a
shared fallback default for the two real thresholds when they are unset.

### Persisted preferences

`/jev-router on|off`, `debug`, `verify`, and `footer` write to a small JSON file
under the agent config directory, so they survive `/reload` and new sessions:

```text
~/.pi/agent/pi-jev-response-router.json
{
  "enabled": true,
  "debug": false,
  "verify": true,
  "footer": "compact"
}
```

The path honors `PI_CODING_AGENT_DIR`. A missing or corrupt file falls back to
the environment defaults. Only runtime toggles persist; endpoint, model,
thresholds, and routes stay in the environment. Precedence is
**file > environment > default**, so a command is durable while an env var still
works as a one-shot override when no file exists.

`footer` selects how footer statuses render — `compact` (icon + label, default),
`icons` (glyph only), or `off`. It is reserved for the work-phase and coaching
statuses and has no effect on the current quality status yet.

The router fails silently: if Jev is unavailable, unauthenticated, or returns an
invalid schema, Pi answers normally. Turn on debug notifications to surface
failures and route decisions in the TUI.
