import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as fs from "node:fs/promises";

const mockGetAgentDir = jest.fn(() => "/home/test/.pi/agent");

jest.mock(
  "@earendil-works/pi-coding-agent",
  () => ({
    getAgentDir: mockGetAgentDir,
  }),
  { virtual: true },
);

jest.mock("node:fs/promises", () => ({
  readFile: jest.fn(),
}));

jest.mock(
  "@earendil-works/pi-tui",
  () => ({
    truncateToWidth: (text: string, width: number) => {
      const chars = [...text];

      return chars.length > width ? chars.slice(0, width).join("") : text;
    },
  }),
  { virtual: true },
);

type EventHandler = (...args: readonly unknown[]) => unknown;

type FakePi = {
  readonly on: jest.Mock<(eventName: string, handler: EventHandler) => void>;
  readonly registerCommand: jest.Mock<
    (name: string, command: { readonly handler: EventHandler }) => void
  >;
};

type FakeFooterData = {
  readonly getGitBranch: jest.Mock<() => string | null>;
  readonly onBranchChange: jest.Mock<(callback: () => void) => () => void>;
};

type FakeContext = {
  readonly hasUI: boolean;
  readonly cwd: string;
  readonly model?: { readonly id: string };
  readonly ui: {
    readonly setFooter: jest.Mock<(factory: unknown) => unknown>;
    readonly notify: jest.Mock<(message: string, level: string) => void>;
  };
};

const DEFAULT_LINE = " GPT-5.5  think:med   pi-extensions   main";

function setup() {
  jest.resetModules();

  const handlers = new Map<string, EventHandler>();
  const commands = new Map<string, { readonly handler: EventHandler }>();
  const pi: FakePi = {
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
  const types =
    require("../extensions/types") as typeof import("../extensions/types");
  const utils =
    require("../extensions/utils") as typeof import("../extensions/utils");
  /* eslint-enable @typescript-eslint/no-require-imports */

  return { ...types, ...utils };
}

function makeContext(overrides: Partial<FakeContext> = {}): FakeContext {
  return {
    hasUI: true,
    cwd: "/Users/felix/code/pi-extensions",
    model: { id: "GPT-5.5" },
    ui: {
      setFooter: jest.fn(),
      notify: jest.fn(),
    },
    ...overrides,
  };
}

function makeFooterData(branchName: string | null = "main") {
  const unsubscribe = jest.fn();
  let branchChangeCallback: (() => void) | null = null;
  const footerData: FakeFooterData = {
    getGitBranch: jest.fn(() => branchName),
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

  it("formats the default footer line", () => {
    const { DEFAULT_FOOTER_CONFIG, formatFooterLine } = loadUtils();

    expect(
      formatFooterLine({
        config: DEFAULT_FOOTER_CONFIG,
        modelId: "GPT-5.5",
        thinkingLevel: "med",
        projectName: "pi-extensions",
        branchName: "main",
      }),
    ).toBe(DEFAULT_LINE);
  });

  it("honors custom icons, separator, prefix, and hidden fields", async () => {
    (fs.readFile as jest.Mock<any>).mockResolvedValue(
      JSON.stringify({
        icons: { model: "M", project: "P", branch: "B" },
        separator: "|",
        thinkingPrefix: "thinking=",
        show: { branch: false },
      }),
    );
    const { loadFooterConfig, formatFooterLine } = loadUtils();

    const config = await loadFooterConfig();

    expect(
      formatFooterLine({
        config,
        modelId: "GPT-5.5",
        thinkingLevel: "high",
        projectName: "pi-extensions",
        branchName: "main",
      }),
    ).toBe("M GPT-5.5 | thinking=high | P pi-extensions");
  });

  it("uses defaults when config is missing or fields have invalid types", async () => {
    (fs.readFile as jest.Mock<any>).mockResolvedValue(
      JSON.stringify({
        icons: { model: 7 },
        separator: false,
        defaultThinkingLevel: ["high"],
        show: { model: "yes" },
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

  it("registers a two-line footer on UI session start", async () => {
    const { handlers } = setup();
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    expect(ctx.ui.setFooter).toHaveBeenCalledTimes(1);
    const { footerData } = makeFooterData();
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      {},
      footerData,
    );

    expect(footer.render(200)).toEqual([DEFAULT_LINE, ""]);
  });

  it("does not register a footer without UI", async () => {
    const { handlers } = setup();
    const ctx = makeContext({ hasUI: false });

    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    expect(ctx.ui.setFooter).not.toHaveBeenCalled();
  });

  it("uses configured fallbacks for missing model, project, and branch", async () => {
    const { handlers } = setup();
    const ctx = makeContext({
      cwd: "/",
      model: undefined,
    });
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const { footerData } = makeFooterData(null);
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      {},
      footerData,
    );

    expect(footer.render(200)).toEqual([
      " no-model  think:med   workspace   no-branch",
      "",
    ]);
  });

  it("truncates rendered footer lines to the available width", async () => {
    const { handlers } = setup();
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const { footerData } = makeFooterData();
    const footer = getFooterFactory(ctx)(
      { requestRender: jest.fn() },
      {},
      footerData,
    );

    expect(footer.render(8)).toEqual([" GPT-5.", ""]);
  });

  it("requests render only when branch, thinking, and model values change", async () => {
    const { handlers } = setup();
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);

    const branchRender = jest.fn();
    const { footerData, unsubscribe, triggerBranchChange } = makeFooterData();
    const footer = getFooterFactory(ctx)(
      { requestRender: branchRender },
      {},
      footerData,
    );

    triggerBranchChange();
    await trigger(handlers, "thinking_level_select", { level: "med" }, ctx);
    await trigger(handlers, "thinking_level_select", { level: "high" }, ctx);
    await trigger(handlers, "model_select", { model: { id: "GPT-5.5" } }, ctx);
    await trigger(handlers, "model_select", { model: { id: "new" } }, ctx);
    footer.dispose?.();

    expect(branchRender).toHaveBeenCalledTimes(3);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reloads config and reapplies the footer", async () => {
    const { handlers, commands } = setup();
    const ctx = makeContext();
    await trigger(handlers, "session_start", { reason: "startup" }, ctx);
    (fs.readFile as jest.Mock<any>).mockResolvedValue(
      JSON.stringify({ separator: "|", show: { thinking: false } }),
    );

    await commands.get("footer-reload")?.handler("", ctx);

    expect(ctx.ui.setFooter).toHaveBeenCalledTimes(2);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Footer reloaded", "info");
  });
});
