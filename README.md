# pi-extensions

Welcome to my abode! Signal packages for the TypeSafe Jev classifier, and one
pi extension that applies them.

Each turn of a pi coding session gets classified before the run and judged
after it. The classification pins a policy into the system prompt. The
post-run signals read as footer indicators.

## How it fits together

- **[`@mohan-cao/jev-classifier`](./packages/jev-classifier)** Transport to the
  Jev API: one System One call, the answer parsers, the question vocabularies, and
  config. No policies, no thresholds, no harness code.
- **[`@mohan-cao/jev-classify`](./packages/jev-classify)** What shape the current
  request's response needs, and the policy for that shape.
- **[`@mohan-cao/jev-phase`](./packages/jev-phase)** What kind of work the
  conversation needs next, as a footer indicator.
- **[`@mohan-cao/jev-verify`](./packages/jev-verify)** Whether a completed
  response addressed the request, as a footer indicator.
- **[`@mohan-cao/jev-trajectory`](./packages/jev-trajectory)** Whether the work
  advanced, held, or was reopened, as a rate over turns.
- **[`@mohan-cao/pi-jev-response-router`](./packages/pi-jev-response-router)** The
  pi extension. It wires the signals to pi events, commands, and status bar. It
  owns no judgment of its own.

The signal packages call the Jev API only and hold no harness code. The
extension owns everything pi: credentials, session history, system prompt
sections, and the footer.

## Development

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Releases run through changesets. Add a changeset beside the change, merge the
branch to `main`, then merge the `Version Packages` pull request that opens.

```sh
pnpm changeset
```

Question and threshold calibration runs against the live API through
`scripts/jev-eval.mjs`. It needs `TYPESAFE_API_KEY` in `.env`:

```sh
node --env-file=.env scripts/jev-eval.mjs
```

:3

## Project status

All four signals run in pi as shipped: response policy, verification, phase,
and progress. Calibration rests on synthetic case sets. The progress signal
has no baselines, so its README marks it unvalidated.

See [the phase and progress design notes](./docs/design/phase-recommendation.md)
for the decisions those signals carry.
