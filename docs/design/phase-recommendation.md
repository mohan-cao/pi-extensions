# Shadow phase recommendation

**Status:** implemented on `feat/footer-signals` — questions, judgment, deterministic
comparison, and Pi footer wiring. Thresholds are calibrated against the transition eval set in
`scripts/jev-eval.mjs` (`--phase-only`).

**Supersedes:** the earlier "next model recommendation" draft. That draft proposed a
pre-generation gate, an auto-switch command, and a `stay` value emitted by Jev. All three
were rejected — see [Rejected designs](#rejected-designs).

## What this is

A **report**, plus a **nudge** — two of them, actually:

1. **Routing.** After each turn, Jev reads the conversation and answers *what should the
   primary next activity be?* The extension compares that to the model you are running and,
   when they disagree, suggests the model that fits.
2. **Coaching.** The same judgment reports *how the conversation is progressing* — whether it
   is converging, spiralling into detail, or blocked by its own framing. This is the part
   that helps a user who is stuck but cannot see it.

It is a mirror, not a controller. But the mirror's job is not to passively reflect — it is to
**name the attractor so the user can break out of it**. A stable phase is the problem
statement; making that stability visible is the solution.

This matters because not every user is an expert. Someone who has been circling for six turns
may not know whether they are stuck or simply working. The mirror's value is that it can say
which, and what kind.

## What this is not

| Not this | Why |
| --- | --- |
| A model router | It never selects or switches a model. You switch with `/model`. |
| A gate | It never blocks a prompt. Blocking contradicts shadow mode and interrupts work to save cents. |
| A command | There is no `/jr go`. The override is your next prompt. |
| A difficulty classifier | It reports work *phase* and *transitions*, not how hard the last message was. |

## Motivation

The extension already runs two judgments per turn:

- **pre-generation** — classify the request, inject a response-shape policy
- **post-generation** — judge `user request + assistant output` for quality, surface a footer status

What is missing is a signal about *what happens next*: whether the nature of the work has
changed, and whether the running model is suited to it.

The differentiator against `pi-jev-model-router` is precisely this: that project routes on
per-prompt difficulty; this detects **work-phase transitions**. A conversation is not a
sequence of independent prompts — it moves from design into implementation and back, and the
transition is the actionable moment.

## Pipeline

```text
incoming user turn
      │
      ▼
pre-generation request classifier          (existing: response shape)
      │
      ▼
steering + generation                       (existing)
      │
      ▼
post-generation quality judge               (existing: answers / evasive / obligation)
      │
      ├─► post-generation trajectory judge  (new, separate call — see below)
      │        │
      │        ▼
      │   workPhase + implementation_ready + progress
      │
      ▼
compare workPhase to modelPhase             (deterministic, in code)
      │
      ▼
footer: routing nudge (phase vs model) + coaching hint (progress)
```

## Phase vocabulary

Three mutually exclusive categories of work:

| phase | covers |
| --- | --- |
| `build` | implementation, tests, mechanical debugging, straightforward code changes, routine agentic coding |
| `design` | architecture, ambiguous requirements, nuanced discussion, adversarial review, difficult debugging, tradeoffs |
| `general` | general conversation, investigation, mixed work |

`general` is a **positive routing target**, not a residual. Unlike `normal` in the
response-mode classifier — which injects no policy and is genuinely "none of the above" —
`general` maps to a real model. It is where work de-escalates to when it is neither
implementation nor architecture.

**`stay` is not a phase and Jev never emits it.** Whether a recommendation should be shown is
a policy decision, made in code by comparing `workPhase` to `modelPhase`. This is the same
split that fixed `genuinely_tricky`: Jev observes the world; code decides what to do.

### Why a Choice question is correct here

The response-mode classifier deliberately uses two Noul questions instead of a 3-way Choice,
because `normal` competed in the argmax as a residual. That reasoning does **not** transfer:

- response modes: `normal` is an absence, so it must not compete
- work phases: `build | design | general` are genuinely mutually exclusive categories, and
  `general` is a legitimate answer rather than a fallback

A Choice also returns a calibrated `confidence` and a full distribution, which is what the
comparison layer needs.

## The Jev / code split

Everything that observes goes to Jev. Everything that decides goes to code.

| Jev observes | Code decides |
| --- | --- |
| `next_phase` (Choice: build / design / general) | whether `workPhase !== modelPhase` |
| `confidence` for that choice | whether confidence clears the display threshold |
| `trajectory` (Choice) | whether to show a coaching hint |
| | which model to name in the footer (config lookup) |
| | whether to render anything at all |

No provider names, model aliases, pricing, availability, or catalogue knowledge ever reaches
Jev. The classifier emits semantics; the policy layer owns models.

## Questions

```ts
NEXT_PHASE_QUESTION: choice
  instructions:
    "What kind of work does this conversation need next? Judge the subject matter —
     what has been settled and what is still open — not how smoothly the conversation
     has been going."
  criteria:
    build:   "Implementation, tests, mechanical debugging, or straightforward code
              changes. The decisions needed to act are already settled."
    design:  "Architecture, ambiguous requirements, nuanced tradeoffs, adversarial
              review, or difficult debugging. Something material is still unresolved."
    general: "General conversation, investigation, or mixed work that neither
              implementation nor design specifically describes."

TRAJECTORY_QUESTION: choice
  instructions:
    "Is this conversation making progress, independent of what it is about? Judge the
     pattern across recent turns — is each turn covering new ground and resolving
     something, or is ground being revisited at increasing depth or in different words?"
  criteria:
    converging:    "Each turn covers new ground and resolves something."
    stuck_detail:  "Turns keep going deeper into detail without resolving anything."
    stuck_framing: "Turns revisit the same issue in different words."
    early:         "Too few turns, or too little substance, to judge progress."
```

### Why the wording was separated

The first draft told `next_phase` to "judge the trajectory of the work — what has been decided
and what is still unresolved", which is the same instruction `trajectory` gets. Both questions
were asked to do the same reasoning and then emit different labels.

Separating the bases — phase judges the subject matter, trajectory judges the process pattern —
left every label unchanged but raised confidence where it was weak: `framing-loop`'s phase
confidence went **0.50 → 0.90**, and `build-ambiguity`'s converging confidence **0.35 → 0.68**.
The overlap was costing confidence, not correctness.

### `implementation_ready` was removed

It restated `next_phase` — "has the conversation reached the point where the primary next
activity should be implementation" is the same question — and the eval showed it perfectly
correlated with `next_phase == build` (0.91–0.93 when build, ≤ 0.09 otherwise). Dropping it
changed no label and no confidence. A restatement cannot corroborate anything, which was its
entire purpose.

### The two judgments are separate calls

`next_phase` and `trajectory` are orthogonal — a conversation can be stuck while implementing,
or framing a problem badly during general conversation — so they run as separate calls, with
separate toggles (`/jev-router phase`, `/jev-router coaching`), separate thresholds, and
separate history depths. Sharing a call gives questions a way to perturb each other, which
`implementation_ready` demonstrated.

They run concurrently with verification in `agent_settled` (`Promise.allSettled`), so the wall
clock is the slowest judgment rather than the sum.

`stuck_detail` was also tightened to require *escalation or repetition* rather than mere
unresolvedness. On the eval that moved `design-open` from `stuck_detail` (0.29–0.32) to
`converging` (0.45–0.52), while both genuine stuck cases stayed above the gate — at
**0.80–0.82** and **0.87**, down from 0.95–0.96 and 1.00. Less headroom, but the systematic
mislabel is gone.

## Trajectory diagnosis (coaching)

Phase answers *what kind of work this is*. It does not answer *whether the work is going
anywhere* — and those have different remedies:

| diagnosis | what it looks like | what it suggests |
| --- | --- | --- |
| `converging` | each turn resolves something; moving toward a decision or deliverable | nothing |
| `stuck_detail` | turns keep adding finer detail without resolving the underlying question | zoom out; restate the goal |
| `stuck_framing` | turns circle the same issue in different words; effort is not the bottleneck | reframe the question |
| `early` | too few turns, or too little substance, to judge | nothing |

```ts
TRAJECTORY_QUESTION: choice
  instructions:
    "How is this conversation progressing? Judge the arc across recent turns — what
     has been resolved and what keeps recurring — not the quality or style of the
     most recent message."
  criteria:
    converging:    "Each turn resolves something. The work is moving toward a
                    conclusion, decision, or deliverable."
    stuck_detail:  "Turns keep adding finer detail without resolving the underlying
                    question or reaching a decision. The work has lost altitude."
    stuck_framing: "Turns circle the same issue in different words. Progress is blocked
                    by how the problem is framed, not by missing effort."
    early:         "Too few turns, or too little substance, to judge progress."
```

**This is display-only.** It never gates a model recommendation and never changes routing. It
exists so the footer can say something useful, in plain language, to a user who is stuck
without knowing it. `stuck_detail` and `stuck_framing` are the two states worth surfacing;
`converging` and `early` render nothing.

Note the relationship to existing signals: `premise_defect` (pre-generation) judges a single
request's presuppositions; `stuck_framing` is the multi-turn version — the same wrong
assumption surviving across turns without being corrected.

## Separate call, not a reused one

The phase judgment gets **its own post-generation call**, with conversation history in the
state. It is not folded into the quality judge, for an empirical reason measured in this
repo's eval harness:

- transition detection is inherently multi-turn; it needs the arc of the conversation
- the quality judge needs only the last exchange
- adding history to a Jev judgment **systematically inflates it** — in the session eval,
  history raised the decomposition score by +0.06 to +0.13 and flipped a scoped
  direct-recommendation request into `decomposition_required`

Two post-gen calls cost ~nothing at Jev's price and keep both judgments uncontaminated.

## Reporting

Three footer statuses — one per signal, each with its own key. **No aggregation.** Rendering is
preference-driven (`compact` by default, or `icons`, or `off`), and `/jr` always shows the full
detail on demand, so the footer never has to carry everything.

```text
compact (default)
  ↪ build · <build model>      work phase disagrees with the running model
  ↪ design · <design model>    disagrees — upgrade
  ♾️ paralysis                 analysis paralysis
  🖼️ framing                   framing is the blocker
  🤷 evasive                   answer dodged or did not commit
  🚩 unmet                     technically true but did not do the required work
  (nothing)                    agreement and converging — render nothing

icons
  ↪🔨   ↪📐   ↪💬   ♾️   🖼️   🤷   🚩
```

Rules:

- **Surface deviations, not snapshots.** If the mirror is stable it will report the same
  phase for many turns; a constant label is noise. Show the routing nudge only when
  `workPhase` disagrees with `modelPhase`.
- **Say nothing when they agree.** Do not repeatedly tell the user to switch to the model
  they are already on.
- **Unknown `modelPhase`** (current model is not in any phase mapping): report the observed
  phase without a switch nudge.
- **Coaching hints are plain language.** `stuck_detail` renders as `♾️ paralysis`,
  `stuck_framing` as `🖼️ framing`. No jargon: not "phase", not "trajectory", not
  "implementation_ready".
- **A stuck pattern is a deviation too.** `stuck_detail` / `stuck_framing` render even when
  `workPhase` matches `modelPhase`, because being on the right model does not mean the work
  is going anywhere.

## Iconography

Three **disjoint families**, so no glyph is ever ambiguous about which signal it belongs to.
This is the one hard requirement: nothing overlaps across categories.

| signal | state | `compact` | `icons` |
| --- | --- | --- | --- |
| quality | ok | — | — |
| quality | evasive | `🤷 evasive` | `🤷` |
| quality | unmet | `🚩 unmet` | `🚩` |
| routing | → build | `↪ build · <model>` | `↪🔨` |
| routing | → design | `↪ design · <model>` | `↪📐` |
| routing | → general | `↪ general · <model>` | `↪💬` |
| coaching | analysis paralysis | `♾️ paralysis` | `♾️` |
| coaching | framing | `🖼️ framing` | `🖼️` |

Families:

- **quality** — verdict and commitment: `🤷` the answer didn't commit, `🚩` flagged as
  missing the required work.
- **routing** — direction and craft: `↪` (redirect) plus `🔨` build / `📐` design / `💬` general.
- **coaching** — metaphor: `♾️` analysis paralysis (going on forever), `🖼️` framing (the frame
  itself is wrong).

Notes:

- `↪` is a text glyph, not an emoji. Kept deliberately: it reads as "redirect", and the emoji
  alternatives (`🔀` shuffle, `➡️` heavy) are worse.
- The old `💡` lightbulb is retired. It meant "insight" while flagging a problem.
- `🚩` (flag) rather than `❌`: `unmet` means "technically true but did not do the required
  work", not "wrong".
- **No colour.** Severity is carried by glyph identity, which survives colourblindness and
  theme clashes. This is a deliberate choice, not a limitation.

## Preferences persistence

**Implemented** on `feat/persist-preferences`. Prerequisite for the footer preference — and it
fixes the existing toggles at the same time.

The toggles were in-memory module variables, so `/jev-router verify on|off` (and `debug`,
`enabled`) reset on `/reload` and in every new session. Pi's storage guidance is that state
living outside one session belongs in external storage, and there is no settings API on
`ExtensionAPI` / `ExtensionContext`, so the extension owns a small file. The path comes from
`getAgentDir()`, which honors `PI_CODING_AGENT_DIR` and the configured `CONFIG_DIR_NAME`:

```text
~/.pi/agent/pi-jev-response-router.json
{
  "enabled": true,
  "debug": false,
  "verify": true,
  "footer": "compact"
}
```

- Read once at extension load; written on change by `/jev-router`.
- Missing or corrupt file falls back to environment-derived defaults.
- Only runtime toggles persist. Endpoint, model, thresholds, and routes stay in env/config.
- Precedence: **persisted file > environment > built-in default**, so a command is durable
  while env still works as a one-shot override when no file exists.
- `footer` is settable and persisted now, but **reserved**: nothing consumes it until the
  work-phase and coaching statuses ship.

## Configuration

Semantic routing stays separate from model policy:

```json
{
  "routes": {
    "build":   { "model": "<cheap-capable-coding-model>", "thinking": "default" },
    "design":  { "model": "<strong-reasoning-model>",     "thinking": "high",
                 "steering": "adversarial" },
    "general": { "model": "<balanced-general-model>",     "thinking": "default" }
  }
}
```

- `phase → model` is the forward map, used to name the suggested model.
- `model → phase` is the reverse map, used to compute `modelPhase` from `ctx.model`.
  If the model is unmapped, `modelPhase` is unknown.
- Presets (economy / quality / cost-insensitive) can come later; the core extension should
  not be opinionated about specific models.

## Dynamics: why the stability is the point

This is the part worth being explicit about, because it determines what the report is for.

**The extension does not self-correct.** It reports. The loop closes through the user, not
through the extension — and that is the design, not a limitation. The user has the intent to
get back to productive work; what they lack is a cheap way to notice they have stopped. That
is precisely what the mirror provides, which is why a stable phase is the *problem statement*
rather than a flaw in the feature.

**The judgment is self-stabilizing per model.** `workPhase` is inferred from the model's
output, and the model's output is shaped by the model's character. A reasoning model produces
analytical, question-generating work, so Jev reads `design`, so the next turn is also
`design`. A fast coding model produces implementation, so Jev reads `build`, and it stays
`build`.

Consequences:

- *"Will it spin in design forever?"* Yes, it can. Design/adversarial steering is designed to
  keep finding problems, so `implementation_ready` may never fire on its own. That is not a
  classifier bug; it is an honest reflection of what a design-phase model does when left to
  design.
- *"Will it fix things for me?"* Only if `build` is already active and the model is capable.
  The extension cannot cause that.

**The override is the user's next prompt.** "OK, let's implement" is a phase transition Jev
observes directly. Natural language is already the control surface, which is exactly why a
gate or a switch command would have been redundant. The coaching hint is what makes that
override *available* to a user who cannot tell that they need to make it.

### Style confound

The phase judgment is not an objective property of the work — it is a function of the model's
behaviour on the work. This is the same trap as `genuinely_tricky`: judging a thing through
the lens of its output. A verbose reasoning model may read as `design` even while
implementing. Two guards:

1. Judge from the conversation trajectory (what is decided, what is open), not the last
   message's shape. This is why the question wording says so explicitly.
2. Frame the question around **work**, never response style.

If the mirror turns out to track model verbosity rather than work, the logs below will show
it immediately.

## Validation before thresholds are meaningful

Thresholds must come from data, not intuition — the last round of threshold tuning proved
that (a 0.5 decomposition threshold was sitting inside the noise band, making classification
a coin flip).

1. ~~**Log the judgments per turn**~~ Done — `DecisionRecord` plus a JSONL file
   (`~/.pi/agent/jev-decisions.jsonl`, `/jev-router log on|off`). Records judgments,
   probabilities, and model ids, never conversation text. Acceptance of a nudge is derived by
   diffing consecutive records (`recommendedModel` at turn N vs `modelRunning` at N+1). This is
   the artifact that tunes the thresholds *and* answers whether the feature is useful at all —
   though it yields distributions and proxies, not correctness.
2. ~~**Build a transition eval set**~~ Done — eight cases in `scripts/jev-eval.mjs`
   (`--phase-only`): design-settled, design-open, build-ambiguity, build-progress,
   detail-spiral, framing-loop, general-chat, early.
3. **Success criterion:** the disagreement signal correlates with something the user cares
   about (wasted spend, wrong-model work). If it only correlates with model verbosity, the
   feature is not worth shipping.

### Measured

| signal | result |
| --- | --- |
| `next_phase` | correct on all eight cases (design-settled → build 1.00, build-ambiguity → design 1.00, general-chat → general 1.00) |
| `implementation_ready` | redundant — perfectly correlated with `next_phase == build`; removed |
| `trajectory` | `design-open` is a near-tie between `converging` and `stuck_detail` at ~0.30, flipping between runs; the two genuine stuck cases sit at 0.96–1.00 |

The routing side needed no tuning. The coaching side needs the 0.7 gate, and the gap is wide
enough that it is not a close call — `design-open` is *uncertain*, not wrong, and the gate
suppresses it whichever label it lands on. That is the right mechanism, not a paper-over.

## Dependencies and sequencing

1. ~~Merge PR3 (`feat/verify-signal`).~~ Done — `verify.ts` is in `main`, released as `0.3.0`.
2. ~~**Preferences persistence**~~ Done on `feat/persist-preferences` — a small JSON file so
   `enabled` / `debug` / `verify` / `footer` survive reload and new sessions.
3. Extract the core package (`@mohan-cao/jev-classifier`) as a behaviour-preserving refactor.
4. Land the corrected response-mode questions (v3 wording, `premise_defect`,
   `obligation_unmet`, threshold 0.6).
5. Then this feature — almost entirely a core-layer addition (two questions + a comparison
   function) plus one Pi footer key.

## Rejected designs

Kept here so they are not re-proposed.

- **`stay` as a Jev output.** Mixes a semantic observation with an action policy. Code decides
  whether to display; Jev only observes. (Same failure mode as `genuinely_tricky`.)
- **Low confidence → `general`.** Backwards. Low confidence means the classifier does not
  know; that should suppress the nudge, not recommend a switch. Recommending `general` on
  uncertainty guarantees churn on every ambiguous turn.
- **`implementation_ready` as a `reason` enum value.** It gates behaviour, so it must be a
  numeric, tunable, independently evaluable signal — not a display string.
- **Reusing the quality call for the phase judgment.** History contaminates quality judging;
  measured, not assumed.
- **Pre-generation gate (block the prompt).** Contradicts shadow mode, interrupts work, and is
  the wrong mechanism for a nudge. Also the only blocking seam is `input`, and blocking on a
  stale pending recommendation is fragile.
- **`/jr go` to switch models.** Structurally ignorable — the user who ignores the
  recommendation also never runs the command — and it duplicates `/model`, which the user
  already controls. The extension should not own model switching.
- **`currentPhase` derived from the current model.** Would make the semantic phase change
  when the model catalogue changes, violating the goal that phases stay stable as models
  change. `workPhase` is observed; `modelPhase` is a config lookup used only for comparison.

## Open questions

- Is the disagreement nudge useful at all, or is the "stuck" trend the real signal? The logs
  decide.
- ~~Does the phase Choice need `implementation_ready` as corroboration?~~ Answered: no. It
  restated the phase question and changed nothing. If a real guard is wanted for `design →
  build`, it must ask something `next_phase` does not — e.g. whether a concrete action is
  available now.
- Where should the last judgment live if trend tracking is added — session `custom` entry
  (survives reload, may be summarised by compaction) vs extension memory (lost on reload)?
  Only needed if "stuck" ships.
