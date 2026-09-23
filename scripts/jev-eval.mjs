#!/usr/bin/env node
// Throwaway eval harness for the proposed Jev classifier/verifier questions.
//
//   node --env-file=.env scripts/jev-eval.mjs
//
// Reads TYPESAFE_API_KEY from the environment. Nothing here is wired into the
// extension; it exists to sanity-check question wording against real Jev output.

const API_KEY = process.env.TYPESAFE_API_KEY;
const ENDPOINT = process.env.PI_JEV_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.PI_JEV_MODEL ?? "jev-latest";

if (!API_KEY) {
  console.error("TYPESAFE_API_KEY is not set. Run: node --env-file=.env scripts/jev-eval.mjs");
  process.exit(1);
}

// ---------------------------------------------------------------- questions

const DECOMPOSITION_QUESTION = {
  type: "noul",
  instructions:
    "Does answering this request well require decomposing it first — identifying the material assumptions, conditions, missing inputs, or tradeoffs that control the answer — because a direct answer would discard something that materially changes it?",
  criteria: {
    true: "The answer materially depends on conditions, missing inputs, or tradeoffs that must be surfaced before a reliable conclusion can be given.",
    false:
      "A direct answer, including a short list of corrections, can be given without first decomposing the problem.",
  },
};

const BOUNDED_VERIFICATION_QUESTION = {
  type: "noul",
  instructions:
    "Does this request contain at most three concrete, independently evaluable claims or questions that can each be answered with a direct correct / partially-correct / incorrect verdict?",
  criteria: {
    true: "At most three concrete claims or questions, each independently checkable, where a useful answer is essentially a verdict plus concise corrections.",
    false:
      "The request is open-ended, asks for design, planning, recommendation, or tradeoff analysis, or contains more than three checkable claims.",
  },
};

// The decomposition question as shipped on main (PR2), for A/B comparison.
const DECOMPOSITION_QUESTION_CURRENT = {
  type: "noul",
  instructions:
    "Does answering this request well require decomposing it first, by identifying material assumptions, definitions, conditions, interacting constraints, or tradeoffs, because a direct verdict or single-answer response would discard something that materially changes the answer?",
  criteria: {
    true: "The answer materially depends on assumptions, definitions, conditions, or tradeoffs that must be surfaced and weighed before a reliable conclusion can be given.",
    false:
      "A direct answer, including a short list of corrections, can be given without first decomposing the problem.",
  },
};

// v3: explicitly insulate the judgment from conversational momentum.
const DECOMPOSITION_QUESTION_V3 = {
  type: "noul",
  instructions:
    "Judge the CURRENT request only. Use the conversation solely to resolve what the request refers to; do not let how earlier turns were answered influence the judgment. Does answering this request well require decomposing it first — identifying the material assumptions, conditions, missing inputs, or tradeoffs that control the answer — because a direct answer would discard something that materially changes it?",
  criteria: {
    true: "The current request itself materially depends on conditions, missing inputs, or tradeoffs that must be surfaced before a reliable conclusion can be given.",
    false:
      "A direct answer to the current request, including a short list of corrections, can be given without first decomposing the problem.",
  },
};

const PREMISE_DEFECT_QUESTION = {
  type: "score",
  instructions:
    "How sound is the factual premise of this request? Rate whether the request presupposes something that is false, or true only under a narrower framing than the request implies.",
  criteria: [
    "Premise is sound. Nothing presupposed is false or misleading.",
    "Minor slip in wording or intent; imprecise but not misleading.",
    "The presupposition holds only under a narrower framing than the request implies; worth naming, but the request is still answerable as posed.",
    "The presupposition is false or materially misleading; answering as posed would reinforce a misconception.",
  ],
};

const VERIFY_ANSWER_QUESTION = {
  type: "noul",
  instructions: "Does the response directly and substantively answer the user's request?",
  criteria: {
    true: "The response addresses the actual question asked and gives the user something actionable or conclusive.",
    false: "The response deflects, answers a different question, or leaves the user's request unaddressed.",
  },
};

const VERIFY_EVASIVE_QUESTION = {
  type: "noul",
  instructions:
    "Is the response vague, hedged, or non-committal in a way that avoids taking a position the request calls for?",
  criteria: {
    true: "The response leans on generic caveats, an 'it depends' frame, or filler instead of committing where a position was warranted.",
    false:
      "The response commits to a position, or clearly states what it does not know and why, without hiding behind vague hedging.",
  },
};

