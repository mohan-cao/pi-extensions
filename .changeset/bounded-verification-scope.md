---
"@mohan-cao/jev-classify": patch
---

Narrow the scope of the bounded-verification question.

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
