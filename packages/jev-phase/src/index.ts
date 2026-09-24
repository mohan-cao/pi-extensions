/**
 * The phase signal.
 *
 * Judges what kind of work a conversation needs next — implementation, design,
 * or general — and reports it as an **indicator**. It is not a routing input:
 * its consumer is the reader's own sense of whether a session is advancing
 * toward its goal or circling one part of the problem. No internal measurement
 * can make that judgement, and this package does not attempt to.
 *
 * See `docs/design/classifier-scope.md` for why that distinction is the whole
 * scope of this component.
 */

import {
  callSystemOne,
  parseChoiceAnswer,
  type ChoiceQuestionSpec,
  type FooterMode,
  type HistoryTurn,
  type JevConfig,
} from "@mohan-cao/jev-classifier";

export const PHASES = ["build", "design", "general"] as const;
export type Phase = (typeof PHASES)[number];

/** What the phase judge observed. */
export interface PhaseJudgment {
  /** The phase the next work should be in. Never `stay` — that is a policy decision. */
  phase: Phase;
  phaseConfidence: number;
  model?: string;
}

export interface PhaseRoute {
  model: string;
  thinking?: string;
  steering?: string;
}

/**
 * Model policy for the phase nudge.
 *
 * Retained for the routing experiment, but see the README: the package's
 * supported use is the indicator, not the recommendation.
 */
export interface PhaseConfig {
  /** phase → the model that serves it. Empty means the nudge is inert. */
  routes: Partial<Record<Phase, PhaseRoute>>;
  /** Minimum Choice confidence before a nudge is shown. */
  phaseConfidenceThreshold: number;
  /** Conversation turns supplied to the phase judge. */
  historyTurns: number;
}

/**
 * Present only when the running model is known to serve a different phase than
 * the work is moving into. An unmapped current model yields no nudge — we cannot
 * say it is wrong.
 */
export interface PhaseRecommendation {
  phase: Phase;
  /** The model configured for that phase, when the routes map has one. */
  model?: string;
  /** The phase the running model serves. */
  currentPhase: Phase;
}

export const NEXT_PHASE_QUESTION: ChoiceQuestionSpec = {
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

const PHASE_ID = "next_phase";

/**
 * Post-generation phase judgment.
 *
 * Its own call, not shared with verification or the trajectory judgment. They
 * read different state (the last exchange vs the conversation) and are
 * conceptually independent — and questions sharing a call can perturb each
 * other, which is how `implementation_ready` ended up flipping another answer.
 */
export async function judgePhase(
  turns: HistoryTurn[],
  apiKey: string,
  config: JevConfig,
  parentSignal?: AbortSignal,
): Promise<PhaseJudgment> {
  const payload = await callSystemOne(
    { recent_conversation: turns.map((turn) => `${turn.role}: ${turn.text}`) },
    { [PHASE_ID]: NEXT_PHASE_QUESTION },
    apiKey,
    config,
    parentSignal,
  );

  const phase = parseChoiceAnswer(payload, PHASE_ID, PHASES);
  const judgment = { phase: phase.choice, phaseConfidence: phase.confidence };
  return payload.model ? { ...judgment, model: payload.model } : judgment;
}

function modelForPhase(phase: Phase, config: PhaseConfig): string | undefined {
  return config.routes[phase]?.model;
}

function phaseForModel(modelId: string | undefined, config: PhaseConfig): Phase | undefined {
  if (!modelId) return undefined;
  for (const phase of PHASES) {
    if (config.routes[phase]?.model === modelId) return phase;
  }
  return undefined;
}

/**
 * Deterministic. Recommends only when the running model is *known* to serve a
 * different phase — an unmapped model yields no nudge, because we cannot say it
 * is wrong and "surface deviations" means staying quiet otherwise.
 */
export function phaseRecommendation(
  judgment: PhaseJudgment,
  currentModelId: string | undefined,
  config: PhaseConfig,
): PhaseRecommendation | undefined {
  if (judgment.phaseConfidence < config.phaseConfidenceThreshold) return undefined;

  const currentPhase = phaseForModel(currentModelId, config);
  if (!currentPhase || currentPhase === judgment.phase) return undefined;

  const model = modelForPhase(judgment.phase, config);
  if (!model) return undefined;

  return { phase: judgment.phase, model, currentPhase };
}

const PHASE_GLYPH = { build: "🔨", design: "📐", general: "💬" } satisfies Record<Phase, string>;

/** `undefined` clears the status indicator. */
export function formatPhaseNudge(
  recommendation: PhaseRecommendation | undefined,
  mode: FooterMode = "compact",
): string | undefined {
  if (!recommendation || mode === "off") return undefined;
  if (mode === "icons") return `↪${PHASE_GLYPH[recommendation.phase]}`;
  return recommendation.model
    ? `↪ ${recommendation.phase} · ${recommendation.model}`
    : `↪ ${recommendation.phase}`;
}
