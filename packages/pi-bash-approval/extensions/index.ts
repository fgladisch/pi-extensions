import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import type {
  BashApprovalAllowedEvent,
  BashApprovalBlockedEvent,
  BashApprovalClosedEvent,
  BashApprovalConfig,
  BashApprovalConfigLoadedEvent,
  BashApprovalDecision,
  BashApprovalEvaluatedEvent,
  BashApprovalOption,
  BashApprovalReloadedEvent,
  BashApprovalRequestEvent,
  BashApprovalResolvedEvent,
  BashApprovalResponse,
  BashApprovalRulePersistedEvent,
  InteractionSource,
  RespondResult,
} from "./models";
import {
  applyChoice,
  BLOCKED_BY_USER,
  buildPromptOptions,
  DENY,
  evaluateCommand,
  loadConfig,
} from "./utils";

const PLUGIN_NAME = "pi-bash-approval";
const ALLOW_ONCE = "Allow once";

type Controller<T> = {
  readonly promise: Promise<T>;
  readonly isSettled: () => boolean;
  readonly accept: (value: T) => boolean;
  readonly fail: (error: unknown) => boolean;
};

type BashDecision = {
  readonly selectedBy: InteractionSource;
  readonly decision: BashApprovalDecision;
  readonly choice?: string;
};

type EventCapablePi = ExtensionAPI & {
  readonly events?: {
    readonly emit?: (name: string, data: unknown) => void;
  };
};

type CwdContext = {
  readonly cwd?: string;
};

