import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { FOOTER_MODES, PHASES, type FooterMode, type Phase } from "@mohan-cao/jev-classifier";

/** Mutable router state, shared with the hooks. */
export interface RouterState {
  enabled: boolean;
  debug: boolean;
  verify: boolean;
  phase: boolean;
  coaching: boolean;
  log: boolean;
  footer: FooterMode;
}

export interface RouterCommandDeps {
  readonly state: RouterState;
  /** Write the current state to the preferences file. */
  persist(): void;
  clearCache(): void;
  /** Clear the footer indicators the router owns. */
  clearStatuses(ctx: ExtensionContext): void;
  classify(prompt: string, ctx: ExtensionContext): Promise<void>;
  reportStatus(ctx: ExtensionContext): Promise<void>;
  /** Effective phase routes, and whether each came from preferences or the environment. */
  phaseRoutes(): PhaseRouteInfo[];
  /** Model ids the picker offers, deduped. */
  availableModels(ctx: ExtensionContext): string[];
  /** Persist a phase route (`""` clears it) and reload the phase config. */
  setRoute(phase: Phase, model: string): boolean;
}

export interface PhaseRouteInfo {
  phase: Phase;
  model: string;
  source: "preference" | "env";
}

interface RouterCommand {
  /** How the verb is written in help, arguments included. */
  usage: string;
  description: string;
  run(deps: RouterCommandDeps, rest: string, ctx: ExtensionContext): void | Promise<void>;
}

const TOGGLE_LABEL = {
  debug: "Jev response router debug notifications",
  verify: "Jev post-generation verification",
  phase: "Jev phase recommendation",
  coaching: "Jev coaching hint",
  log: "Jev decision log",
} as const;

function booleanToggle(value: string): boolean | undefined {
  if (value === "on") return true;
  if (value === "off") return false;
  return undefined;
}

function toggle(
  deps: RouterCommandDeps,
  verb: keyof typeof TOGGLE_LABEL,
  rest: string,
  ctx: ExtensionContext,
): void {
  const next = booleanToggle(rest);
  if (next === undefined) {
    ctx.ui.notify(`Usage: /jev-router ${verb} on|off`, "warning");
    return;
  }

  deps.state[verb] = next;
  deps.persist();
  if (!next) deps.clearStatuses(ctx);
  ctx.ui.notify(`${TOGGLE_LABEL[verb]} ${next ? "enabled" : "disabled"}`, "info");
}

const statusCommand: RouterCommand = {
  usage: "status",
  description: "show state, config, and the last judgments",
  run: (deps, _rest, ctx) => deps.reportStatus(ctx),
};

function isPhase(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value);
}

/** Tokens meaning "remove this route", so clearing needs no picker. */
const CLEAR_TOKENS = new Set(["clear", "off", "none", "unset"]);

/** Picker entry for clearing: a sentinel, so it cannot collide with a model id. */
const PICKER_CLEAR = "— clear —";

function describeRoutes(deps: RouterCommandDeps): string {
  const routes = deps.phaseRoutes();
  const lines = PHASES.map((phase) => {
    const route = routes.find((candidate) => candidate.phase === phase);
    return route ? `  ${phase}: ${route.model} (${route.source})` : `  ${phase}: unset`;
  });
  return `Jev phase routes:\n${lines.join("\n")}`;
}

/**
 * With a model id this is a plain setter; without one it opens the model picker,
 * so choosing a route does not mean knowing model ids by heart.
 */
async function chooseRoute(
  deps: RouterCommandDeps,
  rest: string,
  ctx: ExtensionContext,
): Promise<void> {
  const [phase, ...modelParts] = rest.split(/\s+/).filter(Boolean);
  if (!phase) {
    ctx.ui.notify(
      `${describeRoutes(deps)}\nPick one with /jev-router route <${PHASES.join("|")}>.`,
      "info",
    );
    return;
  }
  if (!isPhase(phase)) {
    ctx.ui.notify(`Unknown phase "${phase}". Use: ${PHASES.join(", ")}.`, "warning");
    return;
  }

  let model = modelParts.join(" ");
  if (!model) {
    const models = deps.availableModels(ctx);
    if (!ctx.hasUI || models.length === 0) {
      ctx.ui.notify(`Usage: /jev-router route ${phase} <model-id>`, "warning");
      return;
    }
    const choice = await ctx.ui.select(`Model for the ${phase} phase`, [...models, PICKER_CLEAR]);
    // Cancelling leaves the route alone rather than clearing it.
    if (choice === undefined) return;
    model = choice === PICKER_CLEAR ? "" : choice;
  }

  const next = model === "" || CLEAR_TOKENS.has(model.toLowerCase()) ? "" : model;
  const saved = deps.setRoute(phase, next);
  const outcome = next ? `set to ${next}` : "cleared";
  ctx.ui.notify(
    `Jev ${phase} route ${outcome}${saved ? "" : " (could not write preferences)"}`,
    saved ? "info" : "warning",
  );
}