const VERIFY_ANSWER_QUESTION_V2 = {
  type: "noul",
  instructions:
    "Does the response address the user's actual request? Addressing includes naming what the answer depends on, or asking for information it depends on; it does not require a single final verdict.",
  criteria: {
    true: "The response engages the actual question and gives the user something actionable or conclusive, including a clear statement of what the answer depends on.",
    false: "The response deflects, answers a different question, or leaves the user's request unaddressed.",
  },
};

const VERIFY_EVASIVE_QUESTION_V2 = {
  type: "noul",
  instructions:
    "Does the response avoid committing to a position that the request calls for? Distinguish genuine evasion from a conditional answer that names the determining factors and then commits within them.",
  criteria: {
    true: "The response declines to take any position, or offers only generic caveats and filler, even though the request called for a conclusion.",
    false:
      "The response commits to a position, or conditions its answer on explicitly named factors and commits within each. Conditional-but-committed is not evasion.",
  },
};

const VERIFY_OBLIGATION_QUESTION = {
  type: "score",
  instructions:
    "Given what the request did and did not provide, did the response meet its obligation? If the request rested on a false or oversimplified premise, did the response correct it? If the request omitted information needed to answer well, did the response surface those inputs (by asking, or by branching on the determining conditions) rather than giving a generic answer that would be true regardless?",
  criteria: [
    "Fully met. Answered as posed and addressed any false premise or missing input.",
    "Mostly met. Minor omissions that don't change whether the answer is useful.",
    "Partially met. Answered the literal question but left a material premise or missing input unaddressed.",
    "Not met. Technically true but misleading or unusable, because it ignored a false premise or the information the answer actually depends on.",
  ],
};

// ------------------------------------------------------------------- cases

const NEXT_PHASE_QUESTION = {
  type: "choice",
  instructions:
    "What should the primary next activity be, given what the conversation has established and what remains open? Judge the trajectory of the work — what has been decided and what is still unresolved — not the length or style of the most recent message.",
  criteria: {
    build:
      "Implementation, tests, mechanical debugging, or straightforward code changes. The decisions needed to act are already settled.",
    design:
      "Architecture, ambiguous requirements, nuanced tradeoffs, adversarial review, or difficult debugging. Something material is still unresolved.",
    general:
      "General conversation, investigation, or mixed work that neither implementation nor design specifically describes.",
  },
};

const IMPLEMENTATION_READY_QUESTION = {
  type: "noul",
  instructions:
    "Has the conversation reached the point where the primary next activity should be implementation rather than further design or discussion? Consider whether the material design decisions are settled enough to act on.",
  criteria: {
    true: "The open design questions are settled enough that the next useful action is writing or changing code.",
    false: "Material design questions remain open, or the conversation is still exploratory.",
  },
};

const TRAJECTORY_QUESTION = {
  type: "choice",
  instructions:
    "How is this conversation progressing? Judge the arc across recent turns — what has been resolved and what keeps recurring — not the quality or style of the most recent message.",
  criteria: {
    converging:
      "Each turn resolves something. The work is moving toward a conclusion, decision, or deliverable.",
    stuck_detail:
      "Turns keep adding finer detail without resolving the underlying question or reaching a decision. The work has lost altitude.",
    stuck_framing:
      "Turns circle the same issue in different words. Progress is blocked by how the problem is framed, not by missing effort.",
    early: "Too few turns, or too little substance, to judge progress.",
  },
};

// v2: judge the subject matter, not the conversation's momentum. The v1 wording
// told this question to "judge the trajectory of the work", which is the same
// instruction the trajectory question gets — so the two co-fire.
const NEXT_PHASE_QUESTION_V2 = {
  type: "choice",
  instructions:
    "What kind of work does this conversation need next? Judge the subject matter — what has been settled and what is still open — not how smoothly the conversation has been going.",
  criteria: {
    build:
      "Implementation, tests, mechanical debugging, or straightforward code changes. The decisions needed to act are already settled.",
    design:
      "Architecture, ambiguous requirements, nuanced tradeoffs, adversarial review, or difficult debugging. Something material is still unresolved.",
    general:
      "General conversation, investigation, or mixed work that neither implementation nor design specifically describes.",
  },
};