export default function (pi: ExtensionAPI) {
  let config: BashApprovalConfig = loadConfig();
  emitConfigLoaded(pi, config);

  pi.registerCommand("bash-approval-reload", {
    description:
      "Reload bash approval rules from ~/.pi/agent/.bash-approval and settings from ~/.pi/agent/settings.json",
    // eslint-disable-next-line @typescript-eslint/require-await -- API requires Promise<void>
    handler: async (_args, ctx) => {
      config = loadConfig();
      ctx.ui.notify(
        `Reloaded ${config.allowed.length} bash approval rule(s)`,
        "info",
      );
      const reloadedEvent: BashApprovalReloadedEvent = {
        plugin: PLUGIN_NAME,
        allowedCount: config.allowed.length,
        splitChains: config.splitChains,
        source: "command",
        createdAt: new Date().toISOString(),
      };
      emitSafe(pi, "pi-bash-approval:reloaded", reloadedEvent);
    },
  });

  pi.registerCommand("bash-approval-list", {
    description: "Show currently allowed bash command patterns",
    // eslint-disable-next-line @typescript-eslint/require-await -- API requires Promise<void>
    handler: async (_args, ctx) => {
      if (config.allowed.length === 0) {
        ctx.ui.notify("No bash approval rules configured", "info");
        return;
      }

      ctx.ui.notify(
        `Allowed bash patterns:\n - ${config.allowed.join("\n - ")}`,
        "info",
      );
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) {
      return;
    }

    const command = String(event.input.command ?? "");
    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      return;
    }

    const toolCallId = event.toolCallId;
    const cwd = (ctx as CwdContext).cwd ?? process.cwd();
    const evaluation = evaluateCommand(command, config);
    const createdAt = new Date().toISOString();

    const evaluatedEvent: BashApprovalEvaluatedEvent = {
      plugin: PLUGIN_NAME,
      toolCallId,
      cwd,
      command,
      trimmedCommand,
      allMatch: evaluation.allMatch,
      failingSegment: evaluation.allMatch
        ? undefined
        : evaluation.failingSegment,
      splitChains: config.splitChains,
      createdAt,
    };
    emitSafe(pi, "pi-bash-approval:evaluated", evaluatedEvent);

    if (evaluation.allMatch) {
      emitAllowed(pi, {
        toolCallId,
        cwd,
        command,
        mode: "allowlist",
        createdAt,
      });
      return;
    }

    const { failingSegment } = evaluation;
    const nonInteractiveReason = `Bash command not on allow-list (configure ~/.pi/agent/.bash-approval; split behavior in ~/.pi/agent/settings.json): ${trimmedCommand}`;

    if (!ctx.hasUI) {
      emitBlocked(pi, {
        toolCallId,
        cwd,
        command,
        reason: nonInteractiveReason,
        createdAt,
      });

      return { block: true, reason: nonInteractiveReason };
    }

    const prompt = buildPromptOptions(trimmedCommand, failingSegment, config);
    const options = buildEventOptions(prompt.options, prompt.rulesByOption);
    const requestBase = {
      requestId: randomUUID(),
      plugin: PLUGIN_NAME,
      kind: "bash_approval",
      toolCallId,
      cwd,
      createdAt,
    } as const;
    const controller = createController<BashDecision>();
    let closedReason: BashApprovalClosedEvent["reason"] = "resolved";

    const requestEvent: BashApprovalRequestEvent = {
      ...requestBase,
      command,
      trimmedCommand,
      failingSegment,
      options,
      respond: (response) =>
        respondToBashApproval(response, options, controller),
    };

    try {
      emitSafe(pi, "pi-bash-approval:request", requestEvent);

      if (!controller.isSettled()) {
        void resolveLocalDecision(
          prompt.options,
          prompt.rulesByOption,
          (message, selectOptions) => ctx.ui.select(message, selectOptions),
          command,
          failingSegment,
          controller.isSettled,
        ).then(
          (decision) => {
            if (decision) {
              controller.accept(decision);
            }
          },
          (error: unknown) => {
            controller.fail(error);
          },
        );
      }

      const bashDecision = await controller.promise;
      const resolvedEvent: BashApprovalResolvedEvent = {
        ...requestBase,
        command,
        selectedBy: bashDecision.selectedBy,
        decision: bashDecision.decision,
      };
      emitSafe(pi, "pi-bash-approval:resolved", resolvedEvent);

      if (bashDecision.decision.action === "deny") {
        const reason = bashDecision.decision.reason ?? BLOCKED_BY_USER;
        emitBlocked(pi, {
          requestId: requestBase.requestId,
          toolCallId,
          cwd,
          command,
          reason,
          selectedBy: bashDecision.selectedBy,
          createdAt,
        });

        return { block: true, reason };
      }

      if (bashDecision.decision.action === "allow_always") {
        const choice =
          bashDecision.choice ??
          findChoiceForRule(prompt.rulesByOption, bashDecision.decision.rule);
        const persisted = choice
          ? applyChoice(choice, prompt, config, ctx)
          : null;

        if (persisted) {
          const rulePersistedEvent: BashApprovalRulePersistedEvent = {
            plugin: PLUGIN_NAME,
            requestId: requestBase.requestId,
            toolCallId,
            rule: persisted.rule,
            path: persisted.path,
            success: persisted.success,
            error: persisted.error,
            createdAt: new Date().toISOString(),
          };
          emitSafe(pi, "pi-bash-approval:rule_persisted", rulePersistedEvent);
        }

        emitAllowed(pi, {
          requestId: requestBase.requestId,
          toolCallId,
          cwd,
          command,
          mode: "allow_always",
          selectedBy: bashDecision.selectedBy,
          rule: bashDecision.decision.rule,
          createdAt,
        });
        return;
      }

      emitAllowed(pi, {
        requestId: requestBase.requestId,
        toolCallId,
        cwd,
        command,
        mode: "allow_once",
        selectedBy: bashDecision.selectedBy,
        createdAt,
      });
      return;
    } catch (error: unknown) {
      closedReason = "error";
      throw error;
    } finally {
      const closedEvent: BashApprovalClosedEvent = {
        ...requestBase,
        reason: closedReason,
      };
      emitSafe(pi, "pi-bash-approval:closed", closedEvent);
    }
  });
}

function createController<T>(): Controller<T> {
  let settled = false;
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    isSettled: () => settled,
    accept: (value) => {
      if (settled) {
        return false;
      }

      settled = true;
      resolvePromise(value);
      return true;
    },
    fail: (error) => {
      if (settled) {
        return false;
      }

      settled = true;
      rejectPromise(error);
      return true;
    },
  };
}

