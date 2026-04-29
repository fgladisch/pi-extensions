/**
 * User Select Extension
 *
 * Registers a `user_select` tool the LLM (or skills) can call to ask the
 * human a question with a fixed set of choices. Use this whenever a skill
 * needs to disambiguate intent, confirm a plan, or pick between mutually
 * exclusive paths.
 *
 * Example tool call:
 *
 * {
 *   "question": "Which package manager should I use?",
 *   "options": [
 *     { "label": "npm" },
 *     { "label": "pnpm", "description": "Faster, content-addressable" },
 *     { "label": "yarn" }
 *   ],
 *   "allowCustom": true
 * }
 *
 * Behavior:
 *   - Interactive UI: shows the question, numbered options (with optional
 *     descriptions), and — when `allowCustom` is true — a final
 *     "(Type custom answer)" entry that opens a text input.
 *   - Non-interactive (`pi -p`, JSON mode): throws so the LLM sees an
 *     error result and stops looping on a tool that has no human to
 *     answer it.
 *   - User cancellation (Esc / null): returns a non-error result with
 *     `answer: null` so the LLM can react to the cancellation.
 */

import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionUIContext,
} from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";

const TOOL_NAME = "user_select";
const CUSTOM_ANSWER_LABEL = "(Type custom answer)";
const DISPLAY_INDEX_OFFSET = 1;

const CANCELLED_TEXT = "User cancelled the selection";
const EMPTY_CUSTOM_TEXT = "User submitted an empty custom answer";

const OptionSchema = Type.Object({
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({
      description: "Optional short description shown next to the label",
    }),
  ),
});

const UserSelectParamsSchema = Type.Object({
  question: Type.String({
    description: "The question or prompt shown to the user",
  }),
  options: Type.Array(OptionSchema, {
    description: "Mutually exclusive choices the user can pick from",
    minItems: 1,
  }),
  allowCustom: Type.Optional(
    Type.Boolean({
      description:
        "When true, also offer a free-text 'Type custom answer' entry",
    }),
  ),
});

type UserSelectInput = Static<typeof UserSelectParamsSchema>;
type SelectOption = Static<typeof OptionSchema>;

type UserSelectDetails = {
  question: string;
  options: string[];
  answer: string | null;
  wasCustom: boolean;
  cancelled: boolean;
};

type ExecuteResult = AgentToolResult<UserSelectDetails>;

function formatOptionLabel(option: SelectOption, index: number): string {
  const { label, description } = option;
  const head = `${index + DISPLAY_INDEX_OFFSET}. ${label}`;

  if (description) {
    return `${head} — ${description}`;
  }

  return head;
}

function buildDisplayOptions(
  options: SelectOption[],
  allowCustom: boolean,
): string[] {
  const formatted = options.map((option, index) =>
    formatOptionLabel(option, index),
  );

  if (allowCustom) {
    formatted.push(CUSTOM_ANSWER_LABEL);
  }

  return formatted;
}

function makeDetails(
  params: UserSelectInput,
  partial: {
    answer: string | null;
    wasCustom?: boolean;
    cancelled?: boolean;
  },
): UserSelectDetails {
  const { question, options } = params;
  const { answer, wasCustom = false, cancelled = false } = partial;

  return {
    question,
    options: options.map(({ label }) => label),
    answer,
    wasCustom,
    cancelled,
  };
}

function cancelledResult(
  params: UserSelectInput,
  text: string = CANCELLED_TEXT,
): ExecuteResult {
  return {
    content: [{ type: "text", text }],
    details: makeDetails(params, { answer: null, cancelled: true }),
  };
}

async function resolveCustomAnswer(
  params: UserSelectInput,
  ui: ExtensionUIContext,
): Promise<ExecuteResult> {
  const typed = await ui.input(params.question, "");

  if (typed === undefined || typed === null) {
    return cancelledResult(params);
  }

  const trimmed = typed.trim();

  if (!trimmed) {
    return cancelledResult(params, EMPTY_CUSTOM_TEXT);
  }

  return {
    content: [{ type: "text", text: `User wrote: ${trimmed}` }],
    details: makeDetails(params, { answer: trimmed, wasCustom: true }),
  };
}

function resolveSelectedOption(
  choice: string,
  displayOptions: string[],
  options: SelectOption[],
): { index: number; option: SelectOption } {
  const index = displayOptions.indexOf(choice);
  const option = index >= 0 ? options.at(index) : undefined;

  if (!option) {
    // Should not happen in practice — `ui.select` returns one of the strings
    // we passed in — but guard explicitly so callers see a useful error
    // instead of a silent mismatch.
    throw new Error(
      `${TOOL_NAME}: select returned an unknown option "${choice}"`,
    );
  }

  return { index, option };
}

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

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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

      if (choice === undefined || choice === null) {
        return cancelledResult(params);
      }

      if (allowCustom && choice === CUSTOM_ANSWER_LABEL) {
        return resolveCustomAnswer(params, ui);
      }

      const { index, option } = resolveSelectedOption(
        choice,
        displayOptions,
        options,
      );

      return {
        content: [
          {
            type: "text",
            text: `User selected: ${index + DISPLAY_INDEX_OFFSET}. ${option.label}`,
          },
        ],
        details: makeDetails(params, { answer: option.label }),
      };
    },
  });
}
