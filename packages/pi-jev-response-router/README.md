## @mohan-cao/pi-jev-response-router

pi extension that calls jev bush before each agent run and selects one of three response policies:

- `bounded_verification` at most three concrete claims/questions; answer with correct / partially correct / incorrect plus concise corrections.
- `decomposition_required` important assumptions or tradeoffs materially affect the answer; decompose/normalize first then generate
- `normal` leave Pi's normal response behavior unchanged.

jev is called through its native HTTP api and is not registered as a chat model for obvious reasons. The extension registers an auth-only pi provider so `/login` can store and resolve the jev API key using Pi's normal auth bullshit.

### Install from npm

```bash
pi install npm:@mohan-cao/pi-jev-response-router
```

then start Pi and run `/login`. then select **TypeSafe Jev (response router)** and paste the TypeSafe API key.

you can also provide `TYPESAFE_API_KEY` in the environment... this will be ignored in favour of explicitly stored `/login` keys.

### Commands

```text
/jev-router status
/jev-router on
/jev-router off
/jev-router debug on
/jev-router debug off
/jev-router classify UDP preserves datagram boundaries, right?
```

`/jev-router classify ...` lets you demo the Jev route without invoking the main model.

### Configuration

All configuration is optional:

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | unset | Fallback Jev credential when no `/login` key is stored |
| `PI_JEV_ENDPOINT` | `https://api.typesafe.ai/v1/systemone` | Native System One endpoint |
| `PI_JEV_MODEL` | `jev-latest` | Jev model selector |
| `PI_JEV_ROUTER_TIMEOUT_MS` | `10000` | Per-request HTTP timeout |
| `PI_JEV_ROUTER_RETRIES` | `2` | Retries for HTTP 429/529 |
| `PI_JEV_ROUTER_MIN_CONFIDENCE` | `0` | Ignore specialized routes below this Jev confidence |

The router fails silently and the default answer mode will be picked (if Jev is unavailable, unauthenticated, or returns an invalid schema). Turn on debug notifications if you want failures and route decisions surfaced in the TUI.