function buildEventOptions(
  labels: readonly string[],
  rulesByOption: Record<string, string>,
): BashApprovalOption[] {
  return labels.map((label, index) => {
    if (label === ALLOW_ONCE) {
      return { id: "allow_once", label: ALLOW_ONCE, action: "allow_once" };
    }

    if (label === DENY) {
      return { id: "deny", label: DENY, action: "deny" };
    }

    return {
      id: `allow_always_${index}`,
      label,
      action: "allow_always",
      rule: rulesByOption[label] ?? label,
    };
  });
}

async function resolveLocalDecision(
  promptOptions: readonly string[],
  rulesByOption: Record<string, string>,
  select: (
    message: string,
    options: string[],
  ) => Promise<string | null | undefined>,
  command: string,
  failingSegment: string,
  isAlreadyResolved: () => boolean,
): Promise<BashDecision | null> {
  const choice = await select(
    `Bash command not on allow-list:\n\n${command}\n\nFirst failing segment: ${failingSegment}`,
    [...promptOptions],
  );

  if (isAlreadyResolved()) {
    return null;
  }

  if (!choice || choice === DENY) {
    return {
      selectedBy: "local",
      decision: { action: "deny", reason: BLOCKED_BY_USER },
      choice: choice ?? undefined,
    };
  }

  const rule = rulesByOption[choice];
  if (rule) {
    return {
      selectedBy: "local",
      decision: { action: "allow_always", rule },
      choice,
    };
  }

  return {
    selectedBy: "local",
    decision: { action: "allow_once" },
    choice,
  };
}

function respondToBashApproval(
  response: BashApprovalResponse,
  options: readonly BashApprovalOption[],
  controller: Controller<BashDecision>,
): RespondResult {
  if (controller.isSettled()) {
    return { accepted: false, reason: "already_resolved" };
  }

  const decision = remoteBashDecision(response, options);
  if (!decision) {
    return { accepted: false, reason: "invalid_response" };
  }

  controller.accept(decision);
  return { accepted: true };
}

function remoteBashDecision(
  response: BashApprovalResponse,
  options: readonly BashApprovalOption[],
): BashDecision | null {
  if (!isRecord(response) || response.source !== "remote") {
    return null;
  }

  if (response.action === "allow_once") {
    return { selectedBy: "remote", decision: { action: "allow_once" } };
  }

  if (response.action === "deny") {
    return {
      selectedBy: "remote",
      decision: { action: "deny", reason: response.reason ?? BLOCKED_BY_USER },
    };
  }

  const option = options.find(
    (candidate) =>
      candidate.id === response.optionId &&
      candidate.action === "allow_always" &&
      candidate.rule === response.rule,
  );

  if (!option || option.action !== "allow_always") {
    return null;
  }

  return {
    selectedBy: "remote",
    decision: { action: "allow_always", rule: option.rule },
    choice: option.label,
  };
}

function findChoiceForRule(
  rulesByOption: Record<string, string>,
  rule: string,
): string | undefined {
  return Object.entries(rulesByOption)
    .find(([, candidate]) => candidate === rule)
    ?.at(0);
}

function emitConfigLoaded(pi: ExtensionAPI, config: BashApprovalConfig): void {
  const configLoadedEvent: BashApprovalConfigLoadedEvent = {
    plugin: PLUGIN_NAME,
    allowedCount: config.allowed.length,
    splitChains: config.splitChains,
    createdAt: new Date().toISOString(),
  };
  emitSafe(pi, "pi-bash-approval:config_loaded", configLoadedEvent);
}

function emitAllowed(
  pi: ExtensionAPI,
  event: Omit<BashApprovalAllowedEvent, "plugin">,
): void {
  const allowedEvent: BashApprovalAllowedEvent = {
    plugin: PLUGIN_NAME,
    ...event,
  };
  emitSafe(pi, "pi-bash-approval:allowed", allowedEvent);
}

function emitBlocked(
  pi: ExtensionAPI,
  event: Omit<BashApprovalBlockedEvent, "plugin">,
): void {
  const blockedEvent: BashApprovalBlockedEvent = {
    plugin: PLUGIN_NAME,
    ...event,
  };
  emitSafe(pi, "pi-bash-approval:blocked", blockedEvent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function emitSafe(pi: ExtensionAPI, name: string, data: unknown): void {
  try {
    (pi as EventCapablePi).events?.emit?.(name, data);
  } catch {
    // Event listeners must not break bash approval behavior.
  }
}
