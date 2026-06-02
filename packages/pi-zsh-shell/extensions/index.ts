import {
  createLocalBashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";
import { basename } from "node:path";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function getZshPath() {
  if (process.env.PI_ZSH_SHELL) {
    const envPath = process.env.PI_ZSH_SHELL;

    if (path.isAbsolute(envPath)) {
      return envPath;
    }
  }

  if (
    process.env.SHELL &&
    basename(process.env.SHELL) === "zsh" &&
    path.isAbsolute(process.env.SHELL)
  ) {
    return process.env.SHELL;
  }

  return "/bin/zsh";
}

function getFunctionsPath() {
  return path.join(os.homedir(), ".pi", "agent", "zsh-functions");
}

function doubleQuote(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export default function (pi: ExtensionAPI) {
  const local = createLocalBashOperations();

  pi.on("user_bash", () => {
    return {
      operations: {
        exec(command, cwd, options) {
          const functionsPath = doubleQuote(getFunctionsPath());
          const script = `if [ -r ${functionsPath} ]; then source ${functionsPath}; fi\n${command}`;
          const zshCommand = `exec ${shellQuote(getZshPath())} -fc ${shellQuote(script)}`;

          return local.exec(zshCommand, cwd, options);
        },
      },
    };
  });
}
