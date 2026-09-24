# @mohan-cao/jev-verify

The verification signal, extracted from `@mohan-cao/jev-classifier`: three Jev
questions about a completed exchange, collapsed into one flag.

```bash
npm install @mohan-cao/jev-verify
```

```ts
import { verifyResponse, formatVerifyStatus } from "@mohan-cao/jev-verify";

const result = await verifyResponse(request, response, apiKey, config);
// { flag: "ok", answersQuestion: 0.86, evasive: 0.08, obligationUnmet: 0.94 }
```

| flag | meaning |
| --- | --- |
| `ok` | nothing to report |
| `🤷 evasive` | declined to commit, or did not address the request |
| `🚩 unmet` | did not do what the request needed |

## Read this before trusting the flag

**It is too permissive, and the reason is structural.** It has produced a real
false negative: across a session containing demonstrably unverified assertions —
a claim about an npm configuration asserted without reading it, and an
"incompatible with monorepo tooling" verdict drawn from one issue title that was
later closed as a misconfiguration — **every turn reported `ok`.**

Two separate causes, and only one of them is about thresholds.

**The questions ask about the wrong property.** `VERIFY_OBLIGATION_QUESTION`
asks about *the request's* premise — "if the request rested on a false or
oversimplified premise, did the response correct it" — and about inputs the
request omitted. The failure above is a third thing: **the response asserted what
it had not established.** That is not evasion (the response committed hard), not
off-topic (it answered), and not an uncorrected user premise (the premise was
fine). Nothing here asks the direct question: *does this response assert things it
did not check?*

**And the input could not answer that question anyway.** The signal is handed the
exchange as **text only**: tool calls are filtered out before the classifier sees
anything, and the response is truncated. A grounding question is unanswerable
from that input, because the evidence of grounding — what the agent actually read
or ran — has already been discarded.

So the current lens is not a mistake; it is the only thing judgeable from a
text-only input. **The fix is a different input, not a different question**, and
it does not belong in this package.

### The property has a name

Separate two things that are easy to conflate:

- **Truth** — *is this claim correct?* Needs the world. Not judgeable from text.
- **Provenance** — *does this claim trace to something that establishes it?*
  Judgeable from a transcript, because the transcript contains the agent's own
  actions.

The second is studied under a name: the **provenance gap** — tool-using agents
"rarely specify which tool observation supports each generated claim" — plus
claim-centric trajectory auditing ("tracking what the agent comes to believe,
whether those claims are supported") and evidence tracing generally ("which
evidence supported each claim, whether tool calls were justified").

The uncertainty family is the **wrong** tool for this. Semantic entropy measures
*the model's* uncertainty, so it catches confabulation — unstable answers — not
stable but unfounded ones. The failure above was stated with total confidence, so
low entropy would have marked it reliable.

### On the word "evasive"

`evasive` is a slight misnomer for the ungrounded case, but it is kept: renaming a
flag changes what every consumer and every stored record means, and the label is
defensible for the cases it *does* catch. Treat `evasive` as "committed without
doing the work", not strictly as "refused to commit".

## API

| export | purpose |
| --- | --- |
| `verifyResponse(request, response, apiKey, config, signal?)` | one Jev call → `VerifyResult` |
| `VERIFY_ANSWER_QUESTION`, `VERIFY_EVASIVE_QUESTION`, `VERIFY_OBLIGATION_QUESTION` | the question specs |
| `formatVerifyStatus(result, mode)` | status string, or `undefined` to clear |
| `VerifyConfig` | transport settings plus `evasiveThreshold`, `answersThreshold`, `obligationThreshold`, `enabled` |

## Notes

- **Signal only.** It never retries and never rewrites the answer. Partial
  (`aborted`/`error`) answers should not be verified at all.
- **Its own call.** Not shared with the phase or trajectory judgments; questions
  sharing a call can perturb each other.
- **Ordering is deliberate.** Evasion is checked before obligation, so a response
  that dodged the question is reported as evading rather than as unmet.

## License

Apache-2.0.
