# pi-extensions

:3

welcome... to my abode..

my collection of slop..

## @mohan-cao/pi-jev-response-router

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
argmax), the classifier asks **two narrow Noul questions**:

1. `requires_decomposition` — does a reliable answer require decomposition?
2. `bounded_verification` — is this at most three independently checkable claims?

The mode is then composed in code with **decomposition taking precedence**, and
`normal` as the residual. This is what keeps decomposition-shaped requests from
being misrouted as normal.

The selected policy is injected as a named **system-prompt section**
(`jev-response-policy`), so Pi emits a minimal prompt patch and the provider
cache prefix survives. (Returning `systemPrompt` would replace the whole prompt
on every mode change, i.e. a full cache miss.)

### Verification (signal only)

After a run settles, the final answer is sent back to Jev for three Noul
judgments: does it answer the request, is it vague/hedged, and is the problem
genuinely tricky. The result is surfaced as a footer status:

- `💡 possible vagueness` — evasive or unresponsive answer
- `💡 genuinely tricky` — the problem probably needed decomposition

This is **verify-only**: it never retries or rewrites the answer. Retry is
deliberately out of scope for now.

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
/jev-router status
/jev-router on
/jev-router off
/jev-router verify on
/jev-router verify off
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
| `PI_JEV_ROUTER_DECOMPOSITION_THRESHOLD` | `0.5` | P(decomposition) at or above which decomposition wins |
| `PI_JEV_ROUTER_BOUNDED_THRESHOLD` | `0.6` | P(bounded verification) at or above which bounded verification wins |
| `PI_JEV_ROUTER_HISTORY_TURNS` | `4` | Prior turns included in Jev state (0 disables) |
| `PI_JEV_ROUTER_CACHE_TTL_MS` | `300000` | Classification cache TTL (0 disables) |
| `PI_JEV_ROUTER_CACHE_MAX` | `64` | Classification cache entry cap |
| `PI_JEV_ROUTER_VERIFY` | `true` | Post-generation verification on by default |
| `PI_JEV_ROUTER_VERIFY_EVASIVE_THRESHOLD` | `0.6` | P(evasive) at or above which to flag vagueness |
| `PI_JEV_ROUTER_VERIFY_ANSWERS_THRESHOLD` | `0.35` | P(answers the request) at or below which to flag vagueness |
| `PI_JEV_ROUTER_VERIFY_TRICKY_THRESHOLD` | `0.6` | P(genuinely tricky) at or above which to flag |

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
