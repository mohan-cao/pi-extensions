# pi-jev-response-router — design notes and development

## Package layout

Two packages, split on the harness boundary:

| package | contains |
| --- | --- |
| `packages/jev-classifier` | questions, transport, classification, policies, verification, cache. No harness code, no dependencies. |
| `packages/pi-jev-response-router` | Pi hooks, credential provider, session history, preferences, footer status. |

`pi-jev-response-router` depends on `@mohan-cao/jev-classifier`. The core never sees a harness:
it takes an API key, conversation history, and a config, and returns decisions. That is why the
core has no dependencies and this package has no classification logic.

**Publish order matters** — `jev-classifier` first, then `pi-jev-response-router`.

## Why `before_agent_start` instead of rewriting user input?

The classifier runs in Pi's `before_agent_start` hook after skill/template
expansion. The selected policy is injected as a named **system-prompt section**
(`event.systemPromptOptions.sections["jev-response-policy"]`), while the original
user message remains untouched. This avoids making the policy part of user
content and works cleanly with normal Pi session history.

### Why sections, not `return { systemPrompt }`

Returning `systemPrompt` replaces the complete prompt for the run. Every time the
selected mode changed, the entire provider prompt (including tool declarations)
was invalidated, producing a full prompt-cache miss on every turn. Mutating
`sections` lets Pi diff and append a minimal patch, preserving the cached prefix.
This was the main cause of runaway token cost.

The section is deleted at the start of every turn so a `normal` classification
cannot inherit a stale policy from a previous turn.

### Why two Noul questions instead of one Choice

A single 3-way Choice makes `normal` a competing argmax candidate. A
decomposition-shaped request where `normal` scored 0.40 and
`decomposition_required` scored 0.35 was routed to `normal`. Two orthogonal Noul
signals composed in code keep `normal` as the residual, and give decomposition
explicit precedence. Asymmetric thresholds (a higher bar for bounded
verification than for decomposition) match the asymmetry of the failure modes.

### Why history is included

`state` originally contained only `event.prompt`, so follow-ups such as "what
about the second one?" were unclassifiable in isolation. `recentHistory()` adds a
bounded slice of the current branch (default 4 turns, 2k chars per turn) so Jev
input cost stays flat.

### Verification

Verification runs in `agent_settled` (the final, non-reentrant boundary), reads
the last complete exchange from the session branch, and writes a footer status
via `ctx.ui.setStatus`. It is deliberately **verify-only**: no retry, no rewrite.
Partial (`aborted`/`error`) answers are not verified, and the Jev call is skipped
when no UI exists to render the result.

Open question for a future retry mechanism: `turn_end` / `agent_before_settle`
can `context_edit` the answer to `null` and inject a replacement instruction with
`continue: true`, but Pi's docs warn that unconditional continuation loops. A
retry design needs a per-turn attempt counter and a clear stopping rule.

## Development

This repository is a pnpm workspace (pnpm 10, `lockfileVersion: 9.0`). From the
repository root:

```bash
pnpm install --frozen-lockfile
pnpm build      # pnpm -r build
pnpm test       # pnpm -r test
```

The publish workflow uses pnpm for install/build/test and for `pnpm pack`, which
rewrites the `workspace:` protocol to a concrete range. The packed tarball is then
published with `npm publish`, so npm trusted publishing (OIDC) handles
authentication and provenance.

Packing with pnpm is **not optional**. `npm publish` ships `workspace:` verbatim,
and no npm consumer can resolve it — installing the result fails with
`EUNSUPPORTEDPROTOCOL`. The workflow verifies the packed manifest and fails if any
`workspace:` range survives.

For a user-local Pi install directly from the working tree:

```bash
pi install ./packages/pi-jev-response-router
```

Pi installs local packages into user settings by default. Use `-l` only if you
want a project-local Pi package registration instead.

To produce an npm tarball:

```bash
pnpm pack:router
```

To publish the scoped package manually:

1. `npm login`
2. `pnpm build && pnpm test`
3. `pnpm publish:router`
4. Install it with `pi install npm:@your-scope/pi-jev-response-router`.

> npm scoped package syntax is `@scope/package`, not `@scope:package`.

### Releasing via GitHub Actions

Releases are per-package. Bump only the package you are releasing, then tag it
with `<package-name>@<version>`:

```bash
git checkout main && git pull
git tag "@mohan-cao/pi-jev-response-router@0.2.0"
git push origin "@mohan-cao/pi-jev-response-router@0.2.0"
```

`.github/workflows/publish.yml` resolves the package from the tag
(`scripts/resolve-package.mjs`), asserts the tag version matches the manifest,
builds and tests only that package, then publishes it with npm trusted
publishing (OIDC, no token, provenance attached).

A repo-wide `v*` tag does **not** trigger a release, and releasing one package
never requires bumping or tagging the others. Each package needs its own
one-time trusted-publisher entry on npmjs.com pointing at `publish.yml`.

Because `pi-jev-response-router` depends on `jev-classifier`, publish the core
first — otherwise the extension installs against a version that is not on the
registry yet.

That order is **derived from the workspace graph**, not transcribed: `node
scripts/check-versions.mjs` reads the packages from pnpm and sorts them
`workspace:` dependency first, so adding a package needs no change here. (It is
also what `pnpm -r build` already does — `pnpm -r run` is topologically sorted by
default.)

Run it before tagging:

```bash
node scripts/check-versions.mjs              # step + content, exits non-zero on failure
node scripts/check-versions.mjs --audit      # also replay published history
node scripts/check-versions.mjs --no-content # skip the network-heavy check
```

It checks three things, and they fail independently:

- **step** — the local version has not gone backwards and has advanced by at
  most one component. Satisfied by never bumping, so it is a sanity net only.
- **content** — what `pack` produces for a version matches what npm published at
  that version. **This is the load-bearing one.**
- **audit** — replays the published history against the `step` rule, so the rule
  is validated against releases that already happened rather than asserted.

The failure worth understanding is not a missing dependency but a package whose
**content changed while its version did not**. Nothing then resolves to the new
code — `^0.1.0` keeps matching the already-published `0.1.0`, because
`pnpm publish` skips versions already in the registry — so the dependant ships
against stale behaviour with no install error at all. That is what broke the
`0.4.2` release: the phase/trajectory split never reached npm, so the coaching
hint silently stopped rendering.

So: **if a package's packed content changes, its version must change.** The
range in the dependant follows automatically from `workspace:^` at pack time, so
bump the core and the extension together.

Expects a clean `dist`; a fresh CI checkout is clean by construction, and on a
long-lived local tree run `pnpm -r clean && pnpm -r build` first, or stale
compiled output from a moved file reads as a content difference.

## Future Langfuse loop

The classifier prompts are isolated in `src/prompt.ts`. That is the intended
seam for a future Langfuse `getPrompt()` / iterative research process. Replace
the static question specs without changing Pi auth, Jev transport, policy
injection, or package installation. Thresholds should only be tuned against a
labeled eval set, not by intuition.
