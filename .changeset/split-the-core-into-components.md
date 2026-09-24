---
"@mohan-cao/jev-classifier": minor
"@mohan-cao/pi-jev-response-router": minor
---

Split the core into one package per judgment.

`@mohan-cao/jev-classifier` is now **transport only** — `callSystemOne`, the
three answer parsers, the question-spec vocabulary, and `JevConfig` — with no
thresholds, no policies, and no opinions about what to do with an answer. The
judgments moved into packages that depend on it:

| package | judgment |
| --- | --- |
| `@mohan-cao/jev-classify` | what shape the response needs, and the policy for it |
| `@mohan-cao/jev-phase` | what kind of work is next |
| `@mohan-cao/jev-verify` | whether the answer met its obligation |
| `@mohan-cao/jev-trajectory` | whether the work is advancing |

**Breaking for direct consumers of the core.** `classifyWithJev`, `policyFor`,
`premisePolicyFor`, `verifyResponse`, `formatVerifyStatus`, `judgePhase`,
`phaseRecommendation`, `formatPhaseNudge`, `judgeTrajectory`, `formatCoaching`,
`DecisionRecord`, every threshold on `RouterConfig`, and the question constants
are gone from it. They live in the component packages — or, in the case of the
decision log, in the extension, since it names the judgments a particular
collection runs and writes a file.

**Breaking for consumers of the extension too, narrowly.** Its re-export surface
is complete, so nothing needs a new import, but `RouterConfig` is now the
extension's own type rather than the core's: transport plus the classification
cache. It no longer carries `decompositionThreshold`,
`boundedVerificationThreshold`, `premiseDefectThreshold`, `historyTurns`,
`verify`, or the verify thresholds — those belong to the component that uses them.
`JevConfig` is the transport-only base every component config extends.
