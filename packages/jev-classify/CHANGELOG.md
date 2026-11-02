# @mohan-cao/jev-classify

## 0.1.2

### Patch Changes

- b532bd5: Narrow the scope of the bounded-verification question.
  
  The shipped wording read "at most three concrete, independently evaluable
  claims **or questions**", so any request containing one-to-three concrete
  questions qualified — including questions addressed to the assistant itself,
  such as asking whether it can see project instructions. A conversational
  turn like this scored P(bounded) 0.66 in real use, crossed the 0.6 threshold,
  and attached the verdict-list policy to a plain question.
  
  The question now judges substance over sentence form. A claim stays in scope
  when stated as a question (`UDP preserves datagram boundaries, right?` keeps
  classifying bounded), while questions to the assistant about its own state,
  configuration, or behaviour fall to `normal`. Live A/B against the eval
  harness: the misfiring turn drops 0.66 to 0.11, the in-scope cases hold
  (0.95 and 0.84), and stray bounded scores on off-scope cases drop.

## 0.1.1

### Patch Changes

- 50d202b: Rebuild against the split core.
  
  Each of these depends on `@mohan-cao/jev-classifier`, and their range follows
  `workspace:^` at pack time — so they need a release to declare the new core
  version rather than the one they were first published with.
  
  `@mohan-cao/jev-phase@0.1.1` also fixes `0.1.0`, which shipped the `workspace:`
  protocol verbatim in its manifest and therefore installed for nobody:
  
  ```text
  npm error code EUNSUPPORTEDPROTOCOL
  npm error Unsupported URL Type "workspace:": workspace:^
  ```
  
  That was a bootstrap mistake — `npm publish` on its own does not rewrite the
  protocol; `pnpm pack` does, which is why the release workflow packs with pnpm and
  publishes the tarball with npm. `0.1.0` is deprecated.
- Updated dependencies [50d202b]
  - @mohan-cao/jev-classifier@0.3.0
