/**
 * Tests for ../caveman.ts
 *
 * Run from the parent directory (~/.pi/agent/extensions):
 *   npm test               # plain test run
 *   npm run test:coverage  # with coverage report
 */

import { describe, expect, it, jest } from "@jest/globals";

// `virtual: true` because @mariozechner/pi-coding-agent is ESM-only — Jest's
// CJS resolver can't load it. The caveman extension only imports the type,
// so a stub is enough.
jest.mock("@mariozechner/pi-coding-agent", () => ({}), { virtual: true });

jest.mock("node:fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  existsSync: jest.fn(),
}));

// ---------- helper types ----------

type Notify = (message: string, level: "info" | "warning" | "error") => void;

type SetStatus = (name: string, value: string) => void;

type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

type CompletionItem = { value: string; label: string };

type CommandOpts = {
  description: string;
  handler: CommandHandler;
  getArgumentCompletions?: (prefix: string) => CompletionItem[] | null;
};

type EventHandler = (event: Record<string, unknown>, ctx: unknown) => unknown;

type FsMock = {
  readFileSync: jest.Mock<(...args: unknown[]) => unknown>;
  writeFileSync: jest.Mock<(...args: unknown[]) => unknown>;
  mkdirSync: jest.Mock<(...args: unknown[]) => unknown>;
  existsSync: jest.Mock<(...args: unknown[]) => unknown>;
};

type ExecResult = { code: number; stdout: string; stderr: string };

type ExecMock = jest.Mock<
  (command: string, args: readonly string[]) => Promise<ExecResult>
>;

type Recorded = {
  events: Map<string, EventHandler>;
  commands: Map<string, CommandOpts>;
  fs: FsMock;
  exec: ExecMock;
};

// ---------- helpers ----------

function makeFakePi(rec: Recorded) {
  return {
    on: jest.fn((eventName: string, handler: EventHandler) => {
      rec.events.set(eventName, handler);
    }),
    registerCommand: jest.fn((name: string, opts: CommandOpts) => {
      rec.commands.set(name, opts);
    }),
    registerTool: jest.fn(),
    exec: rec.exec,
  };
}

function makeCtx() {
  const notify = jest.fn<Notify>();
  const setStatus = jest.fn<SetStatus>();
  const ctx = { hasUI: true, ui: { notify, setStatus } };

  return { ctx, notify, setStatus };
}

type SetupOpts = {
  stateFile?: string | null; // null → ENOENT on read
  stateReadError?: NodeJS.ErrnoException;
  skillFile?: string | null; // null → throw on read
  writeFileError?: Error;
  mkdirError?: Error;
  existsSync?: (target: string) => boolean;
  exec?: (
    command: string,
    args: readonly string[],
  ) => Promise<ExecResult> | ExecResult;
};

