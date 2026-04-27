/**
 * Tests for ../bash-approval.ts
 *
 * Run from the parent directory (~/.pi/agent/extensions):
 *   npm test               # plain test run
 *   npm run test:coverage  # with coverage report
 */

import { describe, expect, it, jest } from "@jest/globals";

// `virtual: true` because @mariozechner/pi-coding-agent is ESM-only — Jest's
// CJS resolver can't load it, but we're replacing it with a stub anyway.
jest.mock(
	"@mariozechner/pi-coding-agent",
	() => ({
		isToolCallEventType: (toolName: string, event: { toolName: string }) => event.toolName === toolName,
	}),
	{ virtual: true },
);

jest.mock("node:fs", () => ({
	readFileSync: jest.fn(),
	writeFileSync: jest.fn(),
	mkdirSync: jest.fn(),
}));

// ---------- helper types ----------

type ToolCallEventLike = { toolName: string; input: { command?: unknown } };

type ToolCallReturn = undefined | { block: true; reason: string };

type ToolCallHandler = (event: ToolCallEventLike, ctx: unknown) => Promise<ToolCallReturn>;

type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

type FsMock = {
	readFileSync: jest.Mock<(...args: unknown[]) => unknown>;
	writeFileSync: jest.Mock<(...args: unknown[]) => unknown>;
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
		registerCommand: jest.fn((name: string, opts: { handler: CommandHandler }) => {
			rec.commands.set(name, opts.handler);
		}),
		registerTool: jest.fn(),
	};
}

type SelectFn = (msg: string, options: string[]) => Promise<string | null>;

function makeCtx(opts: { hasUI?: boolean; pick?: (options: string[]) => string | null } = {}) {
	const notify = jest.fn();
	const select = jest
		.fn<SelectFn>()
		.mockImplementation((_msg, options) => Promise.resolve(opts.pick ? opts.pick(options) : null));
	const ctx = { hasUI: opts.hasUI ?? true, ui: { notify, select } };

	return { ctx, notify, select };
}

type SetupOpts = {
	configFile?: string;
	readError?: NodeJS.ErrnoException;
	mkdirError?: Error;
	writeFileError?: Error;
};

