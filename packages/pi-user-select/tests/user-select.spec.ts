/**
 * Tests for ../user-select.ts
 *
 * Run from the parent directory (~/.pi/agent/extensions):
 *   npm test               # plain test run
 *   npm run test:coverage  # with coverage report
 */

import { describe, expect, it, jest } from "@jest/globals";

// `virtual: true` because @earendil-works/pi-coding-agent is ESM-only — Jest's
// CJS resolver can't load it. Stub only what user-select.ts imports
// (which is only the `ExtensionAPI` type, plus the runtime export).
jest.mock("@earendil-works/pi-coding-agent", () => ({}), { virtual: true });

// `typebox` is also ESM-only. We don't actually validate against the schema
// in these tests, so stub each builder as a no-op that returns a plain
// descriptor object — enough for module load and tool registration.
jest.mock(
  "typebox",
  () => ({
    Type: {
      Object: (properties: unknown, options?: unknown) => ({
        kind: "object",
        properties,
        options,
      }),
      String: (options?: unknown) => ({ kind: "string", options }),
      Array: (items: unknown, options?: unknown) => ({
        kind: "array",
        items,
        options,
      }),
      Optional: (schema: unknown) => ({ kind: "optional", schema }),
      Boolean: (options?: unknown) => ({ kind: "boolean", options }),
    },
  }),
  { virtual: true },
);

// ---------- helper types ----------

type ToolDefinition = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
  }>;
};

type Recorded = {
  tools: Map<string, ToolDefinition>;
};

type SelectFn = (
  message: string,
  options: string[],
) => Promise<string | null | undefined>;

type InputFn = (
  message: string,
  placeholder?: string,
) => Promise<string | null | undefined>;

// ---------- helpers ----------

function makeFakePi(rec: Recorded) {
  return {
    on: jest.fn(),
    registerCommand: jest.fn(),
    registerTool: jest.fn((definition: ToolDefinition) => {
      rec.tools.set(definition.name, definition);
    }),
  };
}

function makeCtx(
  opts: {
    hasUI?: boolean;
    pickOption?: (options: string[]) => string | null | undefined;
    typedAnswer?: string | null | undefined;
  } = {},
) {
  const notify = jest.fn();
  const select = jest
    .fn<SelectFn>()
    .mockImplementation((_message, options) =>
      Promise.resolve(opts.pickOption ? opts.pickOption(options) : null),
    );
  const input = jest
    .fn<InputFn>()
    .mockImplementation(() => Promise.resolve(opts.typedAnswer));
  const ctx = {
    hasUI: opts.hasUI ?? true,
    ui: { notify, select, input },
  };

  return { ctx, notify, select, input };
}

function setup(): Recorded {
  jest.resetModules();

  const recorded: Recorded = { tools: new Map() };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../extensions") as { default: (pi: unknown) => void };
  mod.default(makeFakePi(recorded));

  return recorded;
}

function getTool(): ToolDefinition {
  const { tools } = setup();
  const tool = tools.get("user_select");
  if (!tool) {
    throw new Error("user_select tool was not registered");
  }
  return tool;
}

const SAMPLE_OPTIONS = [
  { label: "npm" },
  { label: "pnpm", description: "Faster, content-addressable" },
  { label: "yarn" },
];

// ---------- tests ----------

