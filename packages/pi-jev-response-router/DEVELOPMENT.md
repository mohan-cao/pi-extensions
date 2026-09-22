## Why `before_agent_start` instead of rewriting user input?

The classifier runs in Pi's `before_agent_start` hook after skill/template expansion. The selected policy is injected as a named **system-prompt section** (`event.systemPromptOptions.sections["jev-response-policy"]`), while the original user message remains untouched. This avoids making the policy part of user content and works cleanly with normal Pi session history.

### Why sections, not `return { systemPrompt }`

Returning `systemPrompt` replaces the complete prompt for the run. Every time the selected mode changed, the entire provider prompt (including tool declarations) was invalidated, producing a full prompt-cache miss on every turn. Mutating `sections` lets Pi diff and append a minimal patch, preserving the cached prefix. This was the main cause of runaway token cost.

The section is deleted at the start of every turn so a `normal` classification cannot inherit a stale policy from a previous turn.

## Development

This repository is a pnpm workspace (pnpm 10, `lockfileVersion: 9.0`). From the
repository root:

```bash
pnpm install --frozen-lockfile
pnpm build      # pnpm -r build
pnpm test       # pnpm -r test
```

The publish workflow and local development both use pnpm for install/build/test;
only the final `npm publish` uses npm, so that npm trusted publishing (OIDC)
handles authentication and provenance.

For a user-local Pi install directly from the working tree:

```bash
pi install ./packages/pi-jev-response-router
```

Pi installs local packages into user settings by default. Use `-l` only if you want a project-local Pi package registration instead.

To produce an npm tarball:

```bash
pnpm pack:router
```

To publish the scoped package:

1. `npm login`
2. `pnpm build && pnpm test`
3. `pnpm publish:router`
4. Install it with `pi install npm:@your-scope/pi-jev-response-router`.

> npm scoped package syntax is `@scope/package`, not `@scope:package`.
>
> Automated releases use GitHub Actions with npm trusted publishing; see
> [`RELEASING.md`](./RELEASING.md).

## Future Langfuse loop

The current classifier prompt is isolated in `src/prompt.ts`. That is the intended seam for a future Langfuse `getPrompt()` / iterative research process. Replace the static instructions/criteria provider without changing Pi auth, Jev transport, policy injection, or package installation.