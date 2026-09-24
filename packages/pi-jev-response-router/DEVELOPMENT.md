# pi-jev-response-router — design notes and development

## Package layout

Three packages, split on the harness boundary and then per judgment:

| package | contains |
| --- | --- |
| `packages/jev-classifier` | Jev transport, answer parsing, question-spec types, history state. No harness code, no dependencies, no preferences. |
| `packages/jev-phase` | The phase judgment: its question, `judgePhase`, its formatter. |
| `packages/pi-jev-response-router` | Pi hooks, credential provider, session history, preferences, footer status, decision log. The collection. |

`pi-jev-response-router` depends on both component packages. The core never sees a harness: it
takes an API key, conversation history, and a transport config, and returns raw Jev answers. That
is why the core has no dependencies and no thresholds — everything opinionated lives in a
component or in the collection.

**Publish order is derived, not remembered.** changesets publishes in dependency order, so the
core goes first because the graph says so. See [Releasing](#releasing).

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

### Releasing

Releases are driven by [changesets](https://changesets.dev). A push to `main`
either opens or updates a **Version Packages** pull request, or publishes — one
flow, and no hand-written version bumps:

```bash
pnpm changeset          # describe the change; commit the generated file with your PR
pnpm changeset status   # show what the next release will contain
```

Merging the Version Packages PR runs `.github/workflows/publish.yml`, which
publishes every package changesets considers ready — **in dependency order** —
and creates the tags and GitHub releases. Because the graph decides, the
classifier-first ordering is not something anyone has to remember:
`updateInternalDependencies: "patch"` bumps a dependant whenever its dependency
is bumped, and the range itself follows `workspace:^` at pack time. A change to
the classifier therefore releases the router too, without a second commit or a
second tag.

That matters more than convenience. A package whose content changed while its
version did not is **invisible**: `^0.1.0` keeps matching the already-published
`0.1.0`, so the dependant ships against stale behaviour with no install error at
all. That is what broke the `0.4.2` release — the phase/trajectory split never
reached npm, and the coaching hint silently stopped rendering.

Auth is npm trusted publishing (OIDC); there is no `NPM_TOKEN`. Each package
needs its own trusted-publisher entry on npmjs.com, and because npm matches on
the **workflow filename**, renaming `publish.yml` means updating every entry. A
package's *first* publish cannot use OIDC — npm requires the package to exist
before a publisher can be configured for it — so bootstrap that one with a local
`npm login && npm publish`.

**A new package must be bootstrapped before it can be released.** changesets
publishes any workspace package whose version is not on the registry, so an
unpublished new package makes the next publish run attempt a first publish it
cannot authenticate — failing the whole release, not just that package.

changesets enforces the consequence for you: skipping a package requires skipping
everything that depends on it, or it reports an invalid tree. So while
`@mohan-cao/jev-phase` is unpublished, it and `@mohan-cao/pi-jev-response-router`
are both in `ignore`, which excludes them from versioning and publishing.
**That means the router cannot be released until the bootstrap happens.**

To unblock, in order:

1. `npm login && npm publish` from `packages/jev-phase` (the first publish of a
   package cannot use OIDC, because npm requires the package to exist before a
   trusted publisher can be configured for it).
2. Add its trusted-publisher entry on npmjs.com — workflow filename `publish.yml`.
3. Remove **both** entries from `ignore` in `.changeset/config.json`.
4. Add a changeset, so the core, the new package, and the router are released in
   dependency order in one go.

Do not set `NPM_TOKEN`, or any `_authToken` in `.npmrc`: a statically configured
token makes npm skip its OIDC exchange, which surfaces as a misleading `404` on
publish rather than an auth error.

## Future Langfuse loop

The classifier prompts are isolated in `src/prompt.ts`. That is the intended
seam for a future Langfuse `getPrompt()` / iterative research process. Replace
the static question specs without changing Pi auth, Jev transport, policy
injection, or package installation. Thresholds should only be tuned against a
labeled eval set, not by intuition.