function setup(opts: SetupOpts = {}): Recorded {
  jest.resetModules();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as FsMock;
  fs.readFileSync.mockReset();
  fs.writeFileSync.mockReset();
  fs.mkdirSync.mockReset();
  fs.existsSync.mockReset();

  fs.readFileSync.mockImplementation((target: unknown) => {
    const targetPath = String(target);

    if (targetPath.endsWith("state.json")) {
      if (opts.stateReadError) {
        throw opts.stateReadError;
      }

      if (opts.stateFile === null || opts.stateFile === undefined) {
        throw enoent();
      }

      return opts.stateFile;
    }

    if (targetPath.endsWith("SKILL.md")) {
      if (opts.skillFile === null || opts.skillFile === undefined) {
        throw enoent();
      }

      return opts.skillFile;
    }

    throw enoent();
  });

  if (opts.writeFileError) {
    fs.writeFileSync.mockImplementation(() => {
      throw opts.writeFileError;
    });
  }

  if (opts.mkdirError) {
    fs.mkdirSync.mockImplementation(() => {
      throw opts.mkdirError;
    });
  }

  fs.existsSync.mockImplementation((target: unknown) =>
    opts.existsSync ? opts.existsSync(String(target)) : false,
  );

  const exec: ExecMock = jest.fn(
    async (command: string, args: readonly string[]) => {
      if (opts.exec) {
        return opts.exec(command, args);
      }

      return { code: 0, stdout: "", stderr: "" };
    },
  );

  const recorded: Recorded = {
    events: new Map(),
    commands: new Map(),
    fs,
    exec,
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../caveman") as { default: (pi: unknown) => void };
  mod.default(makeFakePi(recorded));

  return recorded;
}

function enoent(): NodeJS.ErrnoException {
  const err = new Error("ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";

  return err;
}

function getCommand(rec: Recorded, name: string): CommandOpts {
  const cmd = rec.commands.get(name);

  if (!cmd) {
    throw new Error(`command ${name} not registered`);
  }

  return cmd;
}

function getEvent(rec: Recorded, name: string): EventHandler {
  const handler = rec.events.get(name);

  if (!handler) {
    throw new Error(`event ${name} not registered`);
  }

  return handler;
}

// ---------- tests ----------

describe("caveman extension", () => {
  describe("loadState", () => {
    it("creates default state file when missing (ENOENT)", () => {
      const { fs } = setup({ stateFile: null });

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const [target, content] = fs.writeFileSync.mock.calls[0]!;
      expect(String(target)).toMatch(/state\.json$/);
      expect(JSON.parse(content as string)).toEqual({
        enabled: true,
        level: "full",
      });
    });

    it("ignores write errors during ENOENT recovery", () => {
      expect(() =>
        setup({ stateFile: null, writeFileError: new Error("EACCES") }),
      ).not.toThrow();
    });

    it("falls back to defaults on non-ENOENT read errors", async () => {
      const otherError = new Error("EACCES") as NodeJS.ErrnoException;
      otherError.code = "EACCES";
      const rec = setup({ stateReadError: otherError, skillFile: "skill" });
      const { ctx, notify } = makeCtx();

      await getCommand(rec, "caveman").handler("status", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("caveman full"),
        "info",
      );
    });

    it("falls back to defaults on malformed JSON", async () => {
      const rec = setup({ stateFile: "not json", skillFile: "skill" });
      const { ctx, notify } = makeCtx();

      await getCommand(rec, "caveman").handler("status", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("caveman full"),
        "info",
      );
    });

    it("respects persisted enabled=false", async () => {
      const rec = setup({
        stateFile: JSON.stringify({ enabled: false, level: "ultra" }),
        skillFile: "skill",
      });
      const { ctx, notify } = makeCtx();

      await getCommand(rec, "caveman").handler("status", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("caveman off"),
        "info",
      );
    });

    it("ignores invalid level field and uses default", async () => {
      const rec = setup({
        stateFile: JSON.stringify({ enabled: true, level: "bogus" }),
        skillFile: "skill",
      });
      const { ctx, notify } = makeCtx();

      await getCommand(rec, "caveman").handler("status", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("caveman full"),
        "info",
      );
    });
  });

  describe("session_start", () => {
    it("warns when SKILL.md is missing", () => {
      const rec = setup({ stateFile: null, skillFile: null });
      const { ctx, notify, setStatus } = makeCtx();

      void getEvent(rec, "session_start")({}, ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("SKILL.md not found"),
        "warning",
      );
      expect(setStatus).toHaveBeenCalledWith(
        "caveman",
        expect.stringContaining("caveman full"),
      );
    });

    it("does not warn when SKILL.md is loaded", () => {
      const rec = setup({ stateFile: null, skillFile: "skill body" });
      const { ctx, notify, setStatus } = makeCtx();

      void getEvent(rec, "session_start")({}, ctx);

      expect(notify).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalled();
    });
  });

  describe("before_agent_start", () => {
    it("appends caveman block when enabled and skill loaded", () => {
      const rec = setup({ stateFile: null, skillFile: "BODY" });
      const result = getEvent(rec, "before_agent_start")(
        { systemPrompt: "BASE" },
        {},
      );

      expect(result).toMatchObject({
        systemPrompt: expect.stringContaining("BASE"),
      });
      const sysPrompt = (result as { systemPrompt: string }).systemPrompt;
      expect(sysPrompt).toContain('<caveman-mode active level="full">');
      expect(sysPrompt).toContain("BODY");
      expect(sysPrompt).toContain("</caveman-mode>");
    });

    it("returns nothing when disabled", () => {
      const rec = setup({
        stateFile: JSON.stringify({ enabled: false, level: "full" }),
        skillFile: "BODY",
      });
      const result = getEvent(rec, "before_agent_start")(
        { systemPrompt: "BASE" },
        {},
      );

      expect(result).toBeUndefined();
    });

    it("returns nothing when skill missing", () => {
      const rec = setup({ stateFile: null, skillFile: null });
      const result = getEvent(rec, "before_agent_start")(
        { systemPrompt: "BASE" },
        {},
      );

      expect(result).toBeUndefined();
    });

    it("reuses cached injection across turns until state changes", async () => {
      const rec = setup({ stateFile: null, skillFile: "BODY" });
      const before = getEvent(rec, "before_agent_start");

      const first = before({ systemPrompt: "A" }, {}) as {
        systemPrompt: string;
      };
      const second = before({ systemPrompt: "B" }, {}) as {
        systemPrompt: string;
      };

      // Both injections carry the same level=full block.
      expect(first.systemPrompt).toContain('level="full"');
      expect(second.systemPrompt).toContain('level="full"');
      expect(second.systemPrompt.startsWith("B")).toBe(true);

      // Switching level invalidates the cache.
      const { ctx } = makeCtx();
      await getCommand(rec, "caveman").handler("ultra", ctx);

      const third = before({ systemPrompt: "C" }, {}) as {
        systemPrompt: string;
      };
      expect(third.systemPrompt).toContain('level="ultra"');
      expect(third.systemPrompt).not.toContain('level="full"');
    });
  });

  describe("/caveman command", () => {
    it("status (default, no args) reports loaded SKILL", async () => {
      const rec = setup({ stateFile: null, skillFile: "skill" });
      const { ctx, notify } = makeCtx();

      await getCommand(rec, "caveman").handler("", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("(SKILL.md loaded)"),
        "info",
      );
    });

    it("status reports MISSING when skill not loaded", async () => {
      const rec = setup({ stateFile: null, skillFile: null });
      const { ctx, notify } = makeCtx();

      await getCommand(rec, "caveman").handler("status", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("(SKILL.md MISSING)"),
        "info",
      );
    });

    it("off persists disabled state and updates status", async () => {
      const rec = setup({ stateFile: null, skillFile: "skill" });
      const { ctx, notify, setStatus } = makeCtx();
      rec.fs.writeFileSync.mockClear();

      await getCommand(rec, "caveman").handler("off", ctx);

      expect(rec.fs.writeFileSync).toHaveBeenCalledTimes(1);
      const [, content] = rec.fs.writeFileSync.mock.calls[0]!;
      expect(JSON.parse(content as string)).toMatchObject({ enabled: false });
      expect(setStatus).toHaveBeenCalledWith(
        "caveman",
        expect.stringContaining("caveman off"),
      );
      expect(notify).toHaveBeenCalledWith("caveman OFF", "info");
    });

    it("off reports persistence error and does not mutate state", async () => {
      const rec = setup({ stateFile: null, skillFile: "skill" });
      const { ctx, notify, setStatus } = makeCtx();

      // Fail subsequent writes (default-state write during load already happened).
      rec.fs.writeFileSync.mockImplementation(() => {
        throw new Error("EACCES");
      });

      await getCommand(rec, "caveman").handler("off", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("failed to persist state"),
        "error",
      );
      expect(setStatus).not.toHaveBeenCalled();

      // Subsequent before_agent_start should still see enabled=true.
      const result = getEvent(rec, "before_agent_start")(
        { systemPrompt: "BASE" },
        {},
      );
      expect(result).toMatchObject({
        systemPrompt: expect.stringContaining("<caveman-mode"),
      });
    });

    it.each([
      "lite",
      "full",
      "ultra",
      "wenyan-lite",
      "wenyan-full",
      "wenyan-ultra",
    ] as const)("level %s persists and notifies", async (level) => {
      const rec = setup({ stateFile: null, skillFile: "skill" });
      const { ctx, notify, setStatus } = makeCtx();
      rec.fs.writeFileSync.mockClear();

      await getCommand(rec, "caveman").handler(level, ctx);

      const [, content] = rec.fs.writeFileSync.mock.calls[0]!;
      expect(JSON.parse(content as string)).toEqual({
        enabled: true,
        level,
      });
      expect(setStatus).toHaveBeenCalledWith(
        "caveman",
        expect.stringContaining(`caveman ${level}`),
      );
      expect(notify).toHaveBeenCalledWith(`caveman ON (${level})`, "info");
    });

    it("level reports persistence error and does not mutate state", async () => {
      const rec = setup({
        stateFile: JSON.stringify({ enabled: true, level: "full" }),
        skillFile: "skill",
      });
      const { ctx, notify, setStatus } = makeCtx();

      rec.fs.writeFileSync.mockImplementation(() => {
        throw new Error("EACCES");
      });

      await getCommand(rec, "caveman").handler("ultra", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("failed to persist state"),
        "error",
      );
      expect(setStatus).not.toHaveBeenCalled();
    });

    it("unknown arg notifies warning with options list", async () => {
      const rec = setup({ stateFile: null, skillFile: "skill" });
      const { ctx, notify } = makeCtx();

      await getCommand(rec, "caveman").handler("bogus", ctx);

      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(
        expect.stringMatching(/unknown arg "bogus".*lite.*ultra.*off/s),
        "warning",
      );
    });

    describe("update", () => {
      it("clones when no .git dir present and reloads SKILL.md", async () => {
        let skillFileNow: string | null = null;
        const rec = setup({
          stateFile: null,
          skillFile: null,
          existsSync: () => false,
          exec: () => ({ code: 0, stdout: "", stderr: "" }),
        });

        // After clone "succeeds", the next SKILL.md read should resolve.
        rec.fs.readFileSync.mockImplementation((target: unknown) => {
          const targetPath = String(target);

          if (targetPath.endsWith("state.json")) {
            throw enoent();
          }

          if (targetPath.endsWith("SKILL.md")) {
            if (skillFileNow === null) {
              throw enoent();
            }

            return skillFileNow;
          }

          throw enoent();
        });

        const { ctx, notify } = makeCtx();
        skillFileNow = "fresh skill";

        await getCommand(rec, "caveman").handler("update", ctx);

        expect(rec.exec).toHaveBeenCalledWith("git", [
          "clone",
          "--depth",
          "1",
          expect.stringContaining("caveman.git"),
          expect.stringContaining("upstream"),
        ]);
        expect(notify).toHaveBeenCalledWith(
          "caveman: SKILL.md updated",
          "info",
        );
      });

      it("pulls when .git dir present", async () => {
        const rec = setup({
          stateFile: null,
          skillFile: "old skill",
          existsSync: (target) => target.endsWith(".git"),
          exec: () => ({ code: 0, stdout: "", stderr: "" }),
        });
        const { ctx, notify } = makeCtx();

        await getCommand(rec, "caveman").handler("update", ctx);

        expect(rec.exec).toHaveBeenCalledWith("git", [
          "-C",
          expect.stringContaining("upstream"),
          "pull",
          "--ff-only",
        ]);
        expect(notify).toHaveBeenCalledWith(
          "caveman: SKILL.md updated",
          "info",
        );
      });

      it("reports clone failure with stderr", async () => {
        const rec = setup({
          stateFile: null,
          skillFile: null,
          existsSync: () => false,
          exec: () => ({ code: 1, stdout: "", stderr: "boom" }),
        });
        const { ctx, notify } = makeCtx();

        await getCommand(rec, "caveman").handler("update", ctx);

        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("clone failed: boom"),
          "error",
        );
      });

      it("falls back to stdout when stderr is empty on failure", async () => {
        const rec = setup({
          stateFile: null,
          skillFile: "skill",
          existsSync: (target) => target.endsWith(".git"),
          exec: () => ({ code: 1, stdout: "stdout-detail", stderr: "" }),
        });
        const { ctx, notify } = makeCtx();

        await getCommand(rec, "caveman").handler("update", ctx);

        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("update failed: stdout-detail"),
          "error",
        );
      });

      it("warns when update succeeds but SKILL.md is still missing", async () => {
        const rec = setup({
          stateFile: null,
          skillFile: null,
          existsSync: () => false,
          exec: () => ({ code: 0, stdout: "", stderr: "" }),
        });
        const { ctx, notify } = makeCtx();

        await getCommand(rec, "caveman").handler("update", ctx);

        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("SKILL.md not found"),
          "warning",
        );
      });

      it("reports thrown errors from exec on the clone path", async () => {
        const rec = setup({
          stateFile: null,
          skillFile: null,
          existsSync: () => false,
          exec: () => {
            throw new Error("spawn failed");
          },
        });
        const { ctx, notify } = makeCtx();

        await getCommand(rec, "caveman").handler("update", ctx);

        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("clone failed: spawn failed"),
          "error",
        );
      });

      it("reports thrown errors from exec on the pull path", async () => {
        const rec = setup({
          stateFile: null,
          skillFile: "skill",
          existsSync: (target) => target.endsWith(".git"),
          exec: () => {
            throw new Error("network down");
          },
        });
        const { ctx, notify } = makeCtx();

        await getCommand(rec, "caveman").handler("update", ctx);

        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("update failed: network down"),
          "error",
        );
      });

      it("reports non-Error throws via String coercion", async () => {
        const rec = setup({
          stateFile: null,
          skillFile: null,
          existsSync: () => false,
          exec: () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw "raw string";
          },
        });
        const { ctx, notify } = makeCtx();

        await getCommand(rec, "caveman").handler("update", ctx);

        expect(notify).toHaveBeenCalledWith(
          expect.stringContaining("clone failed: raw string"),
          "error",
        );
      });
    });
  });

  describe("getArgumentCompletions", () => {
    it("returns matching tokens when prefix has matches", () => {
      const rec = setup({ stateFile: null, skillFile: "skill" });
      const completions = getCommand(rec, "caveman").getArgumentCompletions!(
        "wen",
      );

      expect(completions).toEqual([
        { value: "wenyan-lite", label: "wenyan-lite" },
        { value: "wenyan-full", label: "wenyan-full" },
        { value: "wenyan-ultra", label: "wenyan-ultra" },
      ]);
    });

    it("returns all tokens when prefix is empty", () => {
      const rec = setup({ stateFile: null, skillFile: "skill" });
      const completions = getCommand(rec, "caveman").getArgumentCompletions!(
        "",
      );

      expect(completions).toHaveLength(9);
    });

    it("returns null when no tokens match", () => {
      const rec = setup({ stateFile: null, skillFile: "skill" });
      const completions = getCommand(rec, "caveman").getArgumentCompletions!(
        "zzz",
      );

      expect(completions).toBeNull();
    });
  });
});
