import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as fs from "node:fs/promises";

const mockGetPackages = jest.fn();
const mockSettingsManagerCreate = jest.fn(() => ({
  getPackages: mockGetPackages,
}));
const mockGetAgentDir = jest.fn(() => "/home/test/.pi/agent");

jest.mock(
  "@mariozechner/pi-coding-agent",
  () => ({
    getAgentDir: mockGetAgentDir,
    SettingsManager: {
      create: mockSettingsManagerCreate,
    },
  }),
  { virtual: true },
);

jest.mock("node:fs/promises", () => ({
  readFile: jest.fn(),
  readdir: jest.fn(),
  access: jest.fn(),
}));

jest.mock(
  "@mariozechner/pi-tui",
  () => {
    return {
      Box: class Box {
        addChild = jest.fn();

        constructor(
          public x: number,
          public y: number,
          public style?: (token: string) => string,
        ) {}
      },
      Text: class Text {
        constructor(
          public text: string,
          public x: number,
          public y: number,
        ) {}

        render() {
          return this.text.split("\n");
        }
      },
    };
  },
  { virtual: true },
);

type SessionStartEvent = { reason: string };

type SentWelcomeMessage = {
  readonly content: string;
  readonly details: {
    readonly header: unknown;
  };
};

const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function withoutAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function getSentMessage(pi: {
  sendMessage: jest.Mock<any>;
}): SentWelcomeMessage {
  return pi.sendMessage.mock.calls[0]![0] as SentWelcomeMessage;
}

function setup() {
  const registeredHandlers = new Map<string, (...args: any[]) => any>();
  const messageRenderers = new Map<string, (...args: any[]) => any>();

  const pi = {
    on: jest.fn((event: string, handler: (...args: any[]) => any) => {
      registeredHandlers.set(event, handler);
    }),
    registerMessageRenderer: jest.fn(
      (name: string, renderer: (...args: any[]) => any) => {
        messageRenderers.set(name, renderer);
      },
    ),
    exec: jest.fn<any>().mockResolvedValue({ code: 1, stdout: "" }),
    sendMessage: jest.fn(),
    getCommands: jest.fn<any>().mockReturnValue([]),
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../extensions") as {
    default: (pi: unknown) => void;
  };
  mod.default(pi as any);

  return {
    pi,
    triggerSessionStart: async (event: SessionStartEvent, ctx: any) => {
      const handler = registeredHandlers.get("session_start");
      if (handler) {
        await handler(event, ctx);
      }
    },
    getRenderer: (name: string) => messageRenderers.get(name),
  };
}

function makeCtx(hasUI: boolean = true, modelId: string = "test-model") {
  return {
    hasUI,
    cwd: "/test/cwd",
    model: {
      id: modelId,
    },
    ui: {
      theme: {
        bold: (s: string) => `**${s}**`,
        italic: (s: string) => `_${s}_`,
        fg: (c: string, s: string) => `<${c}>${s}</${c}>`,
        bg: (c: string, s: string) => `[${c}]${s}[/${c}]`,
      },
    },
  };
}

