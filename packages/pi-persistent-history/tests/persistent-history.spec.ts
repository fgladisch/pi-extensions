import { describe, expect, it, jest } from "@jest/globals";
import * as os from "node:os";
import * as path from "node:path";

jest.mock(
  "@mariozechner/pi-coding-agent",
  () => ({
    CustomEditor: class CustomEditor {
      constructor(_tui: unknown, _theme: unknown, _keybindings: unknown) {}
    },
  }),
  { virtual: true },
);

jest.mock(
  "@mariozechner/pi-tui",
  () => ({
    Box: class Box {
      addChild = jest.fn();
    },
    Text: class Text {
      constructor(
        public text: string,
        public x: number,
        public y: number,
      ) {}
    },
  }),
  { virtual: true },
);

jest.mock("node:fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const HISTORY_FILE_PATH = "/tmp/project/.pi/input-history.jsonl";
const GLOBAL_SETTINGS_PATH = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "settings.json",
);

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
  messageRenderers: Map<string, (...args: unknown[]) => unknown>;
  sendMessage: jest.Mock<(message: unknown) => void>;
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
    messageRenderers: new Map(),
    sendMessage: jest.fn<(message: unknown) => void>(),
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
    registerMessageRenderer: jest.fn(
      (name: string, renderer: (...args: unknown[]) => unknown) => {
        recorded.messageRenderers.set(name, renderer);
      },
    ),
    sendMessage: recorded.sendMessage,
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

type JsonlLine = {
  text: string;
  timestamp?: number;
};

function parseJsonlLines(raw: string): JsonlLine[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JsonlLine);
}

function parseJsonlEntries(raw: string): string[] {
  return parseJsonlLines(raw).map((entry) => entry.text);
}