// v2: judge the process pattern, independent of subject matter. The v1 wording
// asked what "has been resolved and what keeps recurring" — the same basis the
// phase question used.
const TRAJECTORY_QUESTION_V2 = {
  type: "choice",
  instructions:
    "Is this conversation making progress, independent of what it is about? Judge the pattern across recent turns — is each turn covering new ground and resolving something, or is ground being revisited at increasing depth or in different words?",
  criteria: {
    converging:
      "Each turn covers new ground and resolves something. The conversation is moving toward a conclusion or decision.",
    stuck_detail:
      "Turns keep going deeper into detail without resolving anything or reaching a decision.",
    stuck_framing:
      "Turns revisit the same issue in different words. Progress is blocked by how the problem is framed, not by missing effort.",
    early: "Too few turns, or too little substance, to judge progress.",
  },
};

// v3: stuck_detail requires escalation or repetition, not mere unresolvedness. An
// early design conversation that keeps opening questions is not a spiral.
const TRAJECTORY_QUESTION_V3 = {
  type: "choice",
  instructions:
    "Is this conversation making progress, independent of what it is about? Judge the pattern across recent turns — is each turn covering new ground, or is the same ground being reworked at increasing depth or in different words?",
  criteria: {
    converging:
      "Each turn covers new ground and resolves something. The conversation is moving toward a conclusion or decision.",
    stuck_detail:
      "Turns keep escalating into finer detail on the same question, revisiting ground already covered, without resolving it or reaching a decision.",
    stuck_framing:
      "Turns revisit the same issue in different words. Progress is blocked by how the problem is framed, not by missing effort.",
    early: "Too few turns, or too little substance, to judge progress.",
  },
};

const REQUESTS = {
  "udp-db-uses": "UDP datagrams and what they can meaningfully be used for, like in databases?",
  "moq-basis": "UDP is just used as a basis for protocols like MOQ right?",
  "pg-vs-mysql":
    "I need to implement a high performance DB backend, would you recommend postgres or mysql",
  "udp-boundaries": "UDP preserves datagram boundaries, right?",
  "udp-reliable-false":
    "Since UDP is reliable and ordered, which databases use it for replication?",
  "pg-vs-redis": "Should we replace Postgres with Redis?",
};

const PRE_CASES = [
  { id: "udp-db-uses", expect: "decomp high · premise low" },
  { id: "moq-basis", expect: "decomp mid · premise ~0 (level 2)" },
  { id: "pg-vs-mysql", expect: "decomp HIGH (underdetermined) · premise low" },
  { id: "udp-boundaries", expect: "bounded high · premise ~0" },
  { id: "udp-reliable-false", expect: "premise HIGH (level 3)" },
  { id: "pg-vs-redis", expect: "decomp high · premise low" },
];

const POST_CASES = [
  {
    id: "pg-generic",
    request: "pg-vs-mysql",
    response:
      "Postgres is a great general-purpose choice, and MySQL can also be very performant in certain cases. Both have strong ecosystems, so either would work well for a high performance backend.",
    expect: "obligation 3 (true but useless)",
  },
  {
    id: "pg-good",
    request: "pg-vs-mysql",
    response:
      "That depends on what 'high performance' means for your workload, and the request doesn't pin it down. The determining inputs are: (1) OLTP vs analytical/columnar, (2) read/write ratio, (3) consistency and transaction needs, (4) scale and sharding strategy, (5) team operational experience. Postgres tends to win on complex queries, strong consistency, and extensions; MySQL/InnoDB often wins on simple high-throughput reads and mature replication. Tell me the workload shape and scale and I'll give a specific recommendation.",
    expect: "obligation 0 (surfaces missing inputs)",
  },
  {
    id: "moq-nuanced",
    request: "moq-basis",
    response:
      "Partially correct: MoQ's direct basis is QUIC, and QUIC runs on UDP, so UDP is the substrate rather than the layer MoQ is written against. QUIC supplies the reliability, ordering, and congestion control that raw UDP lacks. MoQ uses both QUIC streams and QUIC datagrams.",
    expect: "obligation 0 (corrects the framing)",
  },
  {
    id: "udp-uncorrected",
    request: "udp-reliable-false",
    response:
      "Many databases use UDP for replication. Its low overhead makes it attractive for high-throughput replication, and several key-value stores use UDP for gossip and heartbeats.",
    expect: "obligation 3 (premise uncorrected)",
  },
  {
    id: "udp-corrected",
    request: "udp-reliable-false",
    response:
      "Quick correction first: UDP is neither reliable nor ordered, so the premise needs adjusting. Databases that use UDP do so for loss-tolerant control-plane traffic such as gossip and heartbeats, not for reliable replication. Replication uses TCP or QUIC.",
    expect: "obligation 0 (premise corrected)",
  },
];

