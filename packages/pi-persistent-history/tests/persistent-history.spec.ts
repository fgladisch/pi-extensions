import { describe, expect, it, jest } from "@jest/globals";

jest.mock(
  "@mariozechner/pi-coding-agent",
  () => ({
    CustomEditor: class CustomEditor {
      constructor(_tui: unknown, _theme: unknown, _keybindings: unknown) {}
    },
  }),
  { virtual: true },
);

jest.mock("node:fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

type InputHandler = (
  event: { text: string; source: string },
  ctx: unknown,
) => Promise<{ action: "continue" } | undefined>;

type SessionStartHandler = (
  event: unknown,
  ctx: unknown,
) => Promise<void> | void;

type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

type FsMock = {
  readFileSync: jest.Mock<(...args: unknown[]) => unknown>;
  writeFileSync: jest.Mock<(...args: unknown[]) => unknown>;
  mkdirSync: jest.Mock<(...args: unknown[]) => unknown>;
};

type Recorded = {
  inputHandler: InputHandler | null;
  sessionStartHandler: SessionStartHandler | null;
  commands: Map<string, CommandHandler>;
  fs: FsMock;
};

type CtxOptions = {
  hasUI?: boolean;
  addToHistory?: jest.Mock<(text: string) => void>;
  focusedEditor?: unknown;
};

function makeCtx(options: CtxOptions = {}) {
  const notify = jest.fn();
  const addToHistory =
    options.addToHistory ?? jest.fn<(text: string) => void>();
  const focusedComponent =
    options.focusedEditor ??
    ({ addToHistory } as { addToHistory: (text: string) => void });

  const setEditorComponent = jest.fn((factory: unknown) => {
    if (typeof factory !== "function") {
      return;
    }

    (
      factory as (tui: unknown, theme: unknown, keybindings: unknown) => unknown
    )({ focusedComponent }, {}, {});
  });

  const ctx = {
    hasUI: options.hasUI ?? true,
    cwd: "/tmp/project",
    ui: {
      notify,
      setEditorComponent,
    },
  };

  return { ctx, notify, setEditorComponent, addToHistory };
}

function setup(): Recorded {
  jest.resetModules();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as FsMock;
  fs.readFileSync.mockReset();
  fs.writeFileSync.mockReset();
  fs.mkdirSync.mockReset();

  const recorded: Recorded = {
    inputHandler: null,
    sessionStartHandler: null,
    commands: new Map(),
    fs,
  };

  const pi = {
    on: jest.fn((eventName: string, handler: unknown) => {
      if (eventName === "input") {
        recorded.inputHandler = handler as InputHandler;
      }

      if (eventName === "session_start") {
        recorded.sessionStartHandler = handler as SessionStartHandler;
      }
    }),
    registerCommand: jest.fn(
      (name: string, options: { handler: CommandHandler }) => {
        recorded.commands.set(name, options.handler);
      },
    ),
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../extensions") as { default: (pi: unknown) => void };
  mod.default(pi);

  return recorded;
}

function enoent(): NodeJS.ErrnoException {
  const error = new Error("ENOENT") as NodeJS.ErrnoException;
  error.code = "ENOENT";

  return error;
}

describe("persistent-history extension", () => {
  it("registers handlers and commands", () => {
    const recorded = setup();

    expect(typeof recorded.inputHandler).toBe("function");
    expect(typeof recorded.sessionStartHandler).toBe("function");
    expect(recorded.commands.has("history-reload")).toBe(true);
    expect(recorded.commands.has("history-status")).toBe(true);
  });

  it("persists prompt input when UI is available", async () => {
    const recorded = setup();
    const { ctx } = makeCtx();

    await recorded.inputHandler!({ text: "hello", source: "interactive" }, ctx);

    expect(recorded.fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("injects loaded history into focused editor on session_start", async () => {
    const recorded = setup();
    recorded.fs.readFileSync.mockReturnValue(
      JSON.stringify({ maxEntries: 250, entries: ["new", "old"] }),
    );
    const { ctx, addToHistory } = makeCtx();

    await recorded.sessionStartHandler!({ reason: "startup" }, ctx);

    expect(addToHistory).toHaveBeenNthCalledWith(1, "old");
    expect(addToHistory).toHaveBeenNthCalledWith(2, "new");
  });

  it("keeps slash commands and skips only consecutive duplicates", async () => {
    const recorded = setup();
    const { ctx } = makeCtx();

    await recorded.inputHandler!(
      { text: "/model", source: "interactive" },
      ctx,
    );
    await recorded.inputHandler!(
      { text: "/model", source: "interactive" },
      ctx,
    );
    await recorded.inputHandler!({ text: "hello", source: "interactive" }, ctx);
    await recorded.inputHandler!(
      { text: "/model", source: "interactive" },
      ctx,
    );

    const [, raw] = recorded.fs.writeFileSync.mock.calls.at(-1)!;
    const parsed = JSON.parse(raw as string) as { entries: string[] };

    expect(parsed.entries).toEqual(["/model", "hello", "/model"]);
  });

  it("respects maxEntries from project history file", async () => {
    const recorded = setup();
    recorded.fs.readFileSync.mockReturnValue(
      JSON.stringify({ maxEntries: 2, entries: [] }),
    );
    const { ctx } = makeCtx();

    await recorded.sessionStartHandler!({ reason: "startup" }, ctx);
    await recorded.inputHandler!({ text: "one", source: "interactive" }, ctx);
    await recorded.inputHandler!({ text: "two", source: "interactive" }, ctx);
    await recorded.inputHandler!({ text: "three", source: "interactive" }, ctx);

    const [, raw] = recorded.fs.writeFileSync.mock.calls.at(-1)!;
    const parsed = JSON.parse(raw as string) as { entries: string[] };

    expect(parsed.entries).toEqual(["three", "two"]);
  });

  it("does not persist when UI is unavailable", async () => {
    const recorded = setup();

    const result = await recorded.inputHandler!(
      { text: "hello", source: "interactive" },
      makeCtx({ hasUI: false }).ctx,
    );

    expect(result).toEqual({ action: "continue" });
    expect(recorded.fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("reload command reloads and reports summary", async () => {
    const recorded = setup();
    recorded.fs.readFileSync.mockReturnValue(
      JSON.stringify({ maxEntries: 250, entries: ["from-disk"] }),
    );
    const { ctx, notify, addToHistory } = makeCtx();

    await recorded.commands.get("history-reload")!("", ctx);

    expect(addToHistory).toHaveBeenCalledWith("from-disk");
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Reloaded history"),
      "info",
    );
  });

  it("status command reports runtime summary", async () => {
    const recorded = setup();
    recorded.fs.readFileSync.mockReturnValue(
      JSON.stringify({ maxEntries: 3, entries: ["a", "b"] }),
    );
    const { ctx, notify } = makeCtx();

    await recorded.sessionStartHandler!({ reason: "startup" }, ctx);
    await recorded.commands.get("history-status")!("", ctx);

    const [message, level] = notify.mock.calls.at(-1)!;
    expect(message).toContain("entries: 2");
    expect(message).toContain("maxEntries: 3");
    expect(level).toBe("info");
  });

  it("status shows unavailable injection when editor has no addToHistory", async () => {
    const recorded = setup();
    const { ctx, notify } = makeCtx({ focusedEditor: {} });

    await recorded.sessionStartHandler!({ reason: "startup" }, ctx);
    await recorded.commands.get("history-status")!("", ctx);

    const [message] = notify.mock.calls.at(-1)!;
    expect(message).toContain("injection: unavailable");
  });
});

describe("persistent-history utils", () => {
  it("loads defaults and writes file on ENOENT", () => {
    const { fs } = setup();
    fs.readFileSync.mockImplementation(() => {
      throw enoent();
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require("../extensions/utils") as {
      loadRuntime: (cwd: string) => { maxEntries: number; entries: string[] };
    };

    const runtime = utils.loadRuntime("/tmp/project");

    expect(runtime.maxEntries).toBe(250);
    expect(runtime.entries).toEqual([]);
    expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/project/.pi", {
      recursive: true,
    });
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("falls back to defaults on malformed JSON", () => {
    const { fs } = setup();
    fs.readFileSync.mockReturnValue("not-json");

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require("../extensions/utils") as {
      loadRuntime: (cwd: string) => { maxEntries: number; entries: string[] };
    };

    const runtime = utils.loadRuntime("/tmp/project");

    expect(runtime.maxEntries).toBe(250);
    expect(runtime.entries).toEqual([]);
  });

  it("sanitizes invalid maxEntries and entries", () => {
    const { fs } = setup();
    fs.readFileSync.mockReturnValue(
      JSON.stringify({
        maxEntries: "bad",
        entries: ["a", null, 7, " b "],
      }),
    );

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require("../extensions/utils") as {
      loadRuntime: (cwd: string) => { maxEntries: number; entries: string[] };
    };

    const runtime = utils.loadRuntime("/tmp/project");

    expect(runtime.maxEntries).toBe(250);
    expect(runtime.entries).toEqual(["a", "b"]);
  });
});
