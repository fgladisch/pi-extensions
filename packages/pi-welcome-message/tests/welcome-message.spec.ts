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
      },
      Text: class Text {
        constructor(
          public text: string,
          public x: number,
          public y: number,
        ) {}
      },
    };
  },
  { virtual: true },
);

type SessionStartEvent = { reason: string };

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

function makeCtx(hasUI: boolean = true) {
  return {
    hasUI,
    cwd: "/test/cwd",
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

  it("ignores events that are not startup", async () => {
    const { pi, triggerSessionStart } = setup();
    await triggerSessionStart({ reason: "reload" }, makeCtx());
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
    });

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;
    expect(callArgs.content).toContain("<dim> v1.0.0</dim>");
    expect(callArgs.content).toContain("_My test app_");
    expect(callArgs.content).toContain("<accent>main</accent>");
    expect(callArgs.content).toContain(
      "<success>Clean working directory</success>",
    );
    expect(callArgs.content).toContain("<dim>abc1234</dim> initial commit");
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
    });

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;
    expect(callArgs.content).not.toContain("📦"); // No package.json
    expect(callArgs.content).toContain(
      "<warning>1 file changed, 1 insertion(+)</warning>",
    );
    expect(callArgs.content).toContain("<dim>def5678</dim> fix stuff");
  });

  it("registers a message renderer that returns a Box", () => {
    const { getRenderer } = setup();
    const renderer = getRenderer("welcome");
    expect(renderer).toBeDefined();

    const box = renderer!({ content: "hello world" }, {}, makeCtx().ui.theme);
    expect(box).toBeDefined();
    expect(box.addChild).toHaveBeenCalled();
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

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;

    expect(callArgs.content).toContain("**<mdHeading>[Skills]</mdHeading>**");
    expect(callArgs.content).not.toContain("📦");
    expect(callArgs.content).not.toContain("🌿");
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

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;

    expect(callArgs.content).toContain("**<mdHeading>[Skills]</mdHeading>**");
    expect(callArgs.content).toContain("brainstorming, commit");
    expect(callArgs.content).toContain("**<mdHeading>[Prompts]</mdHeading>**");
    expect(callArgs.content).toContain(
      "gather-context-and-clarify, parallel-review",
    );
    expect(callArgs.content).toContain(
      "**<mdHeading>[Extensions]</mdHeading>**",
    );
    expect(callArgs.content).toContain(
      "bash-approval.ts, my-extension, pi-object-package, pi-subagents, pi-web-access, welcome-message.ts",
    );
    expect(callArgs.content).not.toContain("some-skill.spec.ts");
    expect(callArgs.content).not.toContain("types.d.ts");
    expect(callArgs.content).not.toContain("empty-dir");
    expect(callArgs.content).not.toContain("node_modules");
    expect(callArgs.content).not.toContain("bash-approval-reload");
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

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;

    expect(callArgs.content).not.toContain("[Skills]");
    expect(callArgs.content).not.toContain("[Prompts]");
    expect(callArgs.content).not.toContain("[Extensions]");
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

    const callArgs = (pi.sendMessage as jest.Mock<any>).mock
      .calls[0]![0] as any;
    expect(callArgs.content).toContain("  abc1234\n  def5678");
  });
});
