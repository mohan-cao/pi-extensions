# Releasing `@mohan-cao/pi-jev-response-router`

Publishing runs on GitHub Actions via **npm trusted publishing (OIDC)**. There is
no `NPM_TOKEN` secret to create, rotate, or leak: GitHub mints a short-lived
OIDC token, and npm exchanges it for a workflow-scoped publish credential.
Provenance attestations are generated automatically.

## One-time setup

The package already exists on npm (first published manually at `0.1.0`/`0.1.1`),
so trusted publishing can be configured immediately. (npm requires the package to
exist before the Trusted Publisher UI is available.)

1. Go to npmjs.com → **Packages** → `@mohan-cao/pi-jev-response-router` →
   **Settings** → **Trusted publishing**.
2. Click **GitHub Actions** and fill in:
   - **Organization or user**: `mohan-cao`
   - **Repository**: `pi-extensions`
   - **Workflow filename**: `publish.yml` (filename only, must match exactly)
   - **Allowed actions**: enable **`npm publish`** (staging is always allowed)
3. Save.

`package.json` must contain a `repository.url` that exactly matches the GitHub
repo, or the publish will be rejected. This is already set on
`packages/pi-jev-response-router/package.json`:

```json
"repository": {
  "type": "git",
  "url": "git+https://github.com/mohan-cao/pi-extensions.git",
  "directory": "packages/pi-jev-response-router"
}
```

### Recommended hardening (after the first CI publish succeeds)

npmjs.com → package → **Settings** → **Publishing access** → select
**"Require two-factor authentication and disallow tokens"**. This blocks
traditional token publishing while leaving trusted publishing (OIDC) working.

## Release flow

1. **Merge** the feature PRs into `main`.
2. **Bump the version** in
   `packages/pi-jev-response-router/package.json` (e.g. `0.3.0`) in a PR and
   merge it.
3. **Tag and push** — the tag must be `v` + the exact package version:

   ```bash
   git checkout main && git pull
   git tag v0.3.0
   git push origin v0.3.0
   ```

4. The `Publish to npm` workflow runs `npm ci`, verifies the tag matches the
   package version, builds, tests, and publishes. Watch it under the repo's
   **Actions** tab.

The tag/version guard means a mismatched tag fails fast instead of publishing
the wrong version.

## Manual fallback

If CI is unavailable, publish locally (requires an interactive 2FA prompt or a
granular access token):

```bash
npm login
pnpm install --frozen-lockfile
npm run build && npm test
npm run publish:router        # npm publish ./packages/pi-jev-response-router --access public
```

`prepack` rebuilds automatically. Prefer the CI path so provenance is attached.

## Why not a long-lived token?

Legacy npm tokens were removed in November 2025; only granular access tokens
remain. Trusted publishing is preferred because the credential is short-lived,
scoped to this exact workflow, and cannot be exfiltrated from CI logs or secrets.