const SESSION_CASES = [
  {
    id: "s1-quic-udp",
    request: "so the quic protocol is just udp right?",
    expect: "bounded (one checkable claim)",
  },
  {
    id: "s2-pg-mysql-general",
    request:
      "oh ok, thanks. what about postgres vs mysql? just wanna know general use-cases and performance",
    expect: "user said this was over-decomposed",
  },
  {
    id: "s3-spring-scoped",
    request:
      "ok now you're just overcomplicating it. Let me define the scope a bit further: I want a Spring Boot project, and I'm starting from scratch. Which one would you recommend for a general use-case where performance doesn't really matter all that much but it follows best practices for development?",
    expect: "normal (scoped direct recommendation)",
  },
];

// Condensed assistant replies from the real session, used as history.
const SESSION_ANSWERS = {
  "s1-quic-udp":
    '**Claim: "QUIC is just UDP." — Incorrect.** The one grain of truth: QUIC packets are carried inside UDP datagrams, so on the wire you do see UDP. QUIC is its own transport protocol (RFC 9000) with TLS 1.3 integrated, its own loss detection and congestion control. UDP provides essentially none of what QUIC promises. QUIC rides UDP for deployability through NATs and firewalls, then rebuilds transport semantics in userspace.',
  "s2-pg-mysql-general":
    '## Decomposing the question\n"Postgres vs MySQL" is not one question. It is at least four, and the answers point in different directions: 1. How do they differ architecturally? 2. Performance for which workload shape? 3. What feature/ecosystem gaps force a choice? 4. What is the operational reality? ... [architecture table, performance by workload, benchmarks are skeptical, etc.]',
};

const SESSION_HISTORY = {
  "s1-quic-udp": [],
  "s2-pg-mysql-general": [
    { role: "user", text: SESSION_CASES[0].request },
    { role: "assistant", text: SESSION_ANSWERS["s1-quic-udp"] },
  ],
  "s3-spring-scoped": [
    { role: "user", text: SESSION_CASES[0].request },
    { role: "assistant", text: SESSION_ANSWERS["s1-quic-udp"] },
    { role: "user", text: SESSION_CASES[1].request },
    { role: "assistant", text: SESSION_ANSWERS["s2-pg-mysql-general"] },
  ],
};

// ----------------------------------------------------------------- runtime

