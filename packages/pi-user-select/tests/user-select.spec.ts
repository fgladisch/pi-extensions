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

type EmittedEvent = {
  name: string;
  data: Record<string, unknown>;
};

type Recorded = {
  tools: Map<string, ToolDefinition>;
  emitted: EmittedEvent[];
  onEmit?: (name: string, data: Record<string, unknown>) => void;
};

type SelectResult = string | null | undefined;

type DialogOpts = { readonly signal?: AbortSignal };

type SelectFn = (
  message: string,
  options: string[],
  opts?: DialogOpts,
) => Promise<SelectResult>;

type InputFn = (
  message: string,
  placeholder?: string,
  opts?: DialogOpts,
) => Promise<string | null | undefined>;

// ---------- helpers ----------

function makeFakePi(rec: Recorded) {
  return {
    events: {
      emit: jest.fn((name: string, data: Record<string, unknown>) => {
        rec.emitted.push({ name, data });
        rec.onEmit?.(name, data);
      }),
    },
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
    pickOption?: (
      options: string[],
      opts?: DialogOpts,
    ) => SelectResult | Promise<SelectResult>;
    typedAnswer?: SelectResult | Promise<SelectResult>;
  } = {},
) {
  const notify = jest.fn();
  const select = jest
    .fn<SelectFn>()
    .mockImplementation((_message, options, dialogOpts) =>
      Promise.resolve(
        opts.pickOption ? opts.pickOption(options, dialogOpts) : null,
      ),
    );
  const input = jest
    .fn<InputFn>()
    .mockImplementation((_message, _placeholder, _dialogOpts) =>
      Promise.resolve(opts.typedAnswer),
    );
  const ctx = {
    hasUI: opts.hasUI ?? true,
    ui: { notify, select, input },
  };

  return { ctx, notify, select, input };
}

