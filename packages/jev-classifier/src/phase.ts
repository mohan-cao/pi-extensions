import { callSystemOne, parseChoiceAnswer, parseNoulAnswer } from "./client.js";
import {
  IMPLEMENTATION_READY_QUESTION,
  NEXT_PHASE_QUESTION,
  TRAJECTORY_QUESTION,
} from "./questions.js";
import {
  PHASES,
  TRAJECTORIES,
  type FooterMode,
  type HistoryTurn,
  type Phase,
  type PhaseConfig,
  type PhaseJudgment,
  type PhaseRecommendation,
  type RouterConfig,
  type Trajectory,
} from "./types.js";

const PHASE_ID = "next_phase";
const READY_ID = "implementation_ready";
const TRAJECTORY_ID = "trajectory";

/**
 * Post-generation phase judgment. Deliberately a separate call from quality
 * verification: it needs conversation history, and history measurably
 * contaminates a quality judgment (see the repository's eval harness).
 */
export async function judgePhase(
  turns: HistoryTurn[],
  apiKey: string,
  config: RouterConfig,
  parentSignal?: AbortSignal,
): Promise<PhaseJudgment> {
  const payload = await callSystemOne(
    { recent_conversation: turns.map((turn) => `${turn.role}: ${turn.text}`) },
    {
      [PHASE_ID]: NEXT_PHASE_QUESTION,
      [READY_ID]: IMPLEMENTATION_READY_QUESTION,
      [TRAJECTORY_ID]: TRAJECTORY_QUESTION,
    },
    apiKey,
    config,
    parentSignal,
  );

  const phase = parseChoiceAnswer(payload, PHASE_ID, PHASES);
  const trajectory = parseChoiceAnswer(payload, TRAJECTORY_ID, TRAJECTORIES);

  const judgment = {
    phase: phase.choice,
    phaseConfidence: phase.confidence,
    implementationReady: parseNoulAnswer(payload, READY_ID),
    trajectory: trajectory.choice,
    trajectoryConfidence: trajectory.confidence,
  };
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

  // The `design → build` move is the noisy one: a reasoning model under
  // design-shaped steering keeps producing design-shaped work. Corroborate it.
  if (
    currentPhase === "design" &&
    judgment.phase === "build" &&
    judgment.implementationReady < config.implementationReadyThreshold
  ) {
    return undefined;
  }

  const model = modelForPhase(judgment.phase, config);
  if (!model) return undefined;

  return { phase: judgment.phase, model, currentPhase };
}

const PHASE_GLYPH = { build: "🔨", design: "📐", general: "💬" } satisfies Record<Phase, string>;

const TRAJECTORY_HINT: Partial<Record<Trajectory, { glyph: string; label: string }>> = {
  stuck_detail: { glyph: "♾️", label: "paralysis" },
  stuck_framing: { glyph: "🖼️", label: "framing" },
};

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

/**
 * Display-only coaching. Never gates a recommendation and never changes routing —
 * it exists so a user who is stuck without knowing it gets told which kind.
 */
export function formatCoaching(
  judgment: PhaseJudgment,
  mode: FooterMode = "compact",
  threshold = 0.7,
): string | undefined {
  if (mode === "off") return undefined;

  const hint = TRAJECTORY_HINT[judgment.trajectory];
  if (!hint || judgment.trajectoryConfidence < threshold) return undefined;

  return mode === "icons" ? hint.glyph : `${hint.glyph} ${hint.label}`;
}