describe("persistent-history extension", () => {
  it("registers handlers, commands, and status renderer", () => {
    const recorded = setup();

    expect(typeof recorded.inputHandler).toBe("function");
    expect(typeof recorded.sessionStartHandler).toBe("function");
    expect(recorded.commands.has("history-reload")).toBe(true);
    expect(recorded.commands.has("history-status")).toBe(true);
    expect(recorded.messageRenderers.has("persistent-history-status")).toBe(
      true,
    );
  });

  it("styles persistent-history heading with mdHeading theme token", () => {
    const recorded = setup();
    const renderer = recorded.messageRenderers.get("persistent-history-status");

    const theme = {
      fg: jest.fn(
        (token: string, value: string) => `<${token}>${value}</${token}>`,
      ),
      bold: jest.fn((value: string) => `**${value}**`),
    };

    const rendered = renderer?.(
      {
        content:
          "[Persistent History]\n  Loaded 1 entries (max: 250)\n  Since: 2026/05/06, 14:42\n  From file: .pi/input-history.jsonl",
      },
      {},
      theme,
    ) as { addChild: jest.Mock<(child: unknown) => void> };

    const [text] = rendered.addChild.mock.calls.at(0) ?? [];

    expect((text as { text: string }).text).toMatch(
      /^\*\*<mdHeading>\[Persistent History\]<\/mdHeading>\*\*\n  Loaded 1 entries \(max: 250\)/,
    );
    expect(theme.fg).toHaveBeenCalledWith("mdHeading", "[Persistent History]");
    expect(theme.bold).toHaveBeenCalledWith(
      "<mdHeading>[Persistent History]</mdHeading>",
    );
  });

  it("persists prompt input as JSONL when UI is available", async () => {
    const recorded = setup();
    const { ctx } = makeCtx();

    await recorded.inputHandler!({ text: "hello", source: "interactive" }, ctx);

    expect(recorded.fs.writeFileSync).toHaveBeenCalledTimes(1);

    const [filePath, raw] = recorded.fs.writeFileSync.mock.calls.at(-1)!;
    expect(filePath).toBe(HISTORY_FILE_PATH);

    const lines = parseJsonlLines(raw as string);

    expect(lines.map((line) => line.text)).toEqual(["hello"]);
    expect(lines.at(0)?.timestamp).toEqual(expect.any(Number));
  });

  it("injects loaded JSONL history into focused editor on session_start", async () => {
    const recorded = setup();
    recorded.fs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === GLOBAL_SETTINGS_PATH) {
        return JSON.stringify({});
      }

      if (filePath === HISTORY_FILE_PATH) {
        return `${JSON.stringify({ text: "new", timestamp: 2000 })}\n${JSON.stringify({ text: "old", timestamp: 1000 })}\n`;
      }

      return "";
    });

    const { ctx, addToHistory, notify } = makeCtx();

    await recorded.sessionStartHandler!({ reason: "startup" }, ctx);

    expect(addToHistory).toHaveBeenNthCalledWith(1, "old");
    expect(addToHistory).toHaveBeenNthCalledWith(2, "new");
    expect(recorded.sendMessage).toHaveBeenCalledWith({
      customType: "persistent-history-status",
      content: expect.stringMatching(
        /^\[Persistent History\]\n  Loaded 2 entries \(max: 250\)\n  Since: \d{4}\/\d{2}\/\d{2}, \d{2}:\d{2}\n  From file: \.pi\/input-history\.jsonl$/,
      ),
      display: true,
    });
    expect(notify).not.toHaveBeenCalled();
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

    expect(parseJsonlEntries(raw as string)).toEqual([
      "/model",
      "hello",
      "/model",
    ]);
  });

  it("respects maxEntries from global settings", async () => {
    const recorded = setup();
    recorded.fs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === GLOBAL_SETTINGS_PATH) {
        return JSON.stringify({ persistentHistory: { maxEntries: 2 } });
      }

      if (filePath === HISTORY_FILE_PATH) {
        return "";
      }

      return "";
    });

    const { ctx } = makeCtx();

    await recorded.sessionStartHandler!({ reason: "startup" }, ctx);
    await recorded.inputHandler!({ text: "one", source: "interactive" }, ctx);
    await recorded.inputHandler!({ text: "two", source: "interactive" }, ctx);
    await recorded.inputHandler!({ text: "three", source: "interactive" }, ctx);

    const [, raw] = recorded.fs.writeFileSync.mock.calls.at(-1)!;

    expect(parseJsonlEntries(raw as string)).toEqual(["three", "two"]);
  });

  it("does not notify loaded lines on startup when disabled", async () => {
    const recorded = setup();
    recorded.fs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === GLOBAL_SETTINGS_PATH) {
        return JSON.stringify({
          persistentHistory: { showStartupMessage: false },
        });
      }

      if (filePath === HISTORY_FILE_PATH) {
        return `${JSON.stringify({ text: "from-disk" })}\n`;
      }

      return "";
    });

    const { ctx, notify } = makeCtx();

    await recorded.sessionStartHandler!({ reason: "startup" }, ctx);

    expect(recorded.sendMessage).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
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
    recorded.fs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === GLOBAL_SETTINGS_PATH) {
        return JSON.stringify({ persistentHistory: { maxEntries: 250 } });
      }

      if (filePath === HISTORY_FILE_PATH) {
        return `${JSON.stringify({ text: "from-disk" })}\n`;
      }

      return "";
    });

    const { ctx, notify, addToHistory } = makeCtx();

    await recorded.commands.get("history-reload")!("", ctx);

    expect(addToHistory).toHaveBeenCalledWith("from-disk");
    expect(recorded.sendMessage).toHaveBeenCalledWith({
      customType: "persistent-history-status",
      content: expect.stringContaining("Reloaded history"),
      display: true,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("status command reports runtime summary via custom message", async () => {
    const recorded = setup();
    recorded.fs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === GLOBAL_SETTINGS_PATH) {
        return JSON.stringify({ persistentHistory: { maxEntries: 3 } });
      }

      if (filePath === HISTORY_FILE_PATH) {
        return `${JSON.stringify({ text: "a" })}\n${JSON.stringify({ text: "b" })}\n`;
      }

      return "";
    });

    const { ctx } = makeCtx();

    await recorded.sessionStartHandler!({ reason: "startup" }, ctx);
    await recorded.commands.get("history-status")!("", ctx);

    expect(recorded.sendMessage).toHaveBeenCalledWith({
      customType: "persistent-history-status",
      content: expect.stringMatching(
        /^\[Persistent History\]\n  Loaded 2 entries \(max: 3\)\n  Since: \d{4}\/\d{2}\/\d{2}, \d{2}:\d{2}\n  From file: \.pi\/input-history\.jsonl$/,
      ),
      display: true,
    });
  });

  it("status keeps multiline summary format when editor has no addToHistory", async () => {
    const recorded = setup();
    const { ctx } = makeCtx({ focusedEditor: {} });

    await recorded.sessionStartHandler!({ reason: "startup" }, ctx);
    await recorded.commands.get("history-status")!("", ctx);

    const [message] = recorded.sendMessage.mock.calls.at(-1)!;
    expect((message as { content: string }).content).toMatch(
      /^\[Persistent History\]\n  Loaded 0 entries \(max: 250\)\n  Since: \d{4}\/\d{2}\/\d{2}, \d{2}:\d{2}\n  From file: \.pi\/input-history\.jsonl$/,
    );
  });
});

