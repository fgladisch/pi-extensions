import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import * as os from "node:os";
import * as path from "node:path";

const exec = jest.fn<(...args: unknown[]) => unknown>();

jest.mock(
  "@earendil-works/pi-coding-agent",
  () => ({
    createLocalBashOperations: () => ({ exec }),
  }),
  { virtual: true },
);

type UserBashHandler = () => {
  readonly operations: {
    readonly exec: (
      command: string,
      cwd: string,
      options: Record<string, unknown>,
    ) => unknown;
  };
};

type Recorded = {
  userBashHandler: UserBashHandler | null;
};

function makeFakePi(recorded: Recorded) {
  return {
    on: jest.fn((eventName: string, handler: UserBashHandler) => {
      if (eventName === "user_bash") {
        recorded.userBashHandler = handler;
      }
    }),
  };
}

function setup() {
  jest.resetModules();
  exec.mockReset();

  const recorded: Recorded = { userBashHandler: null };
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- Jest runs as CJS
  const extension = require("../extensions") as {
    default: (pi: ReturnType<typeof makeFakePi>) => void;
  };
  extension.default(makeFakePi(recorded));

  if (!recorded.userBashHandler) {
    throw new Error("user_bash handler was not registered");
  }

  return { handler: recorded.userBashHandler };
}

describe("pi-zsh-shell", () => {
  const originalShell = process.env.SHELL;
  const originalPiZshShell = process.env.PI_ZSH_SHELL;

  beforeEach(() => {
    delete process.env.PI_ZSH_SHELL;
    delete process.env.SHELL;
  });

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalShell;
    }

    if (originalPiZshShell === undefined) {
      delete process.env.PI_ZSH_SHELL;
    } else {
      process.env.PI_ZSH_SHELL = originalPiZshShell;
    }
  });

  it("runs user bash commands through zsh and sources Pi zsh functions first", () => {
    const { handler } = setup();
    const operations = handler().operations;
    const options = { timeout: 1000 };

    operations.exec("gst && ll", "/repo", options);

    const functionsPath = path.join(
      os.homedir(),
      ".pi",
      "agent",
      "zsh-functions",
    );
    const zshScript = `if [ -r "${functionsPath}" ]; then source "${functionsPath}"; fi\ngst && ll`;
    expect(exec).toHaveBeenCalledWith(
      `exec '/bin/zsh' -fc '${zshScript}'`,
      "/repo",
      options,
    );
  });
});
