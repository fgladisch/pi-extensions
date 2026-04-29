import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const TEXT_X = 0;
const TEXT_Y = 0;
const BOX_WIDTH = 1;
const BOX_HEIGHT = 1;
const SUCCESS_EXIT_CODE = 0;
const RECENT_COMMITS_COUNT = 5;

const PI_AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const EXTENSIONS_DIR = path.join(PI_AGENT_DIR, "extensions");
const SETTINGS_PATH = path.join(PI_AGENT_DIR, "settings.json");
const NPM_PACKAGE_PREFIX = "npm:";
const EXTENSION_DIR_BLOCKLIST = new Set([
  "node_modules",
  "tests",
  "coverage",
  "dist",
]);

type PackageConfig = {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
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

    const { hasUI, ui, cwd } = ctx;

    if (!hasUI) {
      return;
    }

    const { theme } = ui;
    const [pkgOutput, gitOutput, resourcesOutput] = await Promise.all([
      buildPackageInfo(cwd, theme),
      buildGitInfo(pi, cwd, theme),
      buildResourcesInfo(pi, theme),
    ]);

    const sections = [pkgOutput, gitOutput, resourcesOutput]
      .map((section) => section.trim())
      .filter((section) => section.length > 0);

    const output = sections.length > 0 ? `${sections.join("\n\n")}\n` : "";

    if (output.trim()) {
      pi.sendMessage({
        customType: "welcome",
        content: output.trim(),
        display: true,
      });
    }
  });
}

async function buildPackageInfo(cwd: string, theme: Theme): Promise<string> {
  let pkgOutput = "";
  const pkgPath = path.join(cwd, "package.json");

  try {
    const pkgRaw = await fs.readFile(pkgPath, "utf8");
    const { name, version, description } = JSON.parse(pkgRaw) as PackageConfig;

    if (name) {
      const versionString = version ? theme.fg("dim", ` v${version}`) : "";
      pkgOutput += `📦 ${theme.bold(theme.fg("mdHeading", name))}${versionString}\n`;
    }

    if (description) {
      pkgOutput += `${theme.italic(description)}\n`;
    }
  } catch {
    // ENOENT or invalid JSON is expected when no package.json is present
  }

  return pkgOutput;
}

async function buildGitInfo(
  pi: ExtensionAPI,
  cwd: string,
  theme: Theme,
): Promise<string> {
  let gitOutput = "";

  try {
    const [branchRes, diffRes, logRes] = await Promise.all([
      pi.exec("git", ["branch", "--show-current"], { cwd }),
      pi.exec("git", ["diff", "--shortstat"], { cwd }),
      pi.exec("git", ["log", "-n", String(RECENT_COMMITS_COUNT), "--oneline"], {
        cwd,
      }),
    ]);

    if (branchRes.code !== SUCCESS_EXIT_CODE) {
      return gitOutput;
    }

    const branch = branchRes.stdout.trim();

    if (branch) {
      gitOutput += `🌿 ${theme.fg("accent", branch)}\n`;
    }

    if (diffRes.code === SUCCESS_EXIT_CODE && diffRes.stdout.trim()) {
      gitOutput += `📊 ${theme.fg("warning", diffRes.stdout.trim())}\n`;
    } else {
      gitOutput += `📊 ${theme.fg("success", "Clean working directory")}\n`;
    }

    if (logRes.code === SUCCESS_EXIT_CODE && logRes.stdout.trim()) {
      gitOutput += "\n📜 Recent Commits:\n";
      gitOutput += logRes.stdout
        .trim()
        .split("\n")
        .map((line) => {
          const spaceIdx = line.indexOf(" ");

          if (spaceIdx === -1) {
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

async function buildResourcesInfo(
  pi: ExtensionAPI,
  theme: Theme,
): Promise<string> {
  const commands = pi.getCommands();

  const skills = commands
    .filter((command) => command.source === "skill")
    .map((command) => command.name.replace(/^skill:/, ""))
    .sort();

  const prompts = commands
    .filter((command) => command.source === "prompt")
    .map((command) => `/${command.name}`)
    .sort();

  const extensions = await discoverExtensions();

  const sections: string[] = [];

  if (skills.length > 0) {
    sections.push(formatResourceSection(theme, "Skills", skills));
  }

  if (prompts.length > 0) {
    sections.push(formatResourceSection(theme, "Prompts", prompts));
  }

  if (extensions.length > 0) {
    sections.push(formatResourceSection(theme, "Extensions", extensions));
  }

  return sections.join("\n\n");
}

function formatResourceSection(
  theme: Theme,
  label: string,
  items: readonly string[],
): string {
  const header = theme.bold(theme.fg("mdHeading", `[${label}]`));

  return `${header}\n  ${items.join(", ")}`;
}

async function discoverExtensions(): Promise<string[]> {
  const found = new Set<string>();

  try {
    const entries = await fs.readdir(EXTENSIONS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        EXTENSION_DIR_BLOCKLIST.has(entry.name)
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        const indexPath = path.join(EXTENSIONS_DIR, entry.name, "index.ts");

        try {
          await fs.access(indexPath);
          found.add(entry.name);
        } catch {
          // Directory without an index.ts is not an extension
        }

        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.endsWith(".spec.ts")
      ) {
        found.add(entry.name);
      }
    }
  } catch {
    // Extensions directory missing — nothing to discover locally
  }

  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as { packages?: unknown };

    if (Array.isArray(parsed.packages)) {
      for (const entry of parsed.packages) {
        if (typeof entry !== "string") {
          continue;
        }

        const name = entry.startsWith(NPM_PACKAGE_PREFIX)
          ? entry.slice(NPM_PACKAGE_PREFIX.length)
          : entry;

        if (name.length > 0) {
          found.add(name);
        }
      }
    }
  } catch {
    // Settings file missing or invalid JSON — fall back to local discovery only
  }

  return [...found].sort();
}
