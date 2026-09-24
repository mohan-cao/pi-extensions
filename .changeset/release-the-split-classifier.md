---
"@mohan-cao/jev-classifier": minor
"@mohan-cao/pi-jev-response-router": patch
---

Split the phase and trajectory judgments, and release the classifier for the
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
