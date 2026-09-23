import { callSystemOne, parseChoiceAnswer } from "./client.js";
import { NEXT_PHASE_QUESTION } from "./questions.js";
import {
  PHASES,
  type FooterMode,
  type HistoryTurn,
  type Phase,
  type PhaseConfig,
  type PhaseJudgment,
  type PhaseRecommendation,
  type RouterConfig,
} from "./types.js";

const PHASE_ID = "next_phase";

/**
 * Post-generation phase judgment: what kind of work the conversation needs next.
 *
 * Its own call, not shared with verification or the trajectory judgment. They
 * read different state (the last exchange vs the conversation) and are
 * conceptually independent — and questions sharing a call can perturb each
 * other, which is how `implementation_ready` ended up flipping another answer.
 */
export async function judgePhase(
  turns: HistoryTurn[],
  apiKey: string,
  config: RouterConfig,
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
