import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as fs from "node:fs/promises";

jest.mock("@mariozechner/pi-coding-agent", () => ({}), { virtual: true });

jest.mock("node:fs/promises", () => ({
  readFile: jest.fn(),
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
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../welcome-message") as {
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
      content: expect.stringContaining("**<accent>test-app</accent>**"),
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
