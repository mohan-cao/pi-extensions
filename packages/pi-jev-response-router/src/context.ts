import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { HistoryTurn } from "@mohan-cao/jev-classifier";

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

export interface Exchange {
  request: string;
  response: string;
}

/** Last assistant answer and the user request that prompted it. */
export function lastExchange(ctx: ExtensionContext): Exchange | undefined {
  const branch = ctx.sessionManager.getBranch();
  let response: string | undefined;
  let request = "";

  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (!entry || entry.type !== "message") continue;

    const message = entry.message;
    if (message.role === "assistant" && response === undefined) {
      // A partial or failed answer is not a real candidate for verification.
      if (message.stopReason === "aborted" || message.stopReason === "error") {
        return undefined;
      }
      const text = messageText(message.content).trim();
      if (text) response = text;
      continue;
    }

    if (message.role === "user" && response !== undefined) {
      const text = messageText(message.content).trim();
      if (text) {
        request = text;
        break;
      }
    }
  }

  if (response === undefined) return undefined;
  return { request, response: clamp(response) };
}
