## Why `before_agent_start` instead of rewriting user input?

The classifier runs in Pi's `before_agent_start` hook after skill/template expansion. The selected policy is appended to the **system prompt for that run**, while the original user message remains untouched. This avoids making the policy part of user content and works cleanly with normal Pi session history.

## Development

This repository is an npm workspace. From the repository root:

```bash
npm install
npm run build
npm test
```

For a user-local Pi install directly from the working tree:

```bash
pi install ./packages/pi-jev-response-router
```

Pi installs local packages into user settings by default. Use `-l` only if you want a project-local Pi package registration instead.

To produce an npm tarball:

```bash
npm run pack:router
```

To publish the scoped package:

2. `npm login`
3. `npm run build && npm test`
4. `npm run publish:router`
5. Install it with `pi install npm:@your-scope/pi-jev-response-router`.

> npm scoped package syntax is `@scope/package`, not `@scope:package`.

## Future Langfuse loop

The current classifier prompt is isolated in `src/prompt.ts`. That is the intended seam for a future Langfuse `getPrompt()` / iterative research process. Replace the static instructions/criteria provider without changing Pi auth, Jev transport, policy injection, or package installation.