const PHASE_CASES = [
  {
    id: "design-settled",
    turns: [
      { role: "user", text: "We need multi-tenancy in the API. How should we scope it?" },
      { role: "assistant", text: "Three shapes: shared schema with tenant_id, schema-per-tenant, or database-per-tenant. The tradeoff is isolation versus operational cost. Which matters most — isolation guarantees, migration simplicity, or per-tenant scale?" },
      { role: "user", text: "Isolation is the priority. Postgres, about 200 tenants, and migrations need to stay simple." },
      { role: "assistant", text: "Then shared schema with tenant_id plus row-level security is right. Database-per-tenant isolates hardest but 200 databases makes migrations painful. RLS gives the isolation without the migration sprawl." },
      { role: "user", text: "Agreed. Anything else to settle before we start?" },
      { role: "assistant", text: "Two small ones, both settleable now: the session variable name, and whether tenant resolution lives in middleware or the pool. Middleware is simpler and more testable. Pick those and the design is settled." },
      { role: "user", text: "app.tenant_id, middleware. Agreed." },
    ],
    expect: "build · ready HIGH",
  },
  {
    id: "design-open",
    turns: [
      { role: "user", text: "Should we move to event sourcing for the orders service?" },
      { role: "assistant", text: "It depends on whether you need a full audit trail and temporal queries, or just current state. Event sourcing changes how you handle schema evolution, projections, and replay — and it is hard to reverse once you commit." },
      { role: "user", text: "We do need an audit trail, but I am not sure about the operational burden." },
      { role: "assistant", text: "Then the open questions are: which events are authoritative, how projections are rebuilt, and whether you keep a relational read model. Until those are decided, an implementation would likely be thrown away." },
    ],
    expect: "design · ready low",
  },
  {
    id: "build-ambiguity",
    turns: [
      { role: "user", text: "Go ahead and add the tenant_id column and the RLS policies." },
      { role: "assistant", text: "Added tenant_id to the 14 tenant-scoped tables and the RLS policy migration. Tests pass." },
      { role: "user", text: "Now wire up the background job runner to set the tenant context." },
      { role: "assistant", text: "Working on it — but this surfaced an unresolved design question. Background jobs have no request middleware, so there is no natural place to set app.tenant_id. We need to decide whether jobs carry an explicit tenant argument or run under a service role that bypasses RLS. That changes the job API shape." },
    ],
    expect: "design (ambiguity surfaced)",
  },
  {
    id: "build-progress",
    turns: [
      { role: "user", text: "Add the tenant_id column and the RLS policies as we agreed." },
      { role: "assistant", text: "Added tenant_id to the 14 tenant-scoped tables, wrote the RLS migration, and updated the models. Tests pass." },
      { role: "user", text: "Now the middleware." },
      { role: "assistant", text: "Middleware added and wired into the request pipeline. It reads the tenant from the JWT claim, sets app.tenant_id on the connection, and resets it after the request. Added integration tests for cross-tenant leakage." },
    ],
    expect: "build",
  },
  {
    id: "detail-spiral",
    turns: [
      { role: "user", text: "How should we structure the config loader?" },
      { role: "assistant", text: "A layered loader: defaults, then file, then env, then flags. Should the merge be deep or shallow for nested objects?" },
      { role: "user", text: "Deep. What about arrays?" },
      { role: "assistant", text: "Concatenate or replace? And if concatenate, do duplicates dedupe? Should the dedupe be case-sensitive?" },
      { role: "user", text: "Hmm. What if the array holds objects — dedupe by identity or by a key?" },
      { role: "assistant", text: "By key, presumably, but which key? And should that be configurable per array? Then there is the question of ordering — does the file override or append?" },
      { role: "user", text: "And what about null versus missing?" },
      { role: "assistant", text: "Three states then: absent, explicit null, and defaulted. Does explicit null mean delete the key, or set it to null? And does that propagate to nested merges?" },
    ],
    expect: "stuck_detail",
  },
  {
    id: "framing-loop",
    turns: [
      { role: "user", text: "Our API is slow. How do we make it faster?" },
      { role: "assistant", text: "Where is the time going? We should profile before optimizing." },
      { role: "user", text: "I think it is the database. How do we make the database faster?" },
      { role: "assistant", text: "Adding indexes might help, but without a profile we do not know which queries matter. The framing may be the issue: \"the API is slow\" is not a measurable problem yet." },
      { role: "user", text: "Right, but suppose it is the database. What then?" },
      { role: "assistant", text: "The same answer: we need to know which query. We keep returning to the same point — the question assumes a cause that has not been established." },
      { role: "user", text: "OK but if it is the database, do we add indexes or rewrite the queries?" },
      { role: "assistant", text: "This is the same question again. Until we measure, \"add indexes or rewrite\" is unanswerable, and we have now covered it three times with different wording." },
    ],
    expect: "stuck_framing",
  },
  {
    id: "general-chat",
    turns: [
      { role: "user", text: "What does the team usually do for on-call rotations?" },
      { role: "assistant", text: "Usually a weekly rotation with a primary and a secondary, plus a documented escalation path. Happy to dig into specifics if you want." },
      { role: "user", text: "Just curious how it compares to what other teams do." },
    ],
    expect: "general",
  },
  {
    id: "early",
    turns: [{ role: "user", text: "What is a connection pool?" }],
    expect: "early",
  },
];

async function ask(state, questions) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state, questions }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

function noul(payload, id) {
  const answer = payload.answers?.[id];
  if (!answer || answer.type !== "noul") throw new Error(`missing noul answer: ${id}`);
  return answer.noul;
}

function scoreLevelProb(payload, id, level) {
  const answer = payload.answers?.[id];
  if (!answer || answer.type !== "score") throw new Error(`missing score answer: ${id}`);
  return answer.probabilities?.[String(level)] ?? 0;
}

function scoreExpected(payload, id) {
  const answer = payload.answers?.[id];
  if (!answer || answer.type !== "score") throw new Error(`missing score answer: ${id}`);
  return answer.score;
}

function choice(payload, id) {
  const answer = payload.answers?.[id];
  if (!answer || answer.type !== "choice") throw new Error(`missing choice answer: ${id}`);
  return answer.choice;
}

function choiceConfidence(payload, id) {
  const answer = payload.answers?.[id];
  if (!answer || answer.type !== "choice") throw new Error(`missing choice answer: ${id}`);
  return answer.confidence ?? 0;
}

const pad = (value, width) => String(value).padEnd(width);
const f3 = (value) => value.toFixed(3);

async function runPre() {
  console.log("\n=== PRE-GEN (request only) ===");
  console.log(
    `${pad("case", 20)}${pad("decomp", 8)}${pad("bounded", 8)}${pad("P(p=3)", 8)}${pad("E[p]", 6)}expectation`,
  );
  console.log("-".repeat(110));
  for (const testCase of PRE_CASES) {
    const payload = await ask(
      { user_request: REQUESTS[testCase.id] },
      {
        requires_decomposition: DECOMPOSITION_QUESTION,
        bounded_verification: BOUNDED_VERIFICATION_QUESTION,
        premise_defect: PREMISE_DEFECT_QUESTION,
      },
    );
    console.log(
      `${pad(testCase.id, 20)}${pad(f3(noul(payload, "requires_decomposition")), 8)}${pad(
        f3(noul(payload, "bounded_verification")),
        8,
      )}${pad(f3(scoreLevelProb(payload, "premise_defect", 3)), 8)}${pad(
        scoreExpected(payload, "premise_defect").toFixed(2),
        6,
      )}${testCase.expect}`,
    );
  }
}

async function runPost(label, answerQuestion, evasiveQuestion) {
  console.log(`\n=== POST-GEN ${label} (request + response) ===`);
  console.log(
    `${pad("case", 16)}${pad("answers", 8)}${pad("evasive", 8)}${pad("P(o=3)", 8)}${pad("E[o]", 6)}expectation`,
  );
  console.log("-".repeat(110));
  for (const testCase of POST_CASES) {
    const payload = await ask(
      {
        user_request: REQUESTS[testCase.request],
        assistant_response: testCase.response,
      },
      {
        answers_question: answerQuestion,
        evasive: evasiveQuestion,
        obligation_unmet: VERIFY_OBLIGATION_QUESTION,
      },
    );
    console.log(
      `${pad(testCase.id, 16)}${pad(f3(noul(payload, "answers_question")), 8)}${pad(
        f3(noul(payload, "evasive")),
        8,
      )}${pad(f3(scoreLevelProb(payload, "obligation_unmet", 3)), 8)}${pad(
        scoreExpected(payload, "obligation_unmet").toFixed(2),
        6,
      )}${testCase.expect}`,
    );
  }
}

async function runSessionWithHistory(label, decompQuestion, userOnly = false) {
  console.log(`\n=== SESSION + ${userOnly ? "USER-ONLY" : "FULL"} HISTORY — ${label} ===`);
  console.log(
    `${pad("case", 24)}${pad("decomp", 8)}${pad("bounded", 8)}${pad("P(p=3)", 8)}${pad("E[p]", 6)}note`,
  );
  console.log("-".repeat(115));
  for (const testCase of SESSION_CASES) {
    const history = (SESSION_HISTORY[testCase.id] ?? []).filter(
      (turn) => !userOnly || turn.role === "user",
    );
    const state =
      history.length > 0
        ? {
            recent_conversation: history.map((turn) => `${turn.role}: ${turn.text}`),
            user_request: testCase.request,
          }
        : { user_request: testCase.request };
    const payload = await ask(state, {
      requires_decomposition: decompQuestion,
      bounded_verification: BOUNDED_VERIFICATION_QUESTION,
      premise_defect: PREMISE_DEFECT_QUESTION,
    });
    console.log(
      `${pad(testCase.id, 24)}${pad(f3(noul(payload, "requires_decomposition")), 8)}${pad(
        f3(noul(payload, "bounded_verification")),
        8,
      )}${pad(f3(scoreLevelProb(payload, "premise_defect", 3)), 8)}${pad(
        scoreExpected(payload, "premise_defect").toFixed(2),
        6,
      )}${testCase.expect}`,
    );
  }
}

