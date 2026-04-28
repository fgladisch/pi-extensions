import type { ExtensionAPI, ThemeColor } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const TEXT_X = 0;
const TEXT_Y = 0;
const BOX_WIDTH = 1;
const BOX_HEIGHT = 1;
const SUCCESS_EXIT_CODE = 0;
const NOT_FOUND_INDEX = -1;
const RECENT_COMMITS_COUNT = "5";

type PackageConfig = {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
};

type ThemeHelper = {
  readonly bold: (text: string) => string;
  readonly italic: (text: string) => string;
  readonly fg: (color: ThemeColor, text: string) => string;
};

export default function (pi: ExtensionAPI): void {
  pi.registerMessageRenderer("welcome", (message, _options, theme) => {
    const text = new Text(
      typeof message.content === "string" ? message.content : "Welcome",
      TEXT_X,
      TEXT_Y,
    );
    const box = new Box(BOX_WIDTH, BOX_HEIGHT, (t) =>
      theme.bg("customMessageBg", t),
    );

    box.addChild(text);

    return box;
  });

  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup") {
      return;
    }

    if (!ctx.hasUI) {
      return;
    }

    const themeHelper = ctx.ui.theme as ThemeHelper;
    let output = "";

    const pkgOutput = await buildPackageInfo(ctx.cwd, themeHelper);

    if (pkgOutput) {
      output += `${pkgOutput.trim()}\n`;
    }

    const gitOutput = await buildGitInfo(pi, ctx.cwd, themeHelper);

    if (gitOutput) {
      if (output) {
        output += "\n";
      }

      output += `${gitOutput.trim()}\n`;
    }

    if (output.trim()) {
      pi.sendMessage({
        customType: "welcome",
        content: output.trim(),
        display: true,
      });
    }
  });
}

async function buildPackageInfo(
  cwd: string,
  theme: ThemeHelper,
): Promise<string> {
  let pkgOutput = "";
  const pkgPath = path.join(cwd, "package.json");

  try {
    const pkgRaw = await fs.readFile(pkgPath, "utf8");
    const pkg = JSON.parse(pkgRaw) as PackageConfig;

    if (pkg.name) {
      const versionString = pkg.version
        ? theme.fg("dim", ` v${pkg.version}`)
        : "";
      pkgOutput += `📦 ${theme.bold(theme.fg("accent", pkg.name))}${versionString}\n`;
    }

    if (pkg.description) {
      pkgOutput += `${theme.italic(pkg.description)}\n`;
    }
  } catch {
    // ENOENT or invalid JSON is expected when no package.json is present
  }

  return pkgOutput;
}

async function buildGitInfo(
  pi: ExtensionAPI,
  cwd: string,
  theme: ThemeHelper,
): Promise<string> {
  let gitOutput = "";

  try {
    const branchResult = await pi.exec("git", ["branch", "--show-current"], {
      cwd,
    });

    if (branchResult.code !== SUCCESS_EXIT_CODE) {
      return gitOutput;
    }

    const branch = branchResult.stdout.trim();

    if (branch) {
      gitOutput += `🌿 ${theme.fg("accent", branch)}\n`;
    }

    const diffResult = await pi.exec("git", ["diff", "--shortstat"], { cwd });

    if (diffResult.code === SUCCESS_EXIT_CODE && diffResult.stdout.trim()) {
      gitOutput += `📊 ${theme.fg("warning", diffResult.stdout.trim())}\n`;
    } else {
      gitOutput += `📊 ${theme.fg("success", "Clean working directory")}\n`;
    }

    const logResult = await pi.exec(
      "git",
      ["log", "-n", RECENT_COMMITS_COUNT, "--oneline"],
      { cwd },
    );

    if (logResult.code === SUCCESS_EXIT_CODE && logResult.stdout.trim()) {
      gitOutput += "\n📜 Recent Commits:\n";
      gitOutput += logResult.stdout
        .trim()
        .split("\n")
        .map((line) => {
          const spaceIdx = line.indexOf(" ");

          if (spaceIdx === NOT_FOUND_INDEX) {
            return `  ${line}`;
          }

          const commitHash = line.slice(0, spaceIdx);
          const commitMessage = line.slice(spaceIdx + 1);

          return `  ${theme.fg("dim", commitHash)} ${commitMessage}`;
        })
        .join("\n");
    }
  } catch {
    // Missing git or not a git repository
  }

  return gitOutput;
}
