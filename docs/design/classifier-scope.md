# Which classifiers earn their place

Scope decisions for the Jev-based signal collection: what stays, what goes, and
the rule that decides.

## The rule

> **A classifier earns its place when it observes something the user cannot
> easily observe about themselves, and supplies it as a datum. It does not earn
> its place when it substitutes for a preference the user already holds.**

The corollary matters as much as the rule: **no internal measurement can force
the judgement the user makes.** The tool supplies an observation; the user
supplies the judgement. That is the whole product. It is *observability, not
optimisation* — the package reports, it does not decide.

This reframing is deliberate and it retires the original pitch. "Route your work
to the right model" is a decision made on the user's behalf, and it was never
defensible: the inputs that would justify it (risk, verification cost, tolerance
for a wrong path) are local knowledge the session does not have.

The rule is also falsifiable, which is why it is worth writing down. It predicts
that a signal observing loop dynamics is useful and a signal recommending a
model is not — and if that prediction fails in practice, the rule is wrong and
should be replaced.

## Verdicts

### Keep — post-generation verification

Observes whether the answer addressed the question. The user would have to
re-read the exchange to see this, and re-reading is exactly what nobody does.

### Keep — phase, as an indicator

Observes where the work currently sits (`build` / `design` / `general`).

Its consumer is **the user's own sense of progress**: reading `design` makes
explicit whether a session is advancing toward its goal or circling one part of
the problem. That is a judgement no internal measurement can make, and the
indicator does not attempt it — it supplies the landmark and stops.

This replaces the earlier justification, which was model routing. **Phase is not
a routing input.** It is a standalone indicator, and it is also the grouping key
for the trajectory and cost signals.

Default on. It is a single judgment call and a status string.

### Keep — trajectory (the coaching hint)

Observes whether the loop is converging, and names the shape when it is not
(`♾️ paralysis`, `🖼️ framing`). This is the clearest case for the rule: the user
is *inside* the loop and is the worst-placed observer of it.

Two honest caveats:

- **Precision matters, not recall.** A senior engineer may simply never produce
  the stuck patterns the eval set synthesises — the hint being rare is not
  evidence it is broken. The question is whether it is right when it fires.
- **The false-positive rate is unmeasured.** The eval set's weak spot is real:
  `design-open` flips between `stuck_detail` and `converging` (0.29–0.52),
  because the taxonomy has no "legitimately still open" category. Early design
  work is the most likely place for a wrong hint.

Keep, but do not call it validated until it has fired in real use and been
judged right.

### Reserved — loop cost

Observes consumption against a budget: consecutive turns in one phase, priced at
the running model's rate. This is the strongest candidate of the five, because it
is the only one that needs **no taste judgement at all** — it is arithmetic over
data the host already has.

It is also the one signal a user genuinely cannot self-observe. Agentic loops
consume an order of magnitude more than a single prompt, and the binding
constraint on a subscription is the *weekly* bar, not the session window — a
number nobody tracks mid-flow.

Reserved, not dropped: the cost model needs its own design pass. The gate is that
subscription allowances are not in Pi's model registry, so the allowance has to
be user-declared, and that surface needs thought before any of it is built.

### Dropped — model recommendation

Substitutes for taste. The published guidance points the same way: the goal is
"the cheapest configuration with a credible path to a complete, verified result",
and *credible path* is local knowledge. Recommending a build model asserts a
global answer to a local question.

The actionable variable the literature does emphasise is **reasoning effort**,
not model identity — route by risk, ambiguity, and verification cost, and treat
"high or max by default" as a smell. Pi already normalises effort across
providers (`Model.thinkingLevelMap`, `ctx.thinkingLevel`), so if this ever comes
back it should come back as an effort hint, not a model swap.

### Dropped — documentation style as a classifier

Style is user preference, and the public comparisons of model writing dialects
are blog-grade. A classifier must not assert what the user likes.

The premise — that models have distinguishable writing styles, so routing can
substitute for prompt-shaping — is sound. The conclusion is that this is a
**mechanism**, not a classifier:

- a steerable pre-generation prompt, or
- a sub-agent handoff, or
- post-processing of the artifact,

reached by an **explicit command** rather than inferred. The user can state the
intent more reliably than any classifier can infer it, at zero cost. Mechanisms
deferred.

## Target architecture

**One package per judgment.** Each is usable standalone; the Pi plugin is a
collection that renders them.

```
@mohan-cao/jev-classifier      shared core: transport, answer parsing,
                               question-spec types, error handling
        |
        +-- jev-verify         questions + judgment + formatter
        +-- jev-phase          ...
        +-- jev-trajectory     ...
        +-- jev-cost           (reserved)
                 |
        pi-<collection>        registers components, runs enabled ones,
                               owns the footer preference and status keys
```

Two constraints on the split:

1. **The render path stays where it is.** Each component keeps its own glyph
   vocabulary and formats its own status string given a footer mode. The
   vocabularies are deliberately disjoint (`🤷`/`🚩` verify, `↪` phase, `♾️`/`🖼️`
   coaching), so a single central renderer would have to know all of them — worse
   coupling, not better. The collection's job is dispatch, not formatting.
2. **The shared core is transport, not policy.** Question specs, judgment
   functions, thresholds, and formatting belong to the component. If something
   looks like it belongs in the core "just in case", it belongs in a component.

Splitting is what `changesets` was adopted for: an N-package graph with cascading
bumps is exactly its job. Each new package needs its own npm trusted-publisher
entry, and its *first* publish cannot use OIDC, so expect one manual bootstrap
per package.

## Falsification

Each component should be deletable, and the doc should say what would justify
deleting it:

| component | delete it if |
| --- | --- |
| verify | the flag agrees with a skim every time, so it never changes what you do |
| phase | the label stops being read — an indicator nobody reads is decoration |
| trajectory | when it fires, it is wrong more often than right |
| cost | the arithmetic is never surprising enough to act on |

## Open decisions

1. **Naming.** `pi-jev-response-router` is now wrong twice: there is no routing,
   and it is becoming a collection. Candidates: `pi-jev-signals` (accurate),
   `pi-jev-cues` (accurate and less clinical), `pi-jev-mirror` (evocative).
   Avoid `*-tools` / `*-dev-*` — they promise a toolkit, and this is a set of
   observations. Component packages are unproblematic: `jev-verify`,
   `jev-phase`, `jev-trajectory`, `jev-cost`.
2. **Migration.** Do not rename `pi-jev-response-router`. Retire it when the
   collection package lands, and let the rename and the split be one migration
   rather than two. Cost: a new trusted-publisher entry, a manual first publish,
   and a `npm deprecate` on the old name.
3. **Default on/off per component.** Phase is default on. Verification is cheap
   and default on. The cost signal may be noisy enough to warrant opt-in.
4. **The coaching hint's precision target.** Decide what "right when it fires"
   means *before* measuring, or the measurement will be fitted to whatever the
   first few firings look like.
5. **The cost model's allowance surface.** Deferred, but the gate: subscriptions
   are not in Pi's registry, so the allowance must be user-declared.

## Not in scope

- Model recommendations, in any phase.
- Judgements of work quality. The user is a better judge of their own work than
  the session is, and a tool that implies otherwise is overreaching.
- Style classification.