async function runSession(label, decompQuestion) {
  console.log(`\n=== SESSION REQUESTS — ${label} ===`);
  console.log(
    `${pad("case", 24)}${pad("decomp", 8)}${pad("bounded", 8)}${pad("P(p=3)", 8)}${pad("E[p]", 6)}note`,
  );
  console.log("-".repeat(115));
  for (const testCase of SESSION_CASES) {
    const payload = await ask(
      { user_request: testCase.request },
      {
        requires_decomposition: decompQuestion,
        bounded_verification: BOUNDED_VERIFICATION_QUESTION,
        premise_defect: PREMISE_DEFECT_QUESTION,
      },
    );
    console.log(
      `${pad(testCase.id, 24)}${pad(f3(noul(payload, "requires_decomposition")), 8)}${pad(
        f3(noul(payload, "bounded_verification")),
        8,
      )}${pad(f3(scoreLevelProb(payload, "premise_defect", 3)), 8)}${pad(
        scoreExpected(payload, "premise_defect").toFixed(2),
        6,
      )}${testCase.expect}`,
    );
  }
}

async function runPhase(label, nextPhaseQuestion, trajectoryQuestion, includeReady) {
  console.log(`\n=== PHASE / TRAJECTORY — ${label} ===`);
  console.log(
    `${pad("case", 18)}${pad("phase", 10)}${pad("pconf", 7)}${includeReady ? pad("ready", 7) : ""}${pad("trajectory", 14)}${pad("tconf", 7)}expectation`,
  );
  console.log("-".repeat(125));
  for (const testCase of PHASE_CASES) {
    const questions = { next_phase: nextPhaseQuestion, trajectory: trajectoryQuestion };
    if (includeReady) questions.implementation_ready = IMPLEMENTATION_READY_QUESTION;

    const payload = await ask(
      { recent_conversation: testCase.turns.map((turn) => `${turn.role}: ${turn.text}`) },
      questions,
    );
    const ready = includeReady ? pad(f3(noul(payload, "implementation_ready")), 7) : "";
    console.log(
      `${pad(testCase.id, 18)}${pad(choice(payload, "next_phase"), 10)}${pad(
        f3(choiceConfidence(payload, "next_phase")),
        7,
      )}${ready}${pad(choice(payload, "trajectory"), 14)}${pad(
        f3(choiceConfidence(payload, "trajectory")),
        7,
      )}${testCase.expect}`,
    );
  }
}

try {
  console.log(`model=${MODEL} endpoint=${ENDPOINT}`);
  const sessionOnly = process.argv.includes("--session-only");
  const phaseOnly = process.argv.includes("--phase-only");
  if (phaseOnly) {
    await runPhase("v1 (shipped wording)", NEXT_PHASE_QUESTION, TRAJECTORY_QUESTION, true);
    await runPhase("v2 (separated bases, no ready)", NEXT_PHASE_QUESTION_V2, TRAJECTORY_QUESTION_V2, false);
    await runPhase("v3 (separated bases + ready)", NEXT_PHASE_QUESTION_V2, TRAJECTORY_QUESTION_V2, true);
    await runPhase("v4 (tightened stuck_detail)", NEXT_PHASE_QUESTION_V2, TRAJECTORY_QUESTION_V3, false);
  } else if (sessionOnly) {
    await runSession("CURRENT main questions", DECOMPOSITION_QUESTION_CURRENT);
    await runSession("PROPOSED questions", DECOMPOSITION_QUESTION);
    await runSessionWithHistory("CURRENT main questions", DECOMPOSITION_QUESTION_CURRENT);
    await runSessionWithHistory("PROPOSED questions", DECOMPOSITION_QUESTION);
    await runSessionWithHistory("CURRENT main questions", DECOMPOSITION_QUESTION_CURRENT, true);
    await runSessionWithHistory("PROPOSED questions", DECOMPOSITION_QUESTION, true);
    await runSessionWithHistory("V3 insulated wording", DECOMPOSITION_QUESTION_V3);
  } else {
    await runPre();
    await runPost("v1", VERIFY_ANSWER_QUESTION, VERIFY_EVASIVE_QUESTION);
    await runPost("v2", VERIFY_ANSWER_QUESTION_V2, VERIFY_EVASIVE_QUESTION_V2);
    await runSession("CURRENT main questions", DECOMPOSITION_QUESTION_CURRENT);
    await runSession("PROPOSED questions", DECOMPOSITION_QUESTION);
    await runPhase("v1 (shipped wording)", NEXT_PHASE_QUESTION, TRAJECTORY_QUESTION, true);
    await runPhase("v2 (separated bases)", NEXT_PHASE_QUESTION_V2, TRAJECTORY_QUESTION_V2, false);
  }
  console.log("");
} catch (error) {
  console.error(`\neval failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
