# @mohan-cao/jev-verify

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
