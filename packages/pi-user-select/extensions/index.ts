import type {
  ExtensionAPI,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import type {
  CustomInputRequestEvent,
  CustomInputResponse,
  ExecuteResult,
  InteractionSource,
  RespondResult,
  UserSelectClosedEvent,
  UserSelectErrorEvent,
  UserSelectInput,
  UserSelectRequestEvent,
  UserSelectResolvedEvent,
  UserSelectResponse,
} from "./models";
import {
  buildDisplayOptions,
  cancelledResult,
  customAnswerResult,
  getCustomAnswerLabel,
  resolveSelectedOption,
  selectedOptionResult,
  UserSelectParamsSchema,
  wasCancelled,
} from "./utils";

const TOOL_NAME = "user_select";
const PLUGIN_NAME = "pi-user-select";

type SelectionResult = UserSelectResolvedEvent["result"];

type Decision = {
  readonly selectedBy: InteractionSource;
  readonly result: SelectionResult;
  readonly executeResult: ExecuteResult;
};

type Controller<T> = {
  readonly promise: Promise<T>;
  readonly isSettled: () => boolean;
  readonly accept: (value: T) => boolean;
  readonly fail: (error: unknown) => boolean;
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
  pi.registerTool({
    name: TOOL_NAME,
    label: "User Select",
    description:
      "Ask user a multiple-choice question and return the selection. Use when a skill workflow needs explicit human input to disambiguate, confirm, or choose between options. Set allowCustom=true to also offer a free-text answer.",
    promptSnippet: "Ask user a multiple-choice question and get an answer",
    promptGuidelines: [
      `Use ${TOOL_NAME} when you need a binary or small-N decision from the user instead of guessing or asking in plain text.`,
      `Always provide concrete, mutually exclusive options to ${TOOL_NAME}; only set allowCustom=true when free-form input is genuinely useful.`,
    ],
    parameters: UserSelectParamsSchema,
    async execute(
      toolCallId,
      params: UserSelectInput,
      _signal,
      _onUpdate,
      ctx,
    ) {
      const { question, options, allowCustom = false } = params;
      const { hasUI, ui } = ctx;

      if (options.length === 0) {
        throw new Error(`${TOOL_NAME}: at least one option required`);
      }

      if (!hasUI) {
        throw new Error(
          `${TOOL_NAME}: no interactive UI available (running in non-interactive mode)`,
        );
      }

      const requestBase = {
        requestId: randomUUID(),
        plugin: PLUGIN_NAME,
        kind: "select",
        toolCallId,
        cwd: (ctx as CwdContext).cwd,
        createdAt: new Date().toISOString(),
      } as const;
      const displayOptions = buildDisplayOptions(options, allowCustom);
      const controller = createController<Decision>();
      const localPromptAbort = new AbortController();
      let closedReason: UserSelectClosedEvent["reason"] = "resolved";

      const requestEvent: UserSelectRequestEvent = {
        ...requestBase,
        question,
        options: options.map((option, index) => ({
          index,
          label: option.label,
          description: option.description,
          displayLabel: displayOptions.at(index) ?? option.label,
        })),
        allowCustom,
        respond: (response) =>
          respondToUserSelect(
            response,
            params,
            controller,
            allowCustom,
            localPromptAbort,
          ),
      };

      try {
        emitSafe(pi, "pi-user-select:request", requestEvent);

        if (!controller.isSettled()) {
          void resolveLocalSelection(
            pi,
            params,
            ui,
            requestBase,
            displayOptions,
            controller,
            localPromptAbort,
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

        const decision = await controller.promise;
        const resolvedEvent: UserSelectResolvedEvent = {
          ...requestBase,
          selectedBy: decision.selectedBy,
          result: decision.result,
        };
        emitSafe(pi, "pi-user-select:resolved", resolvedEvent);

        return decision.executeResult;
      } catch (error: unknown) {
        closedReason = "error";
        const errorEvent: UserSelectErrorEvent = {
          ...requestBase,
          error: errorMessage(error),
        };
        emitSafe(pi, "pi-user-select:error", errorEvent);
        throw error;
      } finally {
        const closedEvent: UserSelectClosedEvent = {
          ...requestBase,
          reason: closedReason,
        };
        emitSafe(pi, "pi-user-select:closed", closedEvent);
      }
    },
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

function respondToUserSelect(
  response: UserSelectResponse,
  params: UserSelectInput,
  controller: Controller<Decision>,
  allowCustom: boolean,
  localPromptAbort: AbortController,
): RespondResult {
  if (controller.isSettled()) {
    return { accepted: false, reason: "already_resolved" };
  }

  const decision = remoteUserSelectDecision(response, params, allowCustom);
  if (!decision) {
    return { accepted: false, reason: "invalid_response" };
  }

  if (!controller.accept(decision)) {
    return { accepted: false, reason: "already_resolved" };
  }

  localPromptAbort.abort();
  return { accepted: true };
}

function remoteUserSelectDecision(
  response: UserSelectResponse,
  params: UserSelectInput,
  allowCustom: boolean,
): Decision | null {
  if (!isRecord(response) || response.source !== "remote") {
    return null;
  }

  if (response.kind === "cancel") {
    return {
      selectedBy: "remote",
      result: { kind: "cancel" },
      executeResult: cancelledResult(params),
    };
  }

  if (response.kind === "custom") {
    if (!allowCustom || typeof response.value !== "string") {
      return null;
    }

    const executeResult = customAnswerResult(params, response.value);
    if (executeResult.details?.cancelled) {
      return null;
    }

    return {
      selectedBy: "remote",
      result: { kind: "custom", value: executeResult.details.answer ?? "" },
      executeResult,
    };
  }

  if (response.kind !== "select") {
    return null;
  }

  if (
    !Number.isInteger(response.optionIndex) ||
    response.optionIndex < 0 ||
    response.optionIndex >= params.options.length
  ) {
    return null;
  }

  const option = params.options.at(response.optionIndex);
  if (!option) {
    return null;
  }

  return {
    selectedBy: "remote",
    result: {
      kind: "select",
      optionIndex: response.optionIndex,
      label: option.label,
    },
    executeResult: selectedOptionResult(params, response.optionIndex, option),
  };
}

async function resolveLocalSelection(
  pi: ExtensionAPI,
  params: UserSelectInput,
  ui: ExtensionUIContext,
  requestBase: Omit<
    UserSelectRequestEvent,
    "question" | "options" | "allowCustom" | "respond"
  >,
  displayOptions: string[],
  controller: Controller<Decision>,
  localPromptAbort: AbortController,
): Promise<Decision | null> {
  const { allowCustom = false } = params;
  const choice = await ui.select(params.question, displayOptions, {
    signal: localPromptAbort.signal,
  });

  if (controller.isSettled()) {
    return null;
  }

  if (wasCancelled(choice)) {
    return {
      selectedBy: "local",
      result: { kind: "cancel" },
      executeResult: cancelledResult(params),
    };
  }

  const customAnswerLabel = getCustomAnswerLabel();
  if (allowCustom && choice === customAnswerLabel) {
    return resolveCustomAnswer(
      pi,
      params,
      ui,
      requestBase,
      controller,
      localPromptAbort,
    );
  }

  const { index, option } = resolveSelectedOption(
    TOOL_NAME,
    choice,
    displayOptions,
    params.options,
  );

  return {
    selectedBy: "local",
    result: { kind: "select", optionIndex: index, label: option.label },
    executeResult: selectedOptionResult(params, index, option),
  };
}

async function resolveCustomAnswer(
  pi: ExtensionAPI,
  params: UserSelectInput,
  ui: ExtensionUIContext,
  requestBase: Omit<
    UserSelectRequestEvent,
    "question" | "options" | "allowCustom" | "respond"
  >,
  controller: Controller<Decision>,
  localPromptAbort: AbortController,
): Promise<Decision | null> {
  const requestEvent: CustomInputRequestEvent = {
    ...requestBase,
    kind: "custom_input",
    question: params.question,
    respond: (response) =>
      respondToCustomInput(response, params, controller, localPromptAbort),
  };

  emitSafe(pi, "pi-user-select:custom-input-request", requestEvent);

  if (controller.isSettled()) {
    return controller.promise;
  }

  void ui.input(params.question, "", { signal: localPromptAbort.signal }).then(
    (typed) => {
      if (controller.isSettled()) {
        return;
      }

      if (wasCancelled(typed)) {
        controller.accept({
          selectedBy: "local",
          result: { kind: "cancel" },
          executeResult: cancelledResult(params),
        });
        return;
      }

      const executeResult = customAnswerResult(params, typed);
      const result: SelectionResult = executeResult.details?.cancelled
        ? { kind: "cancel" }
        : { kind: "custom", value: executeResult.details?.answer ?? "" };
      controller.accept({
        selectedBy: "local",
        result,
        executeResult,
      });
    },
    (error: unknown) => {
      controller.fail(error);
    },
  );

  return controller.promise;
}

function respondToCustomInput(
  response: CustomInputResponse,
  params: UserSelectInput,
  controller: Controller<Decision>,
  localPromptAbort: AbortController,
): RespondResult {
  if (controller.isSettled()) {
    return { accepted: false, reason: "already_resolved" };
  }

  if (!isRecord(response) || response.source !== "remote") {
    return { accepted: false, reason: "invalid_response" };
  }

  if (response.kind === "cancel") {
    if (
      !controller.accept({
        selectedBy: "remote",
        result: { kind: "cancel" },
        executeResult: cancelledResult(params),
      })
    ) {
      return { accepted: false, reason: "already_resolved" };
    }

    localPromptAbort.abort();
    return { accepted: true };
  }

  if (response.kind !== "submit" || typeof response.value !== "string") {
    return { accepted: false, reason: "invalid_response" };
  }

  const executeResult = customAnswerResult(params, response.value);
  if (executeResult.details?.cancelled) {
    return { accepted: false, reason: "invalid_response" };
  }

  if (
    !controller.accept({
      selectedBy: "remote",
      result: { kind: "custom", value: executeResult.details?.answer ?? "" },
      executeResult,
    })
  ) {
    return { accepted: false, reason: "already_resolved" };
  }

  localPromptAbort.abort();
  return { accepted: true };
}

function emitSafe(pi: ExtensionAPI, name: string, data: unknown): void {
  try {
    (pi as EventCapablePi).events?.emit?.(name, data);
  } catch {
    // Event listeners must not break the local TUI fallback.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
