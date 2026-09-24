import { callSystemOne, parseChoiceAnswer } from "./client.js";
import { TRAJECTORY_QUESTION } from "./questions.js";
import {
  TRAJECTORIES,
  type FooterMode,
  type HistoryTurn,
  type JevConfig,
  type Trajectory,
  type TrajectoryJudgment,
} from "./types.js";

const TRAJECTORY_ID = "trajectory";

/**
 * Post-generation trajectory judgment: is this conversation progressing?
 *
 * Orthogonal to the phase judgment. A conversation can be stuck while
 * implementing, or framing a problem badly during general conversation — so this
 * runs on its own, with its own toggle and threshold, and never gates the model
 * nudge.
 */
export async function judgeTrajectory(
  turns: HistoryTurn[],
  apiKey: string,
  config: JevConfig,
  parentSignal?: AbortSignal,
): Promise<TrajectoryJudgment> {
  const payload = await callSystemOne(
    { recent_conversation: turns.map((turn) => `${turn.role}: ${turn.text}`) },
    { [TRAJECTORY_ID]: TRAJECTORY_QUESTION },
    apiKey,
    config,
    parentSignal,
  );

  const trajectory = parseChoiceAnswer(payload, TRAJECTORY_ID, TRAJECTORIES);
  const judgment = {
    trajectory: trajectory.choice,
    trajectoryConfidence: trajectory.confidence,
  };
  return payload.model ? { ...judgment, model: payload.model } : judgment;
}

const TRAJECTORY_HINT: Partial<Record<Trajectory, { glyph: string; label: string }>> = {
  stuck_detail: { glyph: "♾️", label: "paralysis" },
  stuck_framing: { glyph: "🖼️", label: "framing" },
};

/** `undefined` clears the status indicator. */
export function formatCoaching(
  judgment: TrajectoryJudgment,
  mode: FooterMode = "compact",
  threshold = 0.7,
): string | undefined {
  if (mode === "off") return undefined;

  const hint = TRAJECTORY_HINT[judgment.trajectory];
  if (!hint || judgment.trajectoryConfidence < threshold) return undefined;

  return mode === "icons" ? hint.glyph : `${hint.glyph} ${hint.label}`;
}
