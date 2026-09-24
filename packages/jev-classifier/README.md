# @mohan-cao/jev-classifier

The transport layer for **Jev** (TypeSafe System One): it sends questions, parses
the answers, and defines the shape every question takes. Nothing else.

It contains **no harness code** — no session access, no UI, no credential storage
— and **no preferences**: no thresholds, no policies, and no opinions about what
to do with an answer. It takes an API key, a transport config, and question specs,
and returns parsed answers.

## Install

```bash
npm install @mohan-cao/jev-classifier
```

## Usage

```ts
import {
  callSystemOne,
  parseNoulAnswer,
  type JevConfig,
  type NoulQuestionSpec,
} from "@mohan-cao/jev-classifier";

const config: JevConfig = {
  endpoint: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest",
  timeoutMs: 5_000,
  retries: 2,
};

const question: NoulQuestionSpec = {
  type: "noul",
  instructions: "...",
  criteria: { true: "...", false: "..." },
};

const payload = await callSystemOne(
  { user_request: "the request to judge" },
  { my_question: question },
  apiKey,
  config,
  signal,
);

parseNoulAnswer(payload, "my_question"); // probability in [0, 1]
```

## What it provides

| export | purpose |
| --- | --- |
| `callSystemOne(state, questions, apiKey, config, signal?)` | one Jev call, with a timeout and retries |
| `parseNoulAnswer` / `parseScoreAnswer` / `parseChoiceAnswer` | the three answer shapes, validated and clamped |
| `NoulQuestionSpec`, `ScoreQuestionSpec`, `ChoiceQuestionSpec` | the question vocabulary |
| `JevConfig` | transport settings — the only config the core owns |
| `HistoryTurn` | a prior conversation turn |
| `JevError`, `clamp01` | transport failure with its HTTP status; a small clamp |
| `TtlCache` | a dependency-free TTL cache |
| `FOOTER_MODES`, `FooterMode` | the display vocabulary components share |

## The components

Everything opinionated lives in a component that depends on this package, so a
different combination is a different graph rather than a fork:

| package | judgment |
| --- | --- |
| [`@mohan-cao/jev-classify`](https://www.npmjs.com/package/@mohan-cao/jev-classify) | what shape the response needs, and the policy for it |
| [`@mohan-cao/jev-phase`](https://www.npmjs.com/package/@mohan-cao/jev-phase) | what kind of work is next |
| [`@mohan-cao/jev-verify`](https://www.npmjs.com/package/@mohan-cao/jev-verify) | whether the answer met its obligation |
| [`@mohan-cao/jev-trajectory`](https://www.npmjs.com/package/@mohan-cao/jev-trajectory) | whether the work is advancing |

Each of those extends `JevConfig` with its own thresholds, which is precisely why
this package can have none.

## Design notes

**Observe vs decide.** Jev only observes. Everything that *decides* — precedence,
thresholds, which flag wins, whether to render anything at all — is deterministic
code in a component or in the host. This is why `stay` was never a Jev output, and
why `genuinely_tricky` was removed: it measured the question and then stamped the
verdict on the answer.

**Question specs are a seam.** Every question is a plain object rather than code,
so wording can be replaced by a prompt-management loop without touching transport,
parsing, or anything downstream.

**No preferences here, by construction.** An earlier version of this package
carried every component's thresholds, which meant a component's config could only
inherit a kitchen sink. `JevConfig` holds transport and nothing else, and each
component's config extends it.

**Questions sharing a call perturb each other.** Measured, not assumed:
`implementation_ready` shared a call with the phase question and flipped its
answer, which is why the phase judgment now asks one question per call.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).