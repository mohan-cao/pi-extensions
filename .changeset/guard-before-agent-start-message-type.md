---
"@mohan-cao/pi-jev-response-router": patch
---

Guard `before_agent_start` on the user message type.

`BeforeAgentStartEvent` became a union on `messageType` in pi 1.2.0. Only a
user prompt carries `prompt`; a run started by
`pi.sendMessage(..., { triggerTurn: true })` carries `message` instead. The
router read `event.prompt` before the guard, so every custom-message run
threw, the run went unclassified, and the log recorded a bare decision.
`agent_settled` still runs, so the post-generation judgments are unaffected.
