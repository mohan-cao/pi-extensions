# pi-extensions

:3

welcome... to my abode..

my collection of slop..

## Packages

| package | what it is |
| --- | --- |
| [`@mohan-cao/jev-classifier`](./packages/jev-classifier) | Harness-agnostic System One (Jev) classifier: request classification, response-shaping policies, and post-generation verification. No harness code, no dependencies. |
| [`@mohan-cao/pi-jev-response-router`](./packages/pi-jev-response-router) | Pi extension that applies the classifier — hooks, credential storage, session history, and footer status. |

## How they fit together

```text
pi-jev-response-router              (Pi harness)
  ├─ before_agent_start  →  classifyWithJev  →  policyFor / premisePolicyFor
  │                                            →  system-prompt section
  └─ agent_settled       →  verifyResponse   →  formatVerifyStatus
                                               →  footer status

jev-classifier                      (harness-agnostic)
  questions · classify · verify · policies · cache
```

The core never sees a harness. It takes an API key, conversation history, and a config, and
returns decisions. Credential storage, session access, and rendering stay in the harness — which
is why `jev-classifier` has no dependencies and `pi-jev-response-router` has no classification
logic. See each package's README for the details.

## Development

This repository is a pnpm workspace (pnpm 10, `lockfileVersion: 9.0`). From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build      # pnpm -r build
pnpm test       # pnpm -r test
```

### Pre-push smoke test

```bash
pnpm smoke                 # or: node scripts/smoke.mjs
pnpm smoke -- --runtime=wsl
pnpm smoke -- --keep       # leave the sandbox behind for inspection
pnpm smoke -- --no-build   # skip the build (faster, packs dist as-is)
```

Unit tests import from `dist` in the workspace. `pnpm smoke` is the other end: it packs both
packages, installs them into a throwaway Pi agent directory, drives a real `pi --mode rpc`
process, and asserts on what the extension prints. It exits non-zero on the first failure.

Backends, cheapest first — auto-detected unless you pass `--runtime`:

| Runtime | What it runs in | Notes |
| --- | --- | --- |
| `docker` / `podman` | `node:<major>-slim` | Full OS isolation |
| `wsl` | The existing WSL distro | Unpacks a portable node into `~/.cache/pi-smoke` on first use; no root needed |
| `none` | The host, in temp dirs | No extra deps; still uses a clean agent dir |

`none` is not a degraded mode: a fresh `PI_CODING_AGENT_DIR` plus a fresh npm prefix already
gives you the isolation that matters (packed artifact, no stale preferences, no workspace
resolution). The container backends add OS isolation on top, which is what catches
"works on my machine".

No credentials and no model calls, so it is deterministic and safe to run before every push.

Releases are **per-package**. Bump only the package you are releasing, then tag it with
`<package-name>@<version>`:

```bash
git checkout main && git pull
git tag "@mohan-cao/jev-classifier@0.1.0"
git push origin "@mohan-cao/jev-classifier@0.1.0"
```

Publish order matters: `jev-classifier` first, then `pi-jev-response-router`, since the latter
depends on it. See
[`packages/pi-jev-response-router/DEVELOPMENT.md`](./packages/pi-jev-response-router/DEVELOPMENT.md)
for the full release workflow and the eval harness.
