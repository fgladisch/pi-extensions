import type {
  ExtensionAPI,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import type { UserSelectInput } from "./types";
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

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: "User Select",
    description:
      "Ask the user a multiple-choice question and return their selection. Use when a skill or workflow needs explicit human input to disambiguate, confirm, or choose between options. Set allowCustom=true to also offer a free-text answer.",
    promptSnippet:
      "Ask the user a multiple-choice question and get their answer",
    promptGuidelines: [
      `Use ${TOOL_NAME} when you need a binary or small-N decision from the user instead of guessing or asking in plain text.`,
      `Always provide concrete, mutually exclusive options to ${TOOL_NAME}; only set allowCustom=true when free-form input is genuinely useful.`,
    ],
    parameters: UserSelectParamsSchema,

    async execute(
      _toolCallId,
      params: UserSelectInput,
      _signal,
      _onUpdate,
      ctx,
    ) {
      const { question, options, allowCustom = false } = params;
      const { hasUI, ui } = ctx;

      if (options.length === 0) {
        throw new Error(`${TOOL_NAME}: at least one option is required`);
      }

      if (!hasUI) {
        throw new Error(
          `${TOOL_NAME}: no interactive UI available (running in non-interactive mode)`,
        );
      }

      const displayOptions = buildDisplayOptions(options, allowCustom);
      const choice = await ui.select(question, displayOptions);

      if (wasCancelled(choice)) {
        return cancelledResult(params);
      }

      const customAnswerLabel = getCustomAnswerLabel();

      if (allowCustom && choice === customAnswerLabel) {
        return resolveCustomAnswer(params, ui);
      }

      const { index, option } = resolveSelectedOption(
        TOOL_NAME,
        choice,
        displayOptions,
        options,
      );

      return selectedOptionResult(params, index, option);
    },
  });
}

async function resolveCustomAnswer(
  params: UserSelectInput,
  ui: ExtensionUIContext,
) {
  const typed = await ui.input(params.question, "");

  if (typed === undefined || typed === null) {
    return cancelledResult(params);
  }

  return customAnswerResult(params, typed);
}