function setup(opts: SetupOpts = {}): Recorded {
	jest.resetModules();

	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const fs = require("node:fs") as FsMock;
	fs.readFileSync.mockReset();
	fs.writeFileSync.mockReset();
	fs.mkdirSync.mockReset();

	if (opts.readError) {
		fs.readFileSync.mockImplementation(() => {
			throw opts.readError;
		});
	} else {
		fs.readFileSync.mockReturnValue(opts.configFile ?? '{"allowed":[]}');
	}

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
	const mod = require("../bash-approval") as { default: (pi: unknown) => void };
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
		it("creates default config when file missing (ENOENT)", () => {
			const { fs } = setup({ readError: enoent() });

			expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
			expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
			const [, content] = fs.writeFileSync.mock.calls[0]!;
			expect(JSON.parse(content as string)).toEqual({ allowed: [], splitChains: true });
		});

		it("ignores write errors during ENOENT recovery", () => {
			expect(() => setup({ readError: enoent(), writeFileError: new Error("EACCES") })).not.toThrow();
		});

		it("ignores mkdir errors during ENOENT recovery", () => {
			expect(() => setup({ readError: enoent(), mkdirError: new Error("EACCES") })).not.toThrow();
		});

		it("falls back to defaults on malformed JSON", async () => {
			const { toolCallHandler, fs } = setup({ configFile: "this is not json" });
			const result = await toolCallHandler!(bashEvent("ls"), makeCtx({ hasUI: false }).ctx);

			expect(result).toEqual({ block: true, reason: expect.stringContaining("ls") });
			// Malformed JSON path does NOT recreate the file (only ENOENT does).
			expect(fs.writeFileSync).not.toHaveBeenCalled();
		});

		it("filters non-string entries from allowed", async () => {
			const { toolCallHandler } = setup({
				configFile: JSON.stringify({ allowed: ["ls", 42, null, "git status:*"] }),
			});

			expect(await toolCallHandler!(bashEvent("ls"), makeCtx({ hasUI: false }).ctx)).toBeUndefined();
			expect(await toolCallHandler!(bashEvent("git status -sb"), makeCtx({ hasUI: false }).ctx)).toBeUndefined();
		});

		it("treats non-array allowed as empty list", async () => {
			const { toolCallHandler } = setup({ configFile: JSON.stringify({ allowed: "ls" }) });
			const result = await toolCallHandler!(bashEvent("ls"), makeCtx({ hasUI: false }).ctx);

			expect(result).toMatchObject({ block: true });
		});

		it("respects splitChains: false (whole command must match a single rule)", async () => {
			const { toolCallHandler } = setup({
				configFile: JSON.stringify({ allowed: ["ls && pwd"], splitChains: false }),
			});
			const result = await toolCallHandler!(bashEvent("ls && pwd"), makeCtx({ hasUI: false }).ctx);

			expect(result).toBeUndefined();
		});
	});

	describe("/bash-approval-list command", () => {
		it("notifies when no rules are configured", async () => {
			const { commands } = setup({ configFile: '{"allowed":[]}' });
			const { ctx, notify } = makeCtx();

			await commands.get("bash-approval-list")!("", ctx);

			expect(notify).toHaveBeenCalledWith("No bash approval rules configured", "info");
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
			fs.readFileSync.mockReturnValue(JSON.stringify({ allowed: ["ls", "pwd"] }));
			const { ctx, notify } = makeCtx();

			await commands.get("bash-approval-reload")!("", ctx);

			expect(notify).toHaveBeenCalledWith(expect.stringContaining("2 bash approval rule"), "info");
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
			const result = await toolCallHandler!({ toolName: "bash", input: {} }, makeCtx().ctx);

			expect(result).toBeUndefined();
		});
	});

	describe("tool_call event - allow-list matching", () => {
		it("permits exact-string matches", async () => {
			const { toolCallHandler } = setup({ configFile: JSON.stringify({ allowed: ["ls"] }) });
			const result = await toolCallHandler!(bashEvent("ls"), makeCtx().ctx);

			expect(result).toBeUndefined();
		});

		it("permits :* prefix glob (exact prefix and prefix-with-args)", async () => {
			const { toolCallHandler } = setup({ configFile: JSON.stringify({ allowed: ["git status:*"] }) });

			expect(await toolCallHandler!(bashEvent("git status"), makeCtx().ctx)).toBeUndefined();
			expect(await toolCallHandler!(bashEvent("git status -sb"), makeCtx().ctx)).toBeUndefined();
		});

		it(":* prefix does not match unrelated commands", async () => {
			const { toolCallHandler } = setup({ configFile: JSON.stringify({ allowed: ["git status:*"] }) });
			const result = await toolCallHandler!(bashEvent("git push"), makeCtx({ hasUI: false }).ctx);

			expect(result).toMatchObject({ block: true });
		});

		it(":* with empty prefix never matches", async () => {
			const { toolCallHandler } = setup({ configFile: JSON.stringify({ allowed: [":*", "  :*"] }) });
			const result = await toolCallHandler!(bashEvent("anything"), makeCtx({ hasUI: false }).ctx);

			expect(result).toMatchObject({ block: true });
		});

		it("trailing * is treated as a generic prefix glob", async () => {
			const { toolCallHandler } = setup({ configFile: JSON.stringify({ allowed: ["npm *"] }) });
			const result = await toolCallHandler!(bashEvent("npm install foo"), makeCtx().ctx);

			expect(result).toBeUndefined();
		});

		it("ignores empty/whitespace patterns in the allow-list", async () => {
			const { toolCallHandler } = setup({ configFile: JSON.stringify({ allowed: ["", "   "] }) });
			const result = await toolCallHandler!(bashEvent("ls"), makeCtx({ hasUI: false }).ctx);

			expect(result).toMatchObject({ block: true });
		});

		it("permits chained commands when every segment matches", async () => {
			const { toolCallHandler } = setup({
				configFile: JSON.stringify({ allowed: ["ls", "git status:*"] }),
			});
			const result = await toolCallHandler!(bashEvent("ls && git status -sb"), makeCtx().ctx);

			expect(result).toBeUndefined();
		});

		it("prompts when one segment of a chain doesn't match", async () => {
			const { toolCallHandler } = setup({ configFile: JSON.stringify({ allowed: ["ls"] }) });
			const { ctx, select } = makeCtx({ pick: () => "Deny" });
			const result = await toolCallHandler!(bashEvent("ls && rm -rf /"), ctx);

			expect(select).toHaveBeenCalled();
			expect(result).toEqual({ block: true, reason: "Blocked by user" });
		});
	});

	describe("tool_call event - non-interactive (no UI)", () => {
		it("blocks with informative reason", async () => {
			const { toolCallHandler } = setup({ configFile: '{"allowed":[]}' });
			const result = await toolCallHandler!(bashEvent("rm -rf /"), makeCtx({ hasUI: false }).ctx);

			expect(result).toEqual({ block: true, reason: expect.stringContaining("rm -rf /") });
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
			expect(fs.writeFileSync).not.toHaveBeenCalled();
		});

		it("persists exact rule on 'Allow always (exact)'", async () => {
			const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
			const { ctx, notify } = makeCtx({
				pick: (options) => options.find((option) => option.startsWith("Allow always (exact):")) ?? null,
			});
			const result = await toolCallHandler!(bashEvent("npm install foo"), ctx);

			expect(result).toBeUndefined();
			expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
			const [, content] = fs.writeFileSync.mock.calls.at(-1)!;
			expect(JSON.parse(content as string).allowed).toContain("npm install foo");
			expect(notify).toHaveBeenCalledWith(expect.stringContaining("Added rule"), "info");
		});

		it("persists prefix rule on 'Allow always: <prefix>:*'", async () => {
			const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
			const { ctx } = makeCtx({
				pick: (options) => options.find((option) => option === "Allow always: git status:*") ?? null,
			});
			const result = await toolCallHandler!(bashEvent("git status -sb"), ctx);

			expect(result).toBeUndefined();
			const [, content] = fs.writeFileSync.mock.calls.at(-1)!;
			expect(JSON.parse(content as string).allowed).toContain("git status:*");
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
			const { toolCallHandler } = setup({
				configFile: JSON.stringify({ allowed: ["git status:*"] }),
			});
			let captured: string[] = [];
			const { ctx } = makeCtx({
				pick: (options) => {
					captured = options;

					return "Deny";
				},
			});

			// Chain forces the prompt: "git status" matches but "rm foo" doesn't.
			await toolCallHandler!(bashEvent("git status && rm foo"), ctx);

			expect(captured).not.toContain("Allow always: git status:*");
		});

		it("does not offer exact label when full command literal is already a rule", async () => {
			// `splitChains: true` (default) splits "ls; pwd" into ["ls", "pwd"], neither
			// of which equals the literal rule "ls; pwd" — so the prompt fires. The
			// trimmed full command "ls; pwd" IS already in the list, so the exact label
			// must be omitted.
			const { toolCallHandler } = setup({ configFile: JSON.stringify({ allowed: ["ls; pwd"] }) });
			let captured: string[] = [];
			const { ctx } = makeCtx({
				pick: (options) => {
					captured = options;

					return "Deny";
				},
			});

			await toolCallHandler!(bashEvent("ls; pwd"), ctx);

			expect(captured).toEqual(expect.not.arrayContaining([expect.stringMatching(/^Allow always \(exact\):/)]));
			expect(captured).toContain("Allow once");
			expect(captured).toContain("Deny");
		});

		it("notifies error when persisting exact rule fails", async () => {
			const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
			fs.writeFileSync.mockImplementation(() => {
				throw new Error("disk full");
			});
			const { ctx, notify } = makeCtx({
				pick: (options) => options.find((option) => option.startsWith("Allow always (exact):")) ?? null,
			});

			await toolCallHandler!(bashEvent("ls"), ctx);

			expect(notify).toHaveBeenCalledWith(
				expect.stringContaining("Failed to persist rule"),
				"error",
			);
		});

		it("notifies error when persisting prefix rule fails", async () => {
			const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
			fs.writeFileSync.mockImplementation(() => {
				throw new Error("nope");
			});
			const { ctx, notify } = makeCtx({
				pick: (options) => options.find((option) => option === "Allow always: git status:*") ?? null,
			});

			await toolCallHandler!(bashEvent("git status -sb"), ctx);

			expect(notify).toHaveBeenCalledWith(expect.stringContaining("Failed to persist rule"), "error");
		});

		it("handles non-Error thrown values during persistence", async () => {
			const { toolCallHandler, fs } = setup({ configFile: '{"allowed":[]}' });
			fs.writeFileSync.mockImplementation(() => {
				// eslint-disable-next-line @typescript-eslint/only-throw-error
				throw "string failure";
			});
			const { ctx, notify } = makeCtx({
				pick: (options) => options.find((option) => option.startsWith("Allow always (exact):")) ?? null,
			});

			await toolCallHandler!(bashEvent("ls"), ctx);

			expect(notify).toHaveBeenCalledWith(expect.stringContaining("string failure"), "error");
		});
	});

	describe("splitCommand parsing (via tool_call)", () => {
		it("treats single-quoted segments as opaque (separators inside are ignored)", async () => {
			const { toolCallHandler } = setup({
				configFile: JSON.stringify({ allowed: ["echo 'a;b':*"] }),
			});
			const result = await toolCallHandler!(bashEvent("echo 'a;b'"), makeCtx().ctx);

			expect(result).toBeUndefined();
		});

		it("treats double-quoted segments as opaque", async () => {
			const { toolCallHandler } = setup({
				configFile: JSON.stringify({ allowed: [`echo "a|b":*`] }),
			});
			const result = await toolCallHandler!(bashEvent(`echo "a|b"`), makeCtx().ctx);

			expect(result).toBeUndefined();
		});

		it("handles backslash escapes inside quotes", async () => {
			const { toolCallHandler } = setup({
				configFile: JSON.stringify({ allowed: [String.raw`echo "a\"b":*`] }),
			});
			const result = await toolCallHandler!(bashEvent(String.raw`echo "a\"b"`), makeCtx().ctx);

			expect(result).toBeUndefined();
		});

		it("splits on ||, ;, single |, and newlines", async () => {
			const { toolCallHandler } = setup({
				configFile: JSON.stringify({ allowed: ["a", "b", "c", "d", "e"] }),
			});
			const result = await toolCallHandler!(bashEvent("a || b ; c | d\ne"), makeCtx().ctx);

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
