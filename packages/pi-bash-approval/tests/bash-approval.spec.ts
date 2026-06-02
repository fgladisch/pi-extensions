/**
 * Tests for ../bash-approval.ts
 *
 * Run from the parent directory (~/.pi/agent/extensions):
 *   npm test               # plain test run
 *   npm run test:coverage  # with coverage report
 */

import { describe, expect, it, jest } from "@jest/globals";
import * as os from "node:os";
import * as path from "node:path";

// `virtual: true` because @earendil-works/pi-coding-agent is ESM-only — Jest's
// CJS resolver can't load it, but we're replacing it with a stub anyway.
jest.mock(
  "@earendil-works/pi-coding-agent",
  () => ({
    isToolCallEventType: (toolName: string, event: { toolName: string }) =>
      event.toolName === toolName,
  }),
  { virtual: true },
);

jest.mock("node:fs", () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// ---------- helper types ----------

type ToolCallEventLike = { toolName: string; input: { command?: unknown } };

type ToolCallReturn = undefined | { block: true; reason: string };

type ToolCallHandler = (
  event: ToolCallEventLike,
  ctx: unknown,
) => Promise<ToolCallReturn>;

type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

type FsMock = {
  readFileSync: jest.Mock<(...args: unknown[]) => unknown>;
  writeFileSync: jest.Mock<(...args: unknown[]) => unknown>;
  appendFileSync: jest.Mock<(...args: unknown[]) => unknown>;
  mkdirSync: jest.Mock<(...args: unknown[]) => unknown>;
};

type Recorded = {
  toolCallHandler: ToolCallHandler | null;
  commands: Map<string, CommandHandler>;
  fs: FsMock;
};

// ---------- helpers ----------

function makeFakePi(rec: Recorded) {
  return {
    on: jest.fn((eventName: string, handler: ToolCallHandler) => {
      if (eventName === "tool_call") {
        rec.toolCallHandler = handler;
      }
    }),
    registerCommand: jest.fn(
      (name: string, opts: { handler: CommandHandler }) => {
        rec.commands.set(name, opts.handler);
      },
    ),
    registerTool: jest.fn(),
  };
}

type SelectFn = (msg: string, options: string[]) => Promise<string | null>;

function makeCtx(
  opts: { hasUI?: boolean; pick?: (options: string[]) => string | null } = {},
) {
  const notify = jest.fn();
  const select = jest
    .fn<SelectFn>()
    .mockImplementation((_msg, options) =>
      Promise.resolve(opts.pick ? opts.pick(options) : null),
    );
  const ctx = { hasUI: opts.hasUI ?? true, ui: { notify, select } };

  return { ctx, notify, select };
}

const CONFIG_DIR = path.join(os.homedir(), ".pi", "agent");
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");
const ALLOW_LIST_PATH = path.join(CONFIG_DIR, ".bash-approval");

type SetupOpts = {
  configFile?: string;
  settingsFile?: string;
  allowListFile?: string;
  settingsReadError?: NodeJS.ErrnoException;
  allowListReadError?: NodeJS.ErrnoException;
  mkdirError?: Error;
  writeFileError?: Error;
};

type LegacyConfig = {
  allowed?: unknown;
  splitChains?: unknown;
};

function getLegacyConfigFiles(configFile: string | undefined): {
  settingsFile: string;
  allowListFile: string;
} {
  if (!configFile) {
    return { settingsFile: "{}", allowListFile: "" };
  }

  try {
    const parsed = JSON.parse(configFile) as Partial<LegacyConfig>;
    const allowed = Array.isArray(parsed.allowed)
      ? parsed.allowed.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const splitChains =
      typeof parsed.splitChains === "boolean" ? parsed.splitChains : true;

    return {
      settingsFile: JSON.stringify({ bashApproval: { splitChains } }),
      allowListFile: allowed.length > 0 ? `${allowed.join("\n")}\n` : "",
    };
  } catch {
    return {
      settingsFile: "{}",
      allowListFile: configFile,
    };
  }
}

function setup(opts: SetupOpts = {}): Recorded {
  jest.resetModules();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as FsMock;
  fs.readFileSync.mockReset();
  fs.writeFileSync.mockReset();
  fs.appendFileSync.mockReset();
  fs.mkdirSync.mockReset();

  const { settingsFile: legacySettings, allowListFile: legacyAllowList } =
    getLegacyConfigFiles(opts.configFile);
  const settingsFile = opts.settingsFile ?? legacySettings;
  const allowListFile = opts.allowListFile ?? legacyAllowList;

  fs.readFileSync.mockImplementation((filePath: unknown) => {
    if (filePath === SETTINGS_PATH) {
      if (opts.settingsReadError) {
        throw opts.settingsReadError;
      }

      return settingsFile;
    }

    if (filePath === ALLOW_LIST_PATH) {
      if (opts.allowListReadError) {
        throw opts.allowListReadError;
      }

      return allowListFile;
    }

    return "";
  });

  if (opts.mkdirError) {
    fs.mkdirSync.mockImplementation(() => {
      throw opts.mkdirError;
    });
  }

  if (opts.writeFileError) {
    fs.writeFileSync.mockImplementation(() => {
      throw opts.writeFileError;
    });
  }

  const recorded: Recorded = { toolCallHandler: null, commands: new Map(), fs };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../extensions") as { default: (pi: unknown) => void };
  mod.default(makeFakePi(recorded));

  return recorded;
}

function enoent(): NodeJS.ErrnoException {
  const err = new Error("ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";

  return err;
}

function bashEvent(command: unknown): ToolCallEventLike {
  return { toolName: "bash", input: { command } };
}

// ---------- tests ----------

describe("bash-approval extension", () => {
  describe("loadConfig", () => {
    it("creates default allow-list file when missing (ENOENT)", () => {
      const { fs } = setup({ allowListReadError: enoent() });

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        ALLOW_LIST_PATH,
        "",
        "utf8",
      );
    });

    it("ignores write errors during ENOENT recovery", () => {
      expect(() =>
        setup({
          allowListReadError: enoent(),
          writeFileError: new Error("EACCES"),
        }),
      ).not.toThrow();
    });

    it("ignores mkdir errors during ENOENT recovery", () => {
      expect(() =>
        setup({
          allowListReadError: enoent(),
          mkdirError: new Error("EACCES"),
        }),
      ).not.toThrow();
    });

    it("reads splitChains from settings.json", async () => {
      const { toolCallHandler } = setup({
        settingsFile: JSON.stringify({ bashApproval: { splitChains: false } }),
        allowListFile: "ls && pwd\n",
      });
      const result = await toolCallHandler!(
        bashEvent("ls && pwd"),
        makeCtx({ hasUI: false }).ctx,
      );

      expect(result).toBeUndefined();
    });

    it("defaults splitChains to true when settings.json is malformed", async () => {
      const { toolCallHandler } = setup({
        settingsFile: "not-json",
        allowListFile: "ls && pwd\n",
      });
      const result = await toolCallHandler!(
        bashEvent("ls && pwd"),
        makeCtx({ hasUI: false }).ctx,
      );

      expect(result).toMatchObject({ block: true });
    });

    it("parses .bash-approval lines and ignores comments/blank lines", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "# heading\n\nls\n  git status:*\n",
      });

      expect(
        await toolCallHandler!(bashEvent("ls"), makeCtx({ hasUI: false }).ctx),
      ).toBeUndefined();
      expect(
        await toolCallHandler!(
          bashEvent("git status -sb"),
          makeCtx({ hasUI: false }).ctx,
        ),
      ).toBeUndefined();
    });
  });

  describe("/bash-approval-list command", () => {
    it("notifies when no rules are configured", async () => {
      const { commands } = setup({ configFile: '{"allowed":[]}' });
      const { ctx, notify } = makeCtx();

      await commands.get("bash-approval-list")!("", ctx);

      expect(notify).toHaveBeenCalledWith(
        "No bash approval rules configured",
        "info",
      );
    });

    it("lists configured rules", async () => {
      const { commands } = setup({
        configFile: JSON.stringify({ allowed: ["ls", "git status:*"] }),
      });
      const { ctx, notify } = makeCtx();

      await commands.get("bash-approval-list")!("", ctx);

      expect(notify).toHaveBeenCalledTimes(1);
      const [message, level] = notify.mock.calls[0]!;
      expect(message).toContain("ls");
      expect(message).toContain("git status:*");
      expect(level).toBe("info");
    });
  });

  describe("/bash-approval-reload command", () => {
    it("re-reads config from disk and reports rule count", async () => {
      const { commands, fs } = setup({ configFile: '{"allowed":[]}' });
      fs.readFileSync.mockImplementation((filePath: unknown) => {
        if (filePath === SETTINGS_PATH) {
          return JSON.stringify({ bashApproval: { splitChains: true } });
        }

        if (filePath === ALLOW_LIST_PATH) {
          return "ls\npwd\n";
        }

        return "";
      });
      const { ctx, notify } = makeCtx();

      await commands.get("bash-approval-reload")!("", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("2 bash approval rule"),
        "info",
      );
    });
  });

  describe("tool_call event - non-bash and empty commands", () => {
    it("ignores non-bash tools", async () => {
      const { toolCallHandler } = setup();
      const result = await toolCallHandler!(
        { toolName: "read", input: { command: "rm -rf /" } },
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("ignores empty/whitespace-only commands", async () => {
      const { toolCallHandler } = setup();
      const result = await toolCallHandler!(bashEvent("   "), makeCtx().ctx);

      expect(result).toBeUndefined();
    });

    it("treats missing command field as empty", async () => {
      const { toolCallHandler } = setup();
      const result = await toolCallHandler!(
        { toolName: "bash", input: {} },
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("tool_call event - allow-list matching", () => {
    it("permits exact-string matches", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["ls"] }),
      });
      const result = await toolCallHandler!(bashEvent("ls"), makeCtx().ctx);

      expect(result).toBeUndefined();
    });

    it("permits :* prefix glob (exact prefix and prefix-with-args)", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["git status:*"] }),
      });

      expect(
        await toolCallHandler!(bashEvent("git status"), makeCtx().ctx),
      ).toBeUndefined();
      expect(
        await toolCallHandler!(bashEvent("git status -sb"), makeCtx().ctx),
      ).toBeUndefined();
    });

    it(":* prefix does not match unrelated commands", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["git status:*"] }),
      });
      const result = await toolCallHandler!(
        bashEvent("git push"),
        makeCtx({ hasUI: false }).ctx,
      );

      expect(result).toMatchObject({ block: true });
    });

    it(":* with empty prefix never matches", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: [":*", "  :*"] }),
      });
      const result = await toolCallHandler!(
        bashEvent("anything"),
        makeCtx({ hasUI: false }).ctx,
      );

      expect(result).toMatchObject({ block: true });
    });

    it("trailing * is treated as a generic prefix glob", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["npm *"] }),
      });
      const result = await toolCallHandler!(
        bashEvent("npm install foo"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("ignores empty/whitespace patterns in the allow-list", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["", "   "] }),
      });
      const result = await toolCallHandler!(
        bashEvent("ls"),
        makeCtx({ hasUI: false }).ctx,
      );

      expect(result).toMatchObject({ block: true });
    });

    it("permits chained commands when every segment matches", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["ls", "git status:*"] }),
      });
      const result = await toolCallHandler!(
        bashEvent("ls && git status -sb"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("prompts when one segment of a chain doesn't match", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["ls"] }),
      });
      const { ctx, select } = makeCtx({ pick: () => "Deny" });
      const result = await toolCallHandler!(bashEvent("ls && rm -rf /"), ctx);

      expect(select).toHaveBeenCalled();
      expect(result).toEqual({ block: true, reason: "Blocked by user" });
    });
  });

  describe("tool_call event - shell control filtering", () => {
    it("ignores if/then/fi scaffolding and evaluates only inner commands", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "test:*\necho:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("if test -f x; then echo ok; fi"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("ignores bracket test conditions and evaluates only inner commands", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "echo:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("if [ -f x ]; then echo ok; fi"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("ignores standalone bracket test segments in chains", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "echo:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("[ -f x ] && echo ok"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("ignores for/do/done scaffolding and evaluates inner command", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "echo:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("for item in a b; do echo $item; done"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("ignores assignment-only segments", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "echo:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("FOO=bar && echo hi"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("still evaluates commands that follow assignment prefixes", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "echo:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("FOO=bar npm test"),
        makeCtx({ hasUI: false }).ctx,
      );

      expect(result).toMatchObject({ block: true });
    });
  });

  describe("tool_call event - backtick substitution handling", () => {
    it("extracts commands from backtick substitution in assignment values", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "npm test:*\n",
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(
        bashEvent("FOO=`./evil.sh` npm test -- --runInBand"),
        ctx,
      );

      expect(captured).toContain("Allow always: ./evil.sh:*");
    });

    it("does not split backtick regions into separate chain segments", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "echo:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("echo `echo a; echo b`"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("extracts backtick commands inside double-quoted assignment values", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "printf:*\n",
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(
        bashEvent('tmp="`mktemp -d /tmp/foo-XXXXXX`" && printf \'%s\' "$tmp"'),
        ctx,
      );

      expect(captured).toContain("Allow always: mktemp -d:*");
    });

    it("ignores literal backticks inside single-quoted assignment values", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "echo:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("echo '`not-a-command`'"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("tool_call event - process substitution handling", () => {
    it("does not split process substitution regions into chain segments", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "diff:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("diff <(echo a | sort) <(echo b | sort)"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("blocks commands whose only match is inside a process substitution", async () => {
      // `diff:*` is allowed but the command includes `<(...)` content that
      // stays opaque in the token. A command like `diff <(evil)` has the
      // process sub as part of the matched token, not extracted separately.
      const { toolCallHandler } = setup({
        allowListFile: "diff:*\n",
      });

      const result = await toolCallHandler!(
        bashEvent("diff <(git show HEAD:old) <(git show HEAD:new)"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("tool_call event - non-interactive (no UI)", () => {
    it("blocks with informative reason", async () => {
      const { toolCallHandler } = setup({ configFile: '{"allowed":[]}' });
      const result = await toolCallHandler!(
        bashEvent("rm -rf /"),
        makeCtx({ hasUI: false }).ctx,
      );

      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("rm -rf /"),
      });
      expect(result?.reason).toContain(".bash-approval");
      expect(result?.reason).toContain("settings.json");
    });
  });

  describe("tool_call event - UI prompt", () => {
    it("blocks when user picks Deny", async () => {
      const { toolCallHandler } = setup({ configFile: '{"allowed":[]}' });
      const { ctx } = makeCtx({ pick: () => "Deny" });
      const result = await toolCallHandler!(bashEvent("ls"), ctx);

      expect(result).toEqual({ block: true, reason: "Blocked by user" });
    });

    it("blocks when user dismisses (null choice)", async () => {
      const { toolCallHandler } = setup({ configFile: '{"allowed":[]}' });
      const { ctx } = makeCtx({ pick: () => null });
      const result = await toolCallHandler!(bashEvent("ls"), ctx);

      expect(result).toEqual({ block: true, reason: "Blocked by user" });
    });

    it("allows once without persisting", async () => {
      const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
      const { ctx } = makeCtx({ pick: () => "Allow once" });
      const result = await toolCallHandler!(bashEvent("ls -la"), ctx);

      expect(result).toBeUndefined();
      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it("persists exact rule on 'Allow always (exact)'", async () => {
      const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
      const { ctx, notify } = makeCtx({
        pick: (options) =>
          options.find((option) =>
            option.startsWith("Allow always (exact):"),
          ) ?? null,
      });
      const result = await toolCallHandler!(bashEvent("npm install foo"), ctx);

      expect(result).toBeUndefined();
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
      const [, content] = fs.appendFileSync.mock.calls.at(-1)!;
      expect(content).toContain("npm install foo\n");
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Added rule"),
        "info",
      );
    });

    it("persists prefix rule on 'Allow always: <prefix>:*'", async () => {
      const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
      const { ctx } = makeCtx({
        pick: (options) =>
          options.find((option) => option === "Allow always: git status:*") ??
          null,
      });
      const result = await toolCallHandler!(bashEvent("git status -sb"), ctx);

      expect(result).toBeUndefined();
      const [, content] = fs.appendFileSync.mock.calls.at(-1)!;
      expect(content).toContain("git status:*\n");
    });

    it("offers two-token prefix for multi-token commands", async () => {
      const { toolCallHandler } = setup({ configFile: '{"allowed":[]}' });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(bashEvent("git push origin main"), ctx);

      expect(captured).toContain("Allow always: git push:*");
    });

    it("offers single-token prefix for one-word commands", async () => {
      const { toolCallHandler } = setup({ configFile: '{"allowed":[]}' });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(bashEvent("htop"), ctx);

      expect(captured).toContain("Allow always: htop:*");
    });

    it("does not offer prefix label when prefix is already in allow-list", async () => {
      // `splitChains: false` so the whole literal command is the only segment.
      // Its suggested prefix `git status:*` is already an allow-rule (but doesn't
      // match the literal command verbatim), so the prefix label must be omitted.
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({
          allowed: ["git status:*"],
          splitChains: false,
        }),
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      // `git status && rm foo` does NOT match `git status:*` as a single
      // pattern (the literal includes `&&`), so the prompt fires. The first
      // two tokens are `git status`, so the suggested prefix matches the
      // existing rule and should be suppressed.
      await toolCallHandler!(bashEvent("git status && rm foo"), ctx);

      expect(captured).not.toContain("Allow always: git status:*");
    });

    it("derives prefix suggestion from the first failing segment of a chain", async () => {
      // Regression: previously the suggestion was derived from the head of the
      // whole chained command, so a chain like `cd /path && git log ...` (with
      // `cd:*` already allowed) would offer a useless `cd /path:*` rule
      // instead of `git log:*`, which is what would actually unblock it.
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["cd:*", "head:*"] }),
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(
        bashEvent("cd /Users/felix/code/x && git log --oneline | head -10"),
        ctx,
      );

      expect(captured).toContain("Allow always: git log:*");
      expect(captured).not.toContain("Allow always: cd /Users/felix/code/x:*");
    });

    it("does not suggest bracket-test prefixes from if conditions", async () => {
      const { toolCallHandler } = setup({ configFile: '{"allowed":[]}' });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(bashEvent("if [ -f x ]; then echo ok; fi"), ctx);

      expect(captured).toContain("Allow always: echo ok:*");
      expect(captured).not.toContain("Allow always: [ -f:*");
    });

    it("does not split command substitutions when deriving failing-segment prefixes", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "echo:*\n",
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(
        bashEvent(
          'for f in $(git ls-files --others --exclude-standard | sort); do echo "$f"; done && rm foo',
        ),
        ctx,
      );

      expect(captured).toContain("Allow always: rm foo:*");
      expect(captured).not.toContain("Allow always: sort):*");
    });

    it("suggests command substitutions inside assignment-only segments", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "printf:*\n",
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(
        bashEvent(
          'findings_dir=$(mktemp -d "${TMPDIR:-/tmp}/simplify-findings-XXXXXX")\nprintf \'%s\' "$findings_dir"',
        ),
        ctx,
      );

      expect(captured).toContain("Allow always: mktemp -d:*");
      expect(captured).not.toContain(
        'Allow always: -d "${TMPDIR:-/tmp}/simplify-findings-XXXXXX"):*',
      );
    });

    it("suggests quoted command substitutions inside assignments", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "printf:*\n",
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(
        bashEvent('tmp="$(mktemp -d /tmp/foo-XXXXXX)" && printf \'%s\' "$tmp"'),
        ctx,
      );

      expect(captured).toContain("Allow always: mktemp -d:*");
      expect(captured).not.toContain("Allow always: -d:*");
    });

    it("checks command substitutions before assignment-prefixed commands", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "npm test:*\n",
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(
        bashEvent("FOO=$(./evil.sh) npm test -- --runInBand"),
        ctx,
      );

      expect(captured).toContain("Allow always: ./evil.sh:*");
    });

    it("does not suggest redirection-only prefixes from shell groups", async () => {
      const { toolCallHandler } = setup({
        allowListFile: "git rev-parse:*\ngit diff:*\ntrue\n",
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(
        bashEvent(
          'git rev-parse HEAD && { git diff; for f in $(git ls-files --others --exclude-standard); do git diff --no-index -- /dev/null "$f" || true; done; } > /tmp/pi-footer-review-diff.txt && wc -l /tmp/pi-footer-review-diff.txt',
        ),
        ctx,
      );

      expect(captured).toContain("Allow always: wc -l:*");
      expect(captured).not.toContain(
        "Allow always: > /tmp/pi-footer-review-diff.txt:*",
      );
    });

    it("persists the failing-segment prefix when user accepts it", async () => {
      const { toolCallHandler, fs } = setup({
        configFile: JSON.stringify({ allowed: ["cd:*", "head:*"] }),
      });
      const { ctx } = makeCtx({
        pick: (options) =>
          options.find((option) => option === "Allow always: git log:*") ??
          null,
      });

      const result = await toolCallHandler!(
        bashEvent("cd /tmp && git log --oneline | head -3"),
        ctx,
      );

      expect(result).toBeUndefined();
      const [, content] = fs.appendFileSync.mock.calls.at(-1)!;
      expect(content).toContain("git log:*\n");
    });

    it("does not offer exact label when full command literal is already a rule", async () => {
      // `splitChains: true` (default) splits "ls; pwd" into ["ls", "pwd"], neither
      // of which equals the literal rule "ls; pwd" — so the prompt fires. The
      // trimmed full command "ls; pwd" IS already in the list, so the exact label
      // must be omitted.
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["ls; pwd"] }),
      });
      let captured: string[] = [];
      const { ctx } = makeCtx({
        pick: (options) => {
          captured = options;

          return "Deny";
        },
      });

      await toolCallHandler!(bashEvent("ls; pwd"), ctx);

      expect(captured).toEqual(
        expect.not.arrayContaining([
          expect.stringMatching(/^Allow always \(exact\):/),
        ]),
      );
      expect(captured).toContain("Allow once");
      expect(captured).toContain("Deny");
    });

    it("notifies error when persisting exact rule fails", async () => {
      const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
      fs.appendFileSync.mockImplementation(() => {
        throw new Error("disk full");
      });
      const { ctx, notify } = makeCtx({
        pick: (options) =>
          options.find((option) =>
            option.startsWith("Allow always (exact):"),
          ) ?? null,
      });

      await toolCallHandler!(bashEvent("ls"), ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to persist rule"),
        "error",
      );
    });

    it("notifies error when persisting prefix rule fails", async () => {
      const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
      fs.appendFileSync.mockImplementation(() => {
        throw new Error("nope");
      });
      const { ctx, notify } = makeCtx({
        pick: (options) =>
          options.find((option) => option === "Allow always: git status:*") ??
          null,
      });

      await toolCallHandler!(bashEvent("git status -sb"), ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to persist rule"),
        "error",
      );
    });

    it("handles non-Error thrown values during persistence", async () => {
      const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
      fs.appendFileSync.mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "string failure";
      });
      const { ctx, notify } = makeCtx({
        pick: (options) =>
          options.find((option) =>
            option.startsWith("Allow always (exact):"),
          ) ?? null,
      });

      await toolCallHandler!(bashEvent("ls"), ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("string failure"),
        "error",
      );
    });
  });

  describe("splitCommand parsing (via tool_call)", () => {
    it("treats single-quoted segments as opaque (separators inside are ignored)", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["echo 'a;b':*"] }),
      });
      const result = await toolCallHandler!(
        bashEvent("echo 'a;b'"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("treats double-quoted segments as opaque", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: [`echo "a|b":*`] }),
      });
      const result = await toolCallHandler!(
        bashEvent(`echo "a|b"`),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("handles backslash escapes inside quotes", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: [String.raw`echo "a\"b":*`] }),
      });
      const result = await toolCallHandler!(
        bashEvent(String.raw`echo "a\"b"`),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });

    it("splits on ||, ;, single |, and newlines", async () => {
      const { toolCallHandler } = setup({
        configFile: JSON.stringify({ allowed: ["a", "b", "c", "d", "e"] }),
      });
      const result = await toolCallHandler!(
        bashEvent("a || b ; c | d\ne"),
        makeCtx().ctx,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("extension registration", () => {
    it("registers the expected commands and tool_call hook", () => {
      const { commands, toolCallHandler } = setup();

      expect(commands.has("bash-approval-reload")).toBe(true);
      expect(commands.has("bash-approval-list")).toBe(true);
      expect(typeof toolCallHandler).toBe("function");
    });
  });
});