describe("persistent-history utils", () => {
  it("loads defaults and writes file on ENOENT", () => {
    const { fs } = setup();
    fs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === GLOBAL_SETTINGS_PATH || filePath === HISTORY_FILE_PATH) {
        throw enoent();
      }

      return "";
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
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      HISTORY_FILE_PATH,
      "",
      "utf8",
    );
  });

  it("falls back to defaults on malformed settings and malformed history lines", () => {
    const { fs } = setup();
    fs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === GLOBAL_SETTINGS_PATH) {
        return "not-json";
      }

      if (filePath === HISTORY_FILE_PATH) {
        return `not-json\n${JSON.stringify({ text: "ok" })}\n`;
      }

      return "";
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require("../extensions/utils") as {
      loadRuntime: (cwd: string) => { maxEntries: number; entries: string[] };
    };

    const runtime = utils.loadRuntime("/tmp/project");

    expect(runtime.maxEntries).toBe(250);
    expect(runtime.entries).toEqual(["ok"]);
  });

  it("sanitizes invalid maxEntries and invalid history lines", () => {
    const { fs } = setup();
    fs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === GLOBAL_SETTINGS_PATH) {
        return JSON.stringify({
          persistentHistory: { maxEntries: "bad" },
        });
      }

      if (filePath === HISTORY_FILE_PATH) {
        return [
          JSON.stringify({ text: "a" }),
          JSON.stringify({ text: " b " }),
          JSON.stringify({ text: 7 }),
          JSON.stringify({ nope: "x" }),
          JSON.stringify("c"),
        ].join("\n");
      }

      return "";
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require("../extensions/utils") as {
      loadRuntime: (cwd: string) => { maxEntries: number; entries: string[] };
    };

    const runtime = utils.loadRuntime("/tmp/project");

    expect(runtime.maxEntries).toBe(250);
    expect(runtime.entries).toEqual(["a", "b", "c"]);
  });

  it("ignores top-level settings.maxEntries", () => {
    const { fs } = setup();
    fs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === GLOBAL_SETTINGS_PATH) {
        return JSON.stringify({ maxEntries: 2 });
      }

      if (filePath === HISTORY_FILE_PATH) {
        return [
          JSON.stringify({ text: "one" }),
          JSON.stringify({ text: "two" }),
          JSON.stringify({ text: "three" }),
        ].join("\n");
      }

      return "";
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const utils = require("../extensions/utils") as {
      loadRuntime: (cwd: string) => { maxEntries: number; entries: string[] };
    };

    const runtime = utils.loadRuntime("/tmp/project");

    expect(runtime.maxEntries).toBe(250);
    expect(runtime.entries).toEqual(["one", "two", "three"]);
  });
});
