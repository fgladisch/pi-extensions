import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as fs from "node:fs/promises";

const mockGetAgentDir = jest.fn(() => "/home/test/.pi/agent");

jest.mock(
  "@earendil-works/pi-coding-agent",
  () => ({
    CustomEditor: class MockCustomEditor {
      constructor(
        readonly tui: { readonly requestRender: () => void },
        readonly theme: unknown,
        readonly keybindings: unknown,
      ) {}

      render(width: number): string[] {
        return ["─".repeat(width), "".padEnd(width), "─".repeat(width)];
      }
    },
    getAgentDir: mockGetAgentDir,
  }),
  { virtual: true },
);

jest.mock("node:fs/promises", () => ({
  readFile: jest.fn(),
}));

jest.mock(
  "@earendil-works/pi-tui",
  () => {
    const ansiPattern = /\x1b\[[0-9;]*m/g;
    const visibleWidth = (text: string) => text.replace(ansiPattern, "").length;

    return {
      truncateToWidth: (text: string, width: number) => {
        if (visibleWidth(text) <= width) {
          return text;
        }

        let output = "";
        let visible = 0;
        let index = 0;

        while (index < text.length && visible < width) {
          const match = text.slice(index).match(/^\x1b\[[0-9;]*m/);

          if (match?.[0]) {
            output += match[0];
            index += match[0].length;
            continue;
          }

          output += text[index];
          visible++;
          index++;
        }

        return output;
      },
      visibleWidth,
    };
  },
  { virtual: true },
);

type EventHandler = (...args: readonly unknown[]) => unknown;

type FakePi = {
  readonly getThinkingLevel: jest.Mock<() => string>;
  readonly on: jest.Mock<(eventName: string, handler: EventHandler) => void>;
  readonly registerCommand: jest.Mock<
    (name: string, command: { readonly handler: EventHandler }) => void
  >;
};

type FakeFooterData = {
  readonly getGitBranch: jest.Mock<() => string | null>;
  readonly getExtensionStatuses: jest.Mock<() => ReadonlyMap<string, string>>;
  readonly onBranchChange: jest.Mock<(callback: () => void) => () => void>;
};

type FakeContext = {
  readonly hasUI: boolean;
  readonly cwd: string;
  readonly model?: { readonly id: string; readonly provider?: string };
  readonly getContextUsage: jest.Mock<
    () => { readonly percent: number | null } | undefined
  >;
  readonly ui: {
    readonly setEditorComponent: jest.Mock<(factory: unknown) => unknown>;
    readonly setFooter: jest.Mock<(factory: unknown) => unknown>;
    readonly notify: jest.Mock<(message: string, level: string) => void>;
    readonly theme: {
      readonly fg: jest.Mock<(color: "accent", text: string) => string>;
    };
  };
};

type FooterThemeColor = "accent" | "dim" | "text";

type FooterThemeBackground = Parameters<Theme["bg"]>[0];

type FooterTestTheme = Theme & {
  readonly bg: jest.Mock<
    (color: FooterThemeBackground, text: string) => string
  >;
  readonly fg: jest.Mock<(color: ThemeColor, text: string) => string>;
  readonly getBgAnsi: jest.Mock<(color: FooterThemeBackground) => string>;
};

const FOOTER_END_CAP_STYLED = customMessageBackgroundColor("");
const DEFAULT_STYLED_SEGMENTS = customMessageBackground(
  ` ${textColor(" gpt-5.5 (medium)")} ${dimColor("")} ${textColor("󰊚 69%")} ${dimColor("")} ${textColor(" pi-extensions")} ${dimColor("")} ${textColor(" main")} `,
);
const DEFAULT_STYLED_LINE = `${DEFAULT_STYLED_SEGMENTS}${FOOTER_END_CAP_STYLED}`;

function accentColor(text: string): string {
  return `\x1b[35m${text}\x1b[0m`;
}

function textColor(text: string): string {
  return `\x1b[37m${text}\x1b[0m`;
}

function dimColor(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

function customMessageBackground(text: string): string {
  return `\x1b[48;5;236m${text.replaceAll("\x1b[0m", "\x1b[0m\x1b[48;5;236m")}\x1b[49m`;
}

function customMessageBackgroundColor(text: string): string {
  return `\x1b[38;5;236m${text}\x1b[39m`;
}

function footerLine(text: string): string {
  return `${customMessageBackground(`${text} `)}${FOOTER_END_CAP_STYLED}`;
}

function footerColor(color: FooterThemeColor, text: string): string {
  if (color === "accent") {
    return accentColor(text);
  }

  if (color === "text") {
    return textColor(text);
  }

  return dimColor(text);
}

function makeFooterTheme(): FooterTestTheme {
  const theme: Partial<Theme> = {
    bg: jest.fn((_color: FooterThemeBackground, text: string) =>
      customMessageBackground(text),
    ),
    fg: jest.fn((color: ThemeColor, text: string) =>
      footerColor(color as FooterThemeColor, text),
    ),
    getBgAnsi: jest.fn((_color: FooterThemeBackground) => "\x1b[48;5;236m"),
  };

  return theme as FooterTestTheme;
}

function setup() {
  jest.resetModules();

  const handlers = new Map<string, EventHandler>();
  const commands = new Map<string, { readonly handler: EventHandler }>();
  const pi: FakePi = {
    getThinkingLevel: jest.fn(() => "medium"),
    on: jest.fn((eventName: string, handler: EventHandler) => {
      handlers.set(eventName, handler);
    }),
    registerCommand: jest.fn(
      (name: string, command: { readonly handler: EventHandler }) => {
        commands.set(name, command);
      },
    ),
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- Jest runs as CJS
  const extension = require("../extensions") as {
    default: (pi: FakePi) => void;
  };
  extension.default(pi);

  return { pi, handlers, commands };
}

function loadUtils() {
  /* eslint-disable @typescript-eslint/no-require-imports -- Jest runs as CJS */
  const defaults =
    require("../extensions/defaults") as typeof import("../extensions/defaults");
  const utils =
    require("../extensions/utils") as typeof import("../extensions/utils");
  /* eslint-enable @typescript-eslint/no-require-imports */

  return { ...defaults, ...utils };
}

function makeContext(overrides: Partial<FakeContext> = {}): FakeContext {
  return {
    hasUI: true,
    cwd: "/Users/felix/code/pi-extensions",
    model: { id: "gpt-5.5" },
    getContextUsage: jest.fn(() => ({ percent: 69 })),
    ui: {
      setEditorComponent: jest.fn(),
      setFooter: jest.fn(),
      notify: jest.fn(),
      theme: {
        fg: jest.fn(
          (_color: "accent", text: string) => `\x1b[35m${text}\x1b[0m`,
        ),
      },
    },
    ...overrides,
  };
}

function makeFooterData(
  branchName: string | null = "main",
  extensionStatuses: ReadonlyMap<string, string> = new Map(),
) {
  const unsubscribe = jest.fn();
  let branchChangeCallback: (() => void) | null = null;
  const footerData: FakeFooterData = {
    getGitBranch: jest.fn(() => branchName),
    getExtensionStatuses: jest.fn(() => extensionStatuses),
    onBranchChange: jest.fn((callback: () => void) => {
      branchChangeCallback = callback;

      return unsubscribe;
    }),
  };

  return {
    footerData,
    unsubscribe,
    triggerBranchChange: () => branchChangeCallback?.(),
  };
}

type FooterFactory = (
  tui: { readonly requestRender: () => void },
  theme: unknown,
  footerData: FakeFooterData,
) => {
  readonly dispose?: () => void;
  readonly invalidate?: () => void;
  readonly render: (width: number) => readonly string[];
};

function getFooterFactory(ctx: FakeContext): FooterFactory {
  const factory = ctx.ui.setFooter.mock.calls.at(0)?.at(0);

  if (typeof factory !== "function") {
    throw new Error("footer factory was not registered");
  }

  return factory as FooterFactory;
}

type EditorFactory = (
  tui: { readonly requestRender: () => void },
  theme: unknown,
  keybindings: unknown,
) => { readonly render: (width: number) => readonly string[] };

function getEditorFactory(ctx: FakeContext): EditorFactory {
  const factory = ctx.ui.setEditorComponent.mock.calls.at(0)?.at(0);

  if (typeof factory !== "function") {
    throw new Error("editor factory was not registered");
  }

  return factory as EditorFactory;
}

async function trigger(
  handlers: ReadonlyMap<string, EventHandler>,
  eventName: string,
  ...args: readonly unknown[]
) {
  const handler = handlers.get(eventName);

  if (!handler) {
    throw new Error(`${eventName} handler was not registered`);
  }

  await handler(...args);
}

describe("footer utilities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/home/test/.pi/agent");
    (fs.readFile as jest.Mock<any>).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
  });

  it("formats the default footer line without unavailable thinking", () => {
    const { DEFAULT_FOOTER_CONFIG, formatFooterLine } = loadUtils();

    expect(
      formatFooterLine({
        config: DEFAULT_FOOTER_CONFIG,
        modelId: "gpt-5.5",
        providerName: null,
        thinkingLevel: null,
        contextUsagePercent: 69,
        projectName: "pi-extensions",
        branchName: "main",
        extensionStatuses: [],
        theme: makeFooterTheme(),
      }),
    ).toBe(
      footerLine(
        ` ${textColor(" gpt-5.5")} ${dimColor("")} ${textColor("󰊚 69%")} ${dimColor("")} ${textColor(" pi-extensions")} ${dimColor("")} ${textColor(" main")}`,
      ),
    );
  });

  it("renders the footer body with custom message background and appends a matching pointed pill cap", () => {
    const { DEFAULT_FOOTER_CONFIG, formatFooterLine } = loadUtils();

    expect(
      formatFooterLine({
        config: DEFAULT_FOOTER_CONFIG,
        modelId: "gpt-5.5",
        providerName: null,
        thinkingLevel: null,
        contextUsagePercent: 69,
        projectName: "pi-extensions",
        branchName: "main",
        extensionStatuses: [],
        theme: makeFooterTheme(),
      }),
    ).toBe(
      footerLine(
        ` ${textColor(" gpt-5.5")} ${dimColor("")} ${textColor("󰊚 69%")} ${dimColor("")} ${textColor(" pi-extensions")} ${dimColor("")} ${textColor(" main")}`,
      ),
    );
  });

  it("formats available thinking inside the model segment", () => {
    const { DEFAULT_FOOTER_CONFIG, formatFooterLine } = loadUtils();

    expect(
      formatFooterLine({
        config: DEFAULT_FOOTER_CONFIG,
        modelId: "gpt-5.5",
        providerName: null,
        thinkingLevel: "med",
        contextUsagePercent: 69,
        projectName: "pi-extensions",
        branchName: "main",
        extensionStatuses: [],
        theme: makeFooterTheme(),
      }),
    ).toBe(
      footerLine(
        ` ${textColor(" gpt-5.5 (med)")} ${dimColor("")} ${textColor("󰊚 69%")} ${dimColor("")} ${textColor(" pi-extensions")} ${dimColor("")} ${textColor(" main")}`,
      ),
    );
  });

  it("omits the provider segment when enabled but the provider name is unknown", () => {
    const { DEFAULT_FOOTER_CONFIG, formatFooterLine } = loadUtils();
    const config = {
      ...DEFAULT_FOOTER_CONFIG,
      segments: { ...DEFAULT_FOOTER_CONFIG.segments, provider: true },
    };

    const lineWithoutProvider = formatFooterLine({
      config: DEFAULT_FOOTER_CONFIG,
      modelId: "gpt-5.5",
      providerName: null,
      thinkingLevel: null,
      contextUsagePercent: 69,
      projectName: "pi-extensions",
      branchName: "main",
      extensionStatuses: [],
      theme: makeFooterTheme(),
    });
    const lineWithProviderEnabledButUnknown = formatFooterLine({
      config,
      modelId: "gpt-5.5",
      providerName: null,
      thinkingLevel: null,
      contextUsagePercent: 69,
      projectName: "pi-extensions",
      branchName: "main",
      extensionStatuses: [],
      theme: makeFooterTheme(),
    });

    expect(lineWithProviderEnabledButUnknown).toBe(lineWithoutProvider);
  });

  it("renders the provider segment before the model when enabled", async () => {
    (fs.readFile as jest.Mock<any>).mockResolvedValue(
      JSON.stringify({
        icons: { provider: "P", model: "M", context: "C", project: "D" },
        separator: "|",
        segments: { provider: true, branch: false },
      }),
    );
    const { loadFooterConfig, formatFooterLine } = loadUtils();

    const config = await loadFooterConfig();

    expect(
      formatFooterLine({
        config,
        modelId: "claude-opus-4-7",
        providerName: "claude-bridge",
        thinkingLevel: "high",
        contextUsagePercent: 69,
        projectName: "pi-extensions",
        branchName: "main",
        extensionStatuses: [],
        theme: makeFooterTheme(),
      }),
    ).toBe(
      footerLine(
        ` ${textColor("P claude-bridge")} ${dimColor("|")} ${textColor("M claude-opus-4-7 (high)")} ${dimColor("|")} ${textColor("C 69%")} ${dimColor("|")} ${textColor("D pi-extensions")}`,
      ),
    );
  });

  it("honors custom icons, separator, hidden fields, and prompt input prefix", async () => {
    (fs.readFile as jest.Mock<any>).mockResolvedValue(
      JSON.stringify({
        icons: { model: "M", context: "C", project: "P", branch: "B" },
        promptInput: { prefix: "❯" },
        separator: "|",
        segments: { branch: false },
      }),
    );
    const { loadFooterConfig, formatFooterLine } = loadUtils();

    const config = await loadFooterConfig();

    expect(config.promptInput.prefix).toBe("❯");
    expect(
      formatFooterLine({
        config,
        modelId: "gpt-5.5",
        providerName: null,
        thinkingLevel: "high",
        contextUsagePercent: 69,
        projectName: "pi-extensions",
        branchName: "main",
        extensionStatuses: [],
        theme: makeFooterTheme(),
      }),
    ).toBe(
      footerLine(
        ` ${textColor("M gpt-5.5 (high)")} ${dimColor("|")} ${textColor("C 69%")} ${dimColor("|")} ${textColor("P pi-extensions")}`,
      ),
    );
  });

  it("uses defaults when config is missing or fields have invalid types", async () => {
    (fs.readFile as jest.Mock<any>).mockResolvedValue(
      JSON.stringify({
        icons: { model: 7 },
        promptInput: { prefix: 9 },
        separator: false,
        thinkingPrefix: "think:",
        defaultThinkingLevel: ["high"],
        segments: { model: "yes", context: "no", thinking: false },
      }),
    );
    const { loadFooterConfig, DEFAULT_FOOTER_CONFIG } = loadUtils();

    await expect(loadFooterConfig()).resolves.toEqual(DEFAULT_FOOTER_CONFIG);
  });
});

