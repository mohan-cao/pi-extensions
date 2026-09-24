# @mohan-cao/pi-jev-response-router

## 0.5.0

### Minor Changes

- 50d202b: Split the core into one package per judgment.
  
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

### Patch Changes

- Updated dependencies [50d202b]
- Updated dependencies [50d202b]
  - @mohan-cao/jev-classify@0.1.1
  - @mohan-cao/jev-phase@0.1.1
  - @mohan-cao/jev-verify@0.1.1
  - @mohan-cao/jev-trajectory@0.1.1
  - @mohan-cao/jev-classifier@0.3.0

## 0.4.3

### Patch Changes

- 6884c45: Split the phase and trajectory judgments, and release the classifier for the
  first time since.
  
  `judgeTrajectory` is its own function rather than a field on the phase judgment,
  `PhaseJudgment` no longer carries `trajectory` or `implementationReady`, and the
  two are asked in separate calls so neither set of questions can perturb the
  other. This release also carries the accumulated question-set work that never
  reached the registry: `implementation_ready` removed, the decomposition wording
  narrowed to the current request, and premise defects scored rather than
  boolean.
  
  `0.1.0` was the only published version, from before all of that.
  `pi-jev-response-router@0.4.2` calls `judgeTrajectory`, which `0.1.0` does not
  export: the call threw, the fail-open `catch` swallowed it, and the coaching
  hint silently stopped rendering. The router is bumped so its range moves off
  `^0.1.0`, which can never accept `0.2.0`.
- Updated dependencies [6884c45]
  - @mohan-cao/jev-classifier@0.2.0