function setup(onEmit?: Recorded["onEmit"]): Recorded {
  jest.resetModules();

  const recorded: Recorded = { tools: new Map(), emitted: [], onEmit };
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

      expect(select).toHaveBeenCalledWith(
        "Pick one",
        expect.any(Array),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
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

      expect(input).toHaveBeenCalledWith(
        "Pick one",
        "",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
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

  describe("remote interaction events", () => {
    it("allows a remote select response to resolve before the local UI", async () => {
      let remoteResult: unknown;
      const recorded = setup((name, data) => {
        if (name === "pi-user-select:request") {
          const respond = data.respond as (response: unknown) => unknown;
          remoteResult = respond({
            source: "remote",
            kind: "select",
            optionIndex: 1,
          });
        }
      });
      const tool = recorded.tools.get("user_select")!;
      const { ctx, select } = makeCtx({
        pickOption: () => new Promise<SelectResult>(() => undefined),
      });

      const result = await tool.execute(
        "tool-call-1",
        { question: "Pick one", options: SAMPLE_OPTIONS, allowCustom: true },
        null,
        null,
        ctx,
      );

      expect(remoteResult).toEqual({ accepted: true });
      expect(select).not.toHaveBeenCalled();
      expect(result.details).toMatchObject({
        answer: "pnpm",
        cancelled: false,
      });
      expect(recorded.emitted.map(({ name }) => name)).toEqual([
        "pi-user-select:request",
        "pi-user-select:resolved",
        "pi-user-select:closed",
      ]);
      expect(recorded.emitted.at(0)?.data).toMatchObject({
        plugin: "pi-user-select",
        kind: "select",
        toolCallId: "tool-call-1",
        question: "Pick one",
        allowCustom: true,
      });
      expect(recorded.emitted.at(1)?.data).toMatchObject({
        selectedBy: "remote",
        result: { kind: "select", optionIndex: 1, label: "pnpm" },
      });
      expect(recorded.emitted.at(2)?.data).toMatchObject({
        reason: "resolved",
      });
    });

    it("aborts the open local select when a remote response wins", async () => {
      let remoteResult: unknown;
      let capturedSignal: AbortSignal | undefined;
      let sawAbort = false;
      const responder: { current: ((response: unknown) => unknown) | null } = {
        current: null,
      };
      const recorded = setup((name, data) => {
        if (name === "pi-user-select:request") {
          responder.current = data.respond as (response: unknown) => unknown;
        }
      });
      const tool = recorded.tools.get("user_select")!;
      const { ctx } = makeCtx({
        pickOption: (_options, opts) => {
          capturedSignal = opts?.signal;
          capturedSignal?.addEventListener("abort", () => {
            sawAbort = true;
          });
          remoteResult = responder.current?.({
            source: "remote",
            kind: "select",
            optionIndex: 1,
          });

          return new Promise<SelectResult>(() => undefined);
        },
      });

      const result = await tool.execute(
        "tool-call-abort-select",
        { question: "Pick one", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(remoteResult).toEqual({ accepted: true });
      expect(capturedSignal?.aborted).toBe(true);
      expect(sawAbort).toBe(true);
      expect(result.details).toMatchObject({ answer: "pnpm" });
    });

    it("rejects late remote responses after the local UI resolves", async () => {
      const responder: { current: ((response: unknown) => unknown) | null } = {
        current: null,
      };
      const recorded = setup((name, data) => {
        if (name === "pi-user-select:request") {
          responder.current = data.respond as (response: unknown) => unknown;
        }
      });
      const tool = recorded.tools.get("user_select")!;
      const { ctx } = makeCtx({ pickOption: (options) => options.at(0) });

      const result = await tool.execute(
        "tool-call-2",
        { question: "Pick one", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(result.details).toMatchObject({ answer: "npm", cancelled: false });
      const lateRespond = responder.current;
      if (!lateRespond) {
        throw new Error("request responder was not captured");
      }
      expect(
        lateRespond({ source: "remote", kind: "select", optionIndex: 1 }),
      ).toEqual({
        accepted: false,
        reason: "already_resolved",
      });
      expect(recorded.emitted.at(1)?.data).toMatchObject({
        selectedBy: "local",
        result: { kind: "select", optionIndex: 0, label: "npm" },
      });
    });

    it("rejects malformed remote responses as invalid_response", async () => {
      let malformedResult: unknown;
      const recorded = setup((name, data) => {
        if (name === "pi-user-select:request") {
          const respond = data.respond as (response: unknown) => unknown;
          malformedResult = respond(null);
        }
      });
      const tool = recorded.tools.get("user_select")!;
      const { ctx } = makeCtx({ pickOption: (options) => options.at(0) });

      const result = await tool.execute(
        "tool-call-invalid",
        { question: "Pick one", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(malformedResult).toEqual({
        accepted: false,
        reason: "invalid_response",
      });
      expect(result.details).toMatchObject({ answer: "npm", cancelled: false });
    });

    it("rejects unknown remote response kinds instead of treating them as selections", async () => {
      let malformedResult: unknown;
      const recorded = setup((name, data) => {
        if (name === "pi-user-select:request") {
          const respond = data.respond as (response: unknown) => unknown;
          malformedResult = respond({
            source: "remote",
            kind: "bogus",
            optionIndex: 1,
          });
        }
      });
      const tool = recorded.tools.get("user_select")!;
      const { ctx, select } = makeCtx({
        pickOption: (options) => options.at(0),
      });

      const result = await tool.execute(
        "tool-call-invalid-kind",
        { question: "Pick one", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(malformedResult).toEqual({
        accepted: false,
        reason: "invalid_response",
      });
      expect(select).toHaveBeenCalled();
      expect(result.details).toMatchObject({ answer: "npm", cancelled: false });
    });

    it("rejects negative remote option indexes", async () => {
      let malformedResult: unknown;
      const recorded = setup((name, data) => {
        if (name === "pi-user-select:request") {
          const respond = data.respond as (response: unknown) => unknown;
          malformedResult = respond({
            source: "remote",
            kind: "select",
            optionIndex: -1,
          });
        }
      });
      const tool = recorded.tools.get("user_select")!;
      const { ctx } = makeCtx({ pickOption: (options) => options.at(0) });

      const result = await tool.execute(
        "tool-call-negative-index",
        { question: "Pick one", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(malformedResult).toEqual({
        accepted: false,
        reason: "invalid_response",
      });
      expect(result.details).toMatchObject({ answer: "npm", cancelled: false });
    });

    it("keeps custom input response atomic against later top-level responses", async () => {
      let topLevelRespond: ((response: unknown) => unknown) | null = null;
      let customResult: unknown;
      let lateTopLevelResult: unknown;
      const recorded = setup((name, data) => {
        if (name === "pi-user-select:request") {
          topLevelRespond = data.respond as (response: unknown) => unknown;
        }

        if (name === "pi-user-select:custom-input-request") {
          const customRespond = data.respond as (response: unknown) => unknown;
          customResult = customRespond({
            source: "remote",
            kind: "submit",
            value: "bun",
          });
          lateTopLevelResult = topLevelRespond?.({
            source: "remote",
            kind: "select",
            optionIndex: 0,
          });
        }
      });
      const tool = recorded.tools.get("user_select")!;
      const { ctx, input } = makeCtx({
        pickOption: (options) =>
          options.find((option) => option === "(Type custom answer)") ?? null,
        typedAnswer: new Promise<SelectResult>(() => undefined),
      });

      const result = await tool.execute(
        "tool-call-custom-race",
        { question: "Pick one", options: SAMPLE_OPTIONS, allowCustom: true },
        null,
        null,
        ctx,
      );

      expect(customResult).toEqual({ accepted: true });
      expect(lateTopLevelResult).toEqual({
        accepted: false,
        reason: "already_resolved",
      });
      expect(input).not.toHaveBeenCalled();
      expect(result.details).toMatchObject({ answer: "bun", wasCustom: true });
    });

    it("falls back to local UI when an event listener throws", async () => {
      const recorded = setup((name) => {
        if (name === "pi-user-select:request") {
          throw new Error("listener failed");
        }
      });
      const tool = recorded.tools.get("user_select")!;
      const { ctx } = makeCtx({ pickOption: (options) => options.at(2) });

      const result = await tool.execute(
        "tool-call-listener-throw",
        { question: "Pick one", options: SAMPLE_OPTIONS },
        null,
        null,
        ctx,
      );

      expect(result.details).toMatchObject({
        answer: "yarn",
        cancelled: false,
      });
    });

    it("aborts the open local custom input when a remote custom response wins", async () => {
      let remoteResult: unknown;
      let capturedSignal: AbortSignal | undefined;
      let sawAbort = false;
      const customResponder: {
        current: ((response: unknown) => unknown) | null;
      } = { current: null };
      const recorded = setup((name, data) => {
        if (name === "pi-user-select:custom-input-request") {
          customResponder.current = data.respond as (
            response: unknown,
          ) => unknown;
        }
      });
      const tool = recorded.tools.get("user_select")!;
      const { ctx, input } = makeCtx({
        pickOption: (options) =>
          options.find((option) => option === "(Type custom answer)") ?? null,
        typedAnswer: new Promise<SelectResult>(() => undefined),
      });
      input.mockImplementation((_message, _placeholder, opts) => {
        capturedSignal = opts?.signal;
        capturedSignal?.addEventListener("abort", () => {
          sawAbort = true;
        });
        remoteResult = customResponder.current?.({
          source: "remote",
          kind: "submit",
          value: "bun",
        });

        return new Promise<SelectResult>(() => undefined);
      });

      const result = await tool.execute(
        "tool-call-abort-custom-input",
        { question: "Pick one", options: SAMPLE_OPTIONS, allowCustom: true },
        null,
        null,
        ctx,
      );

      expect(remoteResult).toEqual({ accepted: true });
      expect(capturedSignal?.aborted).toBe(true);
      expect(sawAbort).toBe(true);
      expect(result.details).toMatchObject({ answer: "bun", wasCustom: true });
    });

    it("emits a custom input request when the local custom-answer flow opens", async () => {
      const recorded = setup();
      const tool = recorded.tools.get("user_select")!;
      const { ctx } = makeCtx({
        pickOption: (options) =>
          options.find((option) => option === "(Type custom answer)") ?? null,
        typedAnswer: "  bun  ",
      });

      const result = await tool.execute(
        "tool-call-3",
        { question: "Pick one", options: SAMPLE_OPTIONS, allowCustom: true },
        null,
        null,
        ctx,
      );

      expect(result.details).toMatchObject({ answer: "bun", wasCustom: true });
      expect(recorded.emitted.map(({ name }) => name)).toEqual([
        "pi-user-select:request",
        "pi-user-select:custom-input-request",
        "pi-user-select:resolved",
        "pi-user-select:closed",
      ]);
      expect(recorded.emitted.at(1)?.data).toMatchObject({
        plugin: "pi-user-select",
        kind: "custom_input",
        question: "Pick one",
      });
      expect(recorded.emitted.at(2)?.data).toMatchObject({
        selectedBy: "local",
        result: { kind: "custom", value: "bun" },
      });
    });

    it("emits error and closed events when an unexpected failure occurs", async () => {
      const recorded = setup();
      const tool = recorded.tools.get("user_select")!;
      const { ctx } = makeCtx({ pickOption: () => "totally made up" });

      await expect(
        tool.execute(
          "tool-call-4",
          { question: "Pick one", options: SAMPLE_OPTIONS },
          null,
          null,
          ctx,
        ),
      ).rejects.toThrow(/unknown option/);

      expect(recorded.emitted.map(({ name }) => name)).toEqual([
        "pi-user-select:request",
        "pi-user-select:error",
        "pi-user-select:closed",
      ]);
      expect(recorded.emitted.at(1)?.data).toMatchObject({
        plugin: "pi-user-select",
        error: expect.stringMatching(/unknown option/),
      });
      expect(recorded.emitted.at(2)?.data).toMatchObject({ reason: "error" });
    });
  });
});