describe("welcome-message extension", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAgentDir.mockReturnValue("/home/test/.pi/agent");
    mockGetPackages.mockReturnValue([]);
    mockSettingsManagerCreate.mockReturnValue({
      getPackages: mockGetPackages,
    });

    (fs.readdir as jest.Mock<any>).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    (fs.access as jest.Mock<any>).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
  });

  it("ignores events that are not startup or new session", async () => {
    const { pi, triggerSessionStart } = setup();
    await triggerSessionStart({ reason: "reload" }, makeCtx());
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("renders welcome message for new sessions by default", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockRejectedValue(new Error("ENOENT"));
    (pi.exec as jest.Mock<any>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "branch") {
          return Promise.resolve({ code: 0, stdout: "main\n" });
        }

        return Promise.resolve({ code: 1, stdout: "" });
      },
    );

    await triggerSessionStart({ reason: "new" }, makeCtx());

    expect(pi.sendMessage).toHaveBeenCalledWith({
      customType: "welcome",
      content: expect.stringContaining("<accent>main</accent>"),
      display: true,
      details: expect.any(Object),
    });
  });

  it("suppresses welcome message for new sessions when disabled", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockImplementation((filePath: string) => {
      if (filePath === "/home/test/.pi/agent/settings.json") {
        return Promise.resolve(
          JSON.stringify({
            welcomeMessage: {
              showOnNewSession: false,
            },
          }),
        );
      }

      return Promise.reject(new Error("ENOENT"));
    });

    await triggerSessionStart({ reason: "new" }, makeCtx());

    expect(pi.exec).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("ignores environments without UI", async () => {
    const { pi, triggerSessionStart } = setup();
    await triggerSessionStart({ reason: "startup" }, makeCtx(false));
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("renders welcome message with package.json and clean git", async () => {
    const { pi, triggerSessionStart } = setup();

    // Mock package.json
    (fs.readFile as jest.Mock<any>).mockResolvedValue(
      JSON.stringify({
        name: "test-app",
        version: "1.0.0",
        description: "My test app",
      }),
    );

    // Mock git execs
    (pi.exec as jest.Mock<any>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (cmd === "git") {
          if (args[0] === "branch")
            return Promise.resolve({ code: 0, stdout: "main\n" });
          if (args[0] === "diff")
            return Promise.resolve({ code: 0, stdout: "" }); // clean
          if (args[0] === "log")
            return Promise.resolve({
              code: 0,
              stdout: "abc1234 initial commit\n",
            });
        }
        return Promise.resolve({ code: 1, stdout: "" });
      },
    );

    await triggerSessionStart({ reason: "startup" }, makeCtx());

    expect(pi.sendMessage).toHaveBeenCalledWith({
      customType: "welcome",
      content: expect.stringContaining("**<mdHeading>test-app</mdHeading>**"),
      display: true,
      details: expect.any(Object),
    });

    const message = getSentMessage(pi);
    expect(message.content).toContain("<dim> v1.0.0</dim>");
    expect(message.content).toContain("_My test app_");
    expect(message.content).toContain("<accent>main</accent>");
    expect(message.content).toContain(
      "<success>Clean working directory</success>",
    );
    expect(message.content).toContain("<dim>abc1234</dim> initial commit");
  });

  it("renders welcome message with missing package.json and dirty git", async () => {
    const { pi, triggerSessionStart } = setup();

    // Mock package.json missing
    (fs.readFile as jest.Mock<any>).mockRejectedValue(new Error("ENOENT"));

    // Mock git execs
    (pi.exec as jest.Mock<any>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (cmd === "git") {
          if (args[0] === "branch")
            return Promise.resolve({ code: 0, stdout: "feature\n" });
          if (args[0] === "diff")
            return Promise.resolve({
              code: 0,
              stdout: " 1 file changed, 1 insertion(+)",
            }); // dirty
          if (args[0] === "log")
            return Promise.resolve({ code: 0, stdout: "def5678 fix stuff\n" });
        }
        return Promise.resolve({ code: 1, stdout: "" });
      },
    );

    await triggerSessionStart({ reason: "startup" }, makeCtx());

    expect(pi.sendMessage).toHaveBeenCalledWith({
      customType: "welcome",
      content: expect.stringContaining("<accent>feature</accent>"),
      display: true,
      details: expect.any(Object),
    });

    const message = getSentMessage(pi);
    expect(message.content).not.toContain("📦"); // No package.json
    expect(message.content).toContain(
      "<warning>1 file changed, 1 insertion(+)</warning>",
    );
    expect(message.content).toContain("<dim>def5678</dim> fix stuff");
  });

  it("sends structured header data so renderer can center it at terminal width", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockRejectedValue(new Error("ENOENT"));
    (pi.exec as jest.Mock<any>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "branch") {
          return Promise.resolve({ code: 0, stdout: "main\n" });
        }

        return Promise.resolve({ code: 1, stdout: "" });
      },
    );

    await triggerSessionStart(
      { reason: "startup" },
      makeCtx(true, "anthropic/claude-sonnet-4"),
    );

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;

    expect(callArgs.content).toEqual(
      expect.stringContaining("🌿 <accent>main</accent>"),
    );
    expect(callArgs.details).toMatchObject({
      header: {
        modelId: "anthropic/claude-sonnet-4",
        logoColor: "orange",
      },
    });
  });

  it("uses configured green logo color", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockImplementation((filePath: string) => {
      if (filePath === "/home/test/.pi/agent/settings.json") {
        return Promise.resolve(
          JSON.stringify({
            welcomeMessage: {
              logoColor: "green",
            },
          }),
        );
      }

      return Promise.reject(new Error("ENOENT"));
    });
    (pi.exec as jest.Mock<any>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "branch") {
          return Promise.resolve({ code: 0, stdout: "main\n" });
        }

        return Promise.resolve({ code: 1, stdout: "" });
      },
    );

    await triggerSessionStart({ reason: "startup" }, makeCtx());

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;

    expect(callArgs.details).toMatchObject({
      header: {
        logoColor: "green",
      },
    });
  });

  it("falls back to orange when logo color is invalid", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockImplementation((filePath: string) => {
      if (filePath === "/home/test/.pi/agent/settings.json") {
        return Promise.resolve(
          JSON.stringify({
            welcomeMessage: {
              logoColor: "purple",
            },
          }),
        );
      }

      return Promise.reject(new Error("ENOENT"));
    });
    (pi.exec as jest.Mock<any>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "branch") {
          return Promise.resolve({ code: 0, stdout: "main\n" });
        }

        return Promise.resolve({ code: 1, stdout: "" });
      },
    );

    await triggerSessionStart({ reason: "startup" }, makeCtx());

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;

    expect(callArgs.details).toMatchObject({
      header: {
        logoColor: "orange",
      },
    });
  });

  it("omits pi logo and its margin when disabled", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockImplementation((filePath: string) => {
      if (filePath === "/home/test/.pi/agent/settings.json") {
        return Promise.resolve(
          JSON.stringify({
            welcomeMessage: {
              showLogo: false,
            },
          }),
        );
      }

      return Promise.reject(new Error("ENOENT"));
    });
    (pi.exec as jest.Mock<any>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "branch") {
          return Promise.resolve({ code: 0, stdout: "main\n" });
        }

        return Promise.resolve({ code: 1, stdout: "" });
      },
    );

    await triggerSessionStart(
      { reason: "startup" },
      makeCtx(true, "anthropic/claude-sonnet-4"),
    );

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;

    expect(callArgs.content).toBe(
      "🌿 <accent>main</accent>\n📊 <success>Clean working directory</success>",
    );
    expect(callArgs.details).toMatchObject({ header: null });
    expect(callArgs.content).not.toContain("██████╗  ██╗");
    expect(callArgs.content).not.toContain("anthropic/claude-sonnet-4");
  });

  it("registers a message renderer that centers the header at render width without custom background", () => {
    const { getRenderer } = setup();
    const renderer = getRenderer("welcome");
    expect(renderer).toBeDefined();

    const box = renderer!(
      {
        content: "summary",
        details: {
          header: { modelId: "test-model", logoColor: "orange" },
        },
      },
      {},
      makeCtx().ui.theme,
    );
    expect(box).toBeDefined();
    expect(box.addChild).toHaveBeenCalled();
    expect(box.style?.("token")).toBe("token");

    const text = (box.addChild as jest.Mock<any>).mock.calls[0]![0] as {
      render: (width: number) => string[];
    };
    const rendered = text.render(120).join("\n");
    const plainLines = withoutAnsi(rendered).split("\n");
    expect(plainLines.at(1)).toBe(
      "                                                      ██████╗  ██╗ ",
    );
    expect(plainLines.at(7)).toBe(
      "                                                       test-model",
    );
    expect(rendered).toMatch(/\x1b\[38;2;255;\d+;\d+m/);
    expect(rendered).toContain("summary");
  });

  it("ignores missing git command", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockRejectedValue(new Error("ENOENT"));
    (pi.exec as jest.Mock<any>).mockRejectedValue(
      new Error("Command not found"),
    );

    await triggerSessionStart({ reason: "startup" }, makeCtx());
    // Because there is no package json and git fails, output is empty and sendMessage is not called
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("respects welcomeMessage.sections from settings.json", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockImplementation((filePath: string) => {
      if (filePath === "/home/test/.pi/agent/settings.json") {
        return Promise.resolve(
          JSON.stringify({
            welcomeMessage: {
              sections: ["piResources"],
            },
          }),
        );
      }

      return Promise.reject(new Error("ENOENT"));
    });

    pi.getCommands.mockReturnValue([
      {
        name: "skill:brainstorming",
        source: "skill",
      },
    ]);

    await triggerSessionStart({ reason: "startup" }, makeCtx());

    expect(pi.exec).not.toHaveBeenCalled();

    const message = getSentMessage(pi);
    expect(message.content).toContain("**<mdHeading>[Skills]</mdHeading>**");
    expect(message.content).not.toContain("📦");
    expect(message.content).not.toContain("🌿");
  });

  it("suppresses welcome message when all sections are disabled", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockImplementation((filePath: string) => {
      if (filePath === "/home/test/.pi/agent/settings.json") {
        return Promise.resolve(
          JSON.stringify({
            welcomeMessage: {
              sections: [],
            },
          }),
        );
      }

      return Promise.reject(new Error("ENOENT"));
    });

    await triggerSessionStart({ reason: "startup" }, makeCtx());

    expect(pi.exec).not.toHaveBeenCalled();
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("renders skills, prompts, and extensions sections", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockRejectedValue(new Error("ENOENT"));
    mockGetPackages.mockReturnValue([
      "npm:pi-subagents",
      { source: "npm:pi-object-package" },
      "npm:pi-web-access",
      "",
    ]);

    (fs.readdir as jest.Mock<any>).mockResolvedValue([
      {
        name: "bash-approval.ts",
        isDirectory: () => false,
        isFile: () => true,
      },
      {
        name: "welcome-message.ts",
        isDirectory: () => false,
        isFile: () => true,
      },
      {
        name: "some-skill.spec.ts",
        isDirectory: () => false,
        isFile: () => true,
      },
      { name: "types.d.ts", isDirectory: () => false, isFile: () => true },
      { name: "node_modules", isDirectory: () => true, isFile: () => false },
      { name: "tests", isDirectory: () => true, isFile: () => false },
      { name: ".husky", isDirectory: () => true, isFile: () => false },
      { name: "my-extension", isDirectory: () => true, isFile: () => false },
      { name: "empty-dir", isDirectory: () => true, isFile: () => false },
      { name: "README.md", isDirectory: () => false, isFile: () => true },
    ]);

    (fs.access as jest.Mock<any>).mockImplementation((p: string) => {
      if (p.includes("my-extension")) {
        return Promise.resolve();
      }

      return Promise.reject(new Error("ENOENT"));
    });

    pi.getCommands.mockReturnValue([
      {
        name: "skill:brainstorming",
        source: "skill",
        sourceInfo: {
          path: "",
          source: "",
          scope: "user",
          origin: "top-level",
        },
      },
      {
        name: "skill:commit",
        source: "skill",
        sourceInfo: {
          path: "",
          source: "",
          scope: "user",
          origin: "top-level",
        },
      },
      {
        name: "parallel-review",
        source: "prompt",
        sourceInfo: { path: "", source: "", scope: "user", origin: "package" },
      },
      {
        name: "gather-context-and-clarify",
        source: "prompt",
        sourceInfo: { path: "", source: "", scope: "user", origin: "package" },
      },
      {
        name: "bash-approval-reload",
        source: "extension",
        sourceInfo: {
          path: "",
          source: "",
          scope: "user",
          origin: "top-level",
        },
      },
    ]);

    await triggerSessionStart({ reason: "startup" }, makeCtx());

    const message = getSentMessage(pi);
    expect(message.content).toContain("**<mdHeading>[Skills]</mdHeading>**");
    expect(message.content).toContain("brainstorming, commit");
    expect(message.content).toContain("**<mdHeading>[Prompts]</mdHeading>**");
    expect(message.content).toContain(
      "gather-context-and-clarify, parallel-review",
    );
    expect(message.content).toContain(
      "**<mdHeading>[Extensions]</mdHeading>**",
    );
    expect(message.content).toContain(
      "bash-approval.ts, my-extension, pi-object-package, pi-subagents, pi-web-access, welcome-message.ts",
    );
    expect(message.content).not.toContain("some-skill.spec.ts");
    expect(message.content).not.toContain("types.d.ts");
    expect(message.content).not.toContain("empty-dir");
    expect(message.content).not.toContain("node_modules");
    expect(message.content).not.toContain("bash-approval-reload");
  });

  it("omits resource sections when no skills, prompts, or extensions exist", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockRejectedValue(new Error("ENOENT"));
    (pi.exec as jest.Mock<any>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "branch") {
          return Promise.resolve({ code: 0, stdout: "main\n" });
        }

        return Promise.resolve({ code: 1, stdout: "" });
      },
    );

    await triggerSessionStart({ reason: "startup" }, makeCtx());

    const message = getSentMessage(pi);
    expect(message.content).not.toContain("[Skills]");
    expect(message.content).not.toContain("[Prompts]");
    expect(message.content).not.toContain("[Extensions]");
  });

  it("handles git log without space correctly", async () => {
    const { pi, triggerSessionStart } = setup();

    (fs.readFile as jest.Mock<any>).mockRejectedValue(new Error("ENOENT"));

    (pi.exec as jest.Mock<any>).mockImplementation(
      (cmd: string, args: string[]) => {
        if (cmd === "git") {
          if (args[0] === "branch")
            return Promise.resolve({ code: 0, stdout: "main\n" });
          if (args[0] === "diff")
            return Promise.resolve({ code: 0, stdout: "" });
          if (args[0] === "log")
            return Promise.resolve({ code: 0, stdout: "abc1234\ndef5678\n" }); // No space
        }
        return Promise.resolve({ code: 1, stdout: "" });
      },
    );

    await triggerSessionStart({ reason: "startup" }, makeCtx());

    const message = getSentMessage(pi);
    expect(message.content).toContain("  abc1234\n  def5678");
  });
});