const helpCommand: RouterCommand = {
  usage: "help",
  description: "list these commands",
  run: (_deps, _rest, ctx) => showHelp(ctx),
};

const COMMANDS = new Map<string, RouterCommand>([
  [
    "on",
    {
      usage: "on",
      description: "enable the router",
      run: (deps, _rest, ctx) => {
        deps.state.enabled = true;
        deps.persist();
        ctx.ui.notify("Jev response router enabled", "info");
      },
    },
  ],
  [
    "off",
    {
      usage: "off",
      description: "disable the router",
      run: (deps, _rest, ctx) => {
        deps.state.enabled = false;
        deps.persist();
        deps.clearStatuses(ctx);
        ctx.ui.notify("Jev response router disabled", "info");
      },
    },
  ],
  [
    "debug",
    {
      usage: "debug on|off",
      description: "toggle debug notifications",
      run: (deps, rest, ctx) => toggle(deps, "debug", rest, ctx),
    },
  ],
  [
    "verify",
    {
      usage: "verify on|off",
      description: "toggle post-generation verification",
      run: (deps, rest, ctx) => toggle(deps, "verify", rest, ctx),
    },
  ],
  [
    "phase",
    {
      usage: "phase on|off",
      description: "toggle the model nudge (work phase vs running model)",
      run: (deps, rest, ctx) => toggle(deps, "phase", rest, ctx),
    },
  ],
  [
    "coaching",
    {
      usage: "coaching on|off",
      description: "toggle the stuck-conversation hint",
      run: (deps, rest, ctx) => toggle(deps, "coaching", rest, ctx),
    },
  ],
  [
    "log",
    {
      usage: "log on|off",
      description: "append one JSON line per settled turn to a local file",
      run: (deps, rest, ctx) => toggle(deps, "log", rest, ctx),
    },
  ],
  [
    "footer",
    {
      usage: "footer compact|icons|off",
      description: "set how footer statuses render",
      run: (deps, rest, ctx) => {
        if (!(FOOTER_MODES as readonly string[]).includes(rest)) {
          ctx.ui.notify(
            `Unknown footer mode "${rest}". Use: ${FOOTER_MODES.join(", ")}.`,
            "warning",
          );
          return;
        }
        deps.state.footer = rest as FooterMode;
        deps.persist();
        ctx.ui.notify(`Jev footer mode: ${deps.state.footer}`, "info");
      },
    },
  ],
  [
    "route",
    {
      usage: "route <phase> [model]",
      description: "pick the model for a phase, from the available models",
      run: chooseRoute,
    },
  ],
  [
    "clear-cache",
    {
      usage: "clear-cache",
      description: "clear the classification cache",
      run: (deps, _rest, ctx) => {
        deps.clearCache();
        ctx.ui.notify("Jev classification cache cleared", "info");
      },
    },
  ],
  [
    "classify",
    {
      usage: "classify <text>",
      description: "classify text without invoking the main model",
      run: (deps, rest, ctx) => {
        if (!rest) {
          ctx.ui.notify("Usage: /jev-router classify <text>", "warning");
          return;
        }
        return deps.classify(rest, ctx);
      },
    },
  ],
  ["status", statusCommand],
  ["help", helpCommand],
]);

/** Slash-command description, kept in step with the table above. */
export const ROUTER_COMMAND_DESCRIPTION = `Jev router: ${[...COMMANDS.values()]
  .map((command) => command.usage)
  .join(" | ")}`;

export function showHelp(ctx: ExtensionContext): void {
  ctx.ui.notify(
    [...COMMANDS.values()]
      .map((command) => `/jev-router ${command.usage} — ${command.description}`)
      .join("\n"),
    "info",
  );
}

/** Unknown verbs and empty input fall through to `status`. */
export function createRouterCommandHandler(deps: RouterCommandDeps) {
  return async (rawArgs: string, ctx: ExtensionContext): Promise<void> => {
    const [verb = "", ...rest] = rawArgs.trim().split(/\s+/);
    const command = COMMANDS.get(verb) ?? statusCommand;
    await command.run(deps, rest.join(" "), ctx);
  };
}