describe("pi-footer extension", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/home/test/.pi/agent");
    (fs.readFile as jest.Mock<any>).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
  });

  it("registers a one-line footer on UI session start", async () => {
    const { handlers, pi } = setup();
    pi.getThinkingLevel.mockReturnValue("off");
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    expect(ctx.ui.setFooter).toHaveBeenCalledTimes(1);
    const { footerData } = makeFooterData();
    const theme = makeFooterTheme();
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      theme,
      footerData,
    );

    expect(footer.render(200)).toEqual([
      footerLine(
        ` ${textColor(" gpt-5.5 (off)")} ${dimColor("")} ${textColor("󰊚 69%")} ${dimColor("")} ${textColor(" pi-extensions")} ${dimColor("")} ${textColor(" main")}`,
      ),
    ]);
    expect(theme.fg).toHaveBeenCalledWith("text", " gpt-5.5 (off)");
    expect(theme.fg).toHaveBeenCalledWith("dim", "");
  });

  it("renders the current thinking level before any thinking change event", async () => {
    const { handlers, pi } = setup();
    pi.getThinkingLevel.mockReturnValue("medium");
    const ctx = makeContext();

    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const { footerData } = makeFooterData();
    const theme = makeFooterTheme();
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      theme,
      footerData,
    );

    expect(footer.render(200)).toEqual([DEFAULT_STYLED_LINE]);
  });

  it("does not register a footer without UI", async () => {
    const { handlers } = setup();
    const ctx = makeContext({ hasUI: false });

    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    expect(ctx.ui.setFooter).not.toHaveBeenCalled();
    expect(ctx.ui.setEditorComponent).not.toHaveBeenCalled();
  });

  it("registers a prompt input editor with the configured prefix", async () => {
    (fs.readFile as jest.Mock<any>).mockResolvedValue(
      JSON.stringify({ promptInput: { prefix: "➜" } }),
    );
    const { handlers } = setup();
    const ctx = makeContext();

    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    expect(ctx.ui.setEditorComponent).toHaveBeenCalledTimes(1);
    const editor = getEditorFactory(ctx)({ requestRender: jest.fn() }, {}, {});

    expect(editor.render(20)).toEqual([
      "  ──────────────────",
      "\x1b[35m➜\x1b[0m                   ",
      "  ──────────────────",
    ]);
    expect(ctx.ui.theme.fg).toHaveBeenCalledWith("accent", "➜");
  });

  it("renders extension statuses after the branch with the configured separator", async () => {
    const { handlers } = setup();
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const { footerData } = makeFooterData(
      "main",
      new Map([
        ["caveman", "🪨 caveman lite"],
        ["preset", "preset:dev"],
      ]),
    );
    const theme = makeFooterTheme();
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      theme,
      footerData,
    );

    expect(footer.render(200)).toEqual([
      footerLine(
        ` ${textColor(" gpt-5.5 (medium)")} ${dimColor("")} ${textColor("󰊚 69%")} ${dimColor("")} ${textColor(" pi-extensions")} ${dimColor("")} ${textColor(" main")} ${dimColor("")} ${textColor("🪨 caveman lite")} ${dimColor("")} ${textColor("preset:dev")}`,
      ),
    ]);
    expect(theme.fg).toHaveBeenCalledWith("text", "🪨 caveman lite");
    expect(theme.fg).toHaveBeenCalledWith("text", "preset:dev");
  });

  it("strips existing ANSI before coloring extension statuses", async () => {
    const { handlers } = setup();
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const { footerData } = makeFooterData(
      "main",
      new Map([["preset", "\x1b[35mpreset:dev\x1b[0m"]]),
    );
    const theme = makeFooterTheme();
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      theme,
      footerData,
    );

    expect(footer.render(200)).toEqual([
      footerLine(
        ` ${textColor(" gpt-5.5 (medium)")} ${dimColor("")} ${textColor("󰊚 69%")} ${dimColor("")} ${textColor(" pi-extensions")} ${dimColor("")} ${textColor(" main")} ${dimColor("")} ${textColor("preset:dev")}`,
      ),
    ]);
    expect(theme.fg).toHaveBeenCalledWith("text", "preset:dev");
  });

  it("uses the project fallback and hides unavailable model and branch segments", async () => {
    const { handlers } = setup();
    const ctx = makeContext({
      cwd: "/",
      model: undefined,
    });
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const { footerData } = makeFooterData(null);
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      makeFooterTheme(),
      footerData,
    );

    expect(footer.render(200)).toEqual([
      footerLine(
        ` ${textColor("󰊚 69%")} ${dimColor("")} ${textColor(" (root)")}`,
      ),
    ]);
  });

  it("truncates rendered footer lines to the available width", async () => {
    const { handlers } = setup();
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const { footerData } = makeFooterData();
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      makeFooterTheme(),
      footerData,
    );

    expect(footer.render(8)).toEqual(["\x1b[48;5;236m \x1b[37m gpt-5"]);
  });

  it("omits context segment when context usage is unavailable", async () => {
    const { handlers } = setup();
    const ctx = makeContext({
      getContextUsage: jest.fn(() => ({ percent: null })),
    });
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const { footerData } = makeFooterData();
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      makeFooterTheme(),
      footerData,
    );

    expect(footer.render(200)).toEqual([
      footerLine(
        ` ${textColor(" gpt-5.5 (medium)")} ${dimColor("")} ${textColor(" pi-extensions")} ${dimColor("")} ${textColor(" main")}`,
      ),
    ]);
  });

  it("requests render only when branch, thinking, and model values change", async () => {
    const { handlers } = setup();
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const branchRender = jest.fn();
    const { footerData, unsubscribe, triggerBranchChange } = makeFooterData();
    const footer = getFooterFactory(ctx)(
      { requestRender: branchRender },
      makeFooterTheme(),
      footerData,
    );

    triggerBranchChange();
    await trigger(handlers, "thinking_level_select", { level: "med" }, ctx);
    await trigger(handlers, "thinking_level_select", { level: "med" }, ctx);
    await trigger(handlers, "thinking_level_select", { level: "high" }, ctx);
    await trigger(handlers, "model_select", { model: { id: "gpt-5.5" } }, ctx);
    await trigger(handlers, "model_select", { model: { id: "new" } }, ctx);
    footer.dispose?.();

    expect(branchRender).toHaveBeenCalledTimes(4);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("requests render when the provider changes even if the model id stays the same", async () => {
    const { handlers } = setup();
    const ctx = makeContext({
      model: { id: "claude-opus-4-7", provider: "anthropic" },
    });
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const branchRender = jest.fn();
    const { footerData } = makeFooterData();
    const footer = getFooterFactory(ctx)(
      { requestRender: branchRender },
      makeFooterTheme(),
      footerData,
    );

    await trigger(
      handlers,
      "model_select",
      { model: { id: "claude-opus-4-7", provider: "anthropic" } },
      ctx,
    );
    await trigger(
      handlers,
      "model_select",
      { model: { id: "claude-opus-4-7", provider: "claude-bridge" } },
      ctx,
    );
    footer.dispose?.();

    expect(branchRender).toHaveBeenCalledTimes(1);
  });

  it("reloads config and reapplies the footer", async () => {
    const { handlers, commands } = setup();
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);
    (fs.readFile as jest.Mock<any>).mockResolvedValue(
      JSON.stringify({ separator: "|" }),
    );

    await commands.get("footer-reload")?.handler("", ctx);

    expect(ctx.ui.setFooter).toHaveBeenCalledTimes(2);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Footer reloaded", "info");
  });
});
