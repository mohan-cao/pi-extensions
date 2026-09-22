import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

const MAX_TURN_CHARS = 2_000;

/** Flatten an assistant/user message content payload into plain text. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      parts.push(candidate.text);
    }
  }
  return parts.join("\n");
}

function clamp(text: string): string {
  return text.length > MAX_TURN_CHARS ? `${text.slice(0, MAX_TURN_CHARS)}…` : text;
}

/**
 * Recent conversation turns for classifier context. Without this, follow-ups
 * ("what about the second one?") are unclassifiable in isolation. Bounded on
 * purpose so Jev input cost stays flat.
 */
export function recentHistory(
  ctx: ExtensionContext,
  turns: number,
  currentPrompt: string,
): HistoryTurn[] {
  if (turns <= 0) return [];

  const branch = ctx.sessionManager.getBranch();
  const collected: HistoryTurn[] = [];

  for (let i = branch.length - 1; i >= 0 && collected.length < turns * 2; i -= 1) {
    const entry = branch[i];
    if (!entry || entry.type !== "message") continue;

    const message = entry.message;
    if (message.role !== "user" && message.role !== "assistant") continue;

    const text = clamp(messageText(message.content).trim());
    if (!text) continue;
    collected.push({ role: message.role, text });
  }

  collected.reverse();

  // `before_agent_start` may run before the current prompt is persisted. Drop a
  // trailing user turn that is just the prompt we are about to classify.
  const last = collected[collected.length - 1];
  if (last && last.role === "user" && last.text.trim() === currentPrompt.trim()) {
    collected.pop();
  }

  return collected.slice(-turns * 2);
}

export function buildState(prompt: string, history: HistoryTurn[]): unknown {
  if (history.length === 0) return { user_request: prompt };
  return {
    recent_conversation: history.map((turn) => `${turn.role}: ${turn.text}`),
    user_request: prompt,
  };
}