describe("user-select extension", () => {
  describe("registration", () => {
    it("registers the user_select tool", () => {
      const { tools } = setup();

      expect(tools.has("user_select")).toBe(true);
      const tool = tools.get("user_select")!;
      expect(tool.label).toBe("User Select");
      expect(tool.description).toContain("multiple-choice");
      expect(tool.promptSnippet).toMatch(/multiple-choice/i);
      expect(tool.promptGuidelines?.length ?? 0).toBeGreaterThan(0);
    });
  });

  describe("execute - validation", () => {
    it("throws when no UI is available", async () => {
      const tool = getTool();
      const { ctx } = makeCtx({ hasUI: false });

      await expect(
        tool.execute(
          "id",
          { question: "Q?", options: SAMPLE_OPTIONS },
          null,
          null,
          ctx,
        ),
      ).rejects.toThrow(/non-interactive/);
    });

    it("throws on empty options array", async () => {
      const tool = getTool();
      const { ctx } = makeCtx();

      await expect(
        tool.execute("id", { question: "Q?", options: [] }, null, null, ctx),
      ).rejects.toThrow(/at least one option/);
    });
  });

  describe("execute - selection without custom answer", () => {
    it("displays numbered options with descriptions and returns the chosen label", async () => {
      const tool = getTool();
      let captured: string[] = [];
      const { ctx, select, input } = makeCtx({
        pickOption: (options) => {
          captured = options;
          return options.at(1) ?? null;
        },
      });

      const result = await tool.execute(
        "id",
        { question: "Pick one", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(select).toHaveBeenCalledWith("Pick one", expect.any(Array));
      expect(input).not.toHaveBeenCalled();
      expect(captured).toEqual([
        "1. npm",
        "2. pnpm\n\n    Faster, content-addressable\n",
        "3. yarn",
      ]);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "User selected: 2. pnpm",
      });
      expect(result.details).toEqual({
        question: "Pick one",
        options: ["npm", "pnpm", "yarn"],
        answer: "pnpm",
        wasCustom: false,
        cancelled: false,
      });
    });

    it("wraps long option descriptions with hanging indentation", async () => {
      const tool = getTool();
      const longOptions = [
        {
          label: "policy graph",
          description:
            "Compile JSON rules into a decision DAG, freeze snapshots per event, and append immutable audit entries for each decision.",
        },
      ];
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pickOption: (options) => {
          captured = options;
          return options.at(0) ?? null;
        },
      });

      await tool.execute(
        "id",
        { question: "Pick one", options: longOptions },
        null,
        null,
        ctx,
      );

      const wrapped = captured.at(0) ?? "";
      const wrappedLines = wrapped.split("\n");

      expect(wrappedLines.length).toBeGreaterThan(2);

      expect(wrappedLines.at(0)).toBe("1. policy graph");
      expect(wrappedLines.at(1)).toBe("");

      expect(wrappedLines.at(-1)).toBe("");

      for (const line of wrappedLines.slice(2, -1)) {
        expect(line.startsWith("    ")).toBe(true);
        expect(line.startsWith("     ")).toBe(false);
      }
    });

    it("does not append a custom-answer entry when allowCustom is omitted", async () => {
      const tool = getTool();
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pickOption: (options) => {
          captured = options;
          return options.at(0) ?? null;
        },
      });

      await tool.execute(
        "id",
        { question: "Q?", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(captured).not.toContain("(Type custom answer)");
    });

    it("returns answer: null with cancelled: true when select returns null", async () => {
      const tool = getTool();
      const { ctx } = makeCtx({ pickOption: () => null });

      const result = await tool.execute(
        "id",
        { question: "Q?", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(result.content[0]).toEqual({
        type: "text",
        text: "User cancelled the selection",
      });
      expect(result.details).toMatchObject({ answer: null, cancelled: true });
    });

    it("returns answer: null with cancelled: true when select returns undefined", async () => {
      const tool = getTool();
      const { ctx } = makeCtx({ pickOption: () => undefined });

      const result = await tool.execute(
        "id",
        { question: "Q?", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(result.details).toMatchObject({ answer: null, cancelled: true });
    });
  });

  describe("execute - allowCustom", () => {
    it("appends '(Type custom answer)' to the displayed options", async () => {
      const tool = getTool();
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pickOption: (options) => {
          captured = options;
          return options.at(0) ?? null;
        },
      });

      await tool.execute(
        "id",
        { question: "Q?", options: SAMPLE_OPTIONS, allowCustom: true },
        null,
        null,
        ctx,
      );

      expect(captured.at(-1)).toBe("(Type custom answer)");
    });

    it("opens an input prompt when the custom-answer entry is selected", async () => {
      const tool = getTool();
      const { ctx, input } = makeCtx({
        pickOption: (options) =>
          options.find((option) => option === "(Type custom answer)") ?? null,
        typedAnswer: "  bun  ",
      });

      const result = await tool.execute(
        "id",
        { question: "Pick one", options: SAMPLE_OPTIONS, allowCustom: true },
        null,
        null,
        ctx,
      );

      expect(input).toHaveBeenCalledWith("Pick one", "");
      expect(result.content[0]).toEqual({
        type: "text",
        text: "User wrote: bun",
      });
      expect(result.details).toMatchObject({
        answer: "bun",
        wasCustom: true,
        cancelled: false,
      });
    });

    it("treats null/undefined input as cancellation", async () => {
      const tool = getTool();
      const { ctx } = makeCtx({
        pickOption: (options) =>
          options.find((option) => option === "(Type custom answer)") ?? null,
        typedAnswer: null,
      });

      const result = await tool.execute(
        "id",
        { question: "Q?", options: SAMPLE_OPTIONS, allowCustom: true },
        null,
        null,
        ctx,
      );

      expect(result.content[0]).toEqual({
        type: "text",
        text: "User cancelled the selection",
      });
      expect(result.details).toMatchObject({ answer: null, cancelled: true });
    });

    it("treats whitespace-only input as cancellation with explanatory text", async () => {
      const tool = getTool();
      const { ctx } = makeCtx({
        pickOption: (options) =>
          options.find((option) => option === "(Type custom answer)") ?? null,
        typedAnswer: "   ",
      });

      const result = await tool.execute(
        "id",
        { question: "Q?", options: SAMPLE_OPTIONS, allowCustom: true },
        null,
        null,
        ctx,
      );

      expect(result.content[0]).toEqual({
        type: "text",
        text: "User submitted an empty custom answer",
      });
      expect(result.details).toMatchObject({ answer: null, cancelled: true });
    });

    it("ignores the custom-answer sentinel when allowCustom is false", async () => {
      // If a user somehow returned the sentinel string when allowCustom is
      // false (e.g. a future selector ignoring the option list), the tool
      // should treat it as an unknown option rather than open the input.
      const tool = getTool();
      const { ctx, input } = makeCtx({
        pickOption: () => "(Type custom answer)",
      });

      await expect(
        tool.execute(
          "id",
          { question: "Q?", options: SAMPLE_OPTIONS },
          null,
          null,
          ctx,
        ),
      ).rejects.toThrow(/unknown option/);
      expect(input).not.toHaveBeenCalled();
    });
  });

  describe("execute - defensive option matching", () => {
    it("throws when select returns a string not present in the options", async () => {
      const tool = getTool();
      const { ctx } = makeCtx({ pickOption: () => "totally made up" });

      await expect(
        tool.execute(
          "id",
          { question: "Q?", options: SAMPLE_OPTIONS },
          null,
          null,
          ctx,
        ),
      ).rejects.toThrow(/unknown option/);
    });
  });
});
