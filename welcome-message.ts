import {
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type PackageSource,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const SUCCESS_EXIT_CODE = 0;
const RECENT_COMMITS_COUNT = 5;

const EXTENSIONS_DIR = path.join(getAgentDir(), "extensions");
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

type CommandDescriptor = {
  readonly name: string;
  readonly source: string;
};

type CommandResults = {
  readonly code: number;
  readonly stdout: string;
};

export default function (pi: ExtensionAPI): void {
  registerWelcomeRenderer(pi);

  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup") {
      return;
    }

    const { hasUI, ui, cwd } = ctx;

    if (!hasUI) {
      return;
    }

    const { theme } = ui;
    const [packageInfo, gitInfo, resourcesInfo] = await Promise.all([
      buildPackageInfo(cwd, theme),
      buildGitInfo(pi, cwd, theme),
      buildResourcesInfo(pi, cwd, theme),
    ]);

    const output = formatWelcomeOutput([packageInfo, gitInfo, resourcesInfo]);

    if (output === null) {
      return;
    }

    pi.sendMessage({
      customType: "welcome",
      content: output,
      display: true,
    });
  });
}

function registerWelcomeRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer("welcome", (message, _options, theme) => {
    const text = new Text(
      typeof message.content === "string" ? message.content : "Welcome",
      0,
      0,
    );
    const box = new Box(1, 1, (token) => theme.bg("customMessageBg", token));

    box.addChild(text);

    return box;
  });
}

function formatWelcomeOutput(sections: readonly string[]): string | null {
  const formattedSections = sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0);

  if (formattedSections.length === 0) {
    return null;
  }

  return formattedSections.join("\n\n");
}

async function buildPackageInfo(cwd: string, theme: Theme): Promise<string> {
  const pkgPath = path.join(cwd, "package.json");

  try {
    const pkgRaw = await fs.readFile(pkgPath, "utf8");
    const { name, version, description } = JSON.parse(pkgRaw) as PackageConfig;

    const lines: string[] = [];

    if (name) {
      const versionString = version ? theme.fg("dim", ` v${version}`) : "";
      lines.push(
        `📦 ${theme.bold(theme.fg("mdHeading", name))}${versionString}`,
      );
    }

    if (description) {
      lines.push(theme.italic(description));
    }

    return lines.join("\n");
  } catch {
    // ENOENT or invalid JSON is expected when no package.json is present
    return "";
  }
}

async function buildGitInfo(
  pi: ExtensionAPI,
  cwd: string,
  theme: Theme,
): Promise<string> {
  try {
    const [branchResult, diffResult, logResult] = await Promise.all([
      pi.exec("git", ["branch", "--show-current"], { cwd }),
      pi.exec("git", ["diff", "--shortstat"], { cwd }),
      pi.exec("git", ["log", "-n", String(RECENT_COMMITS_COUNT), "--oneline"], {
        cwd,
      }),
    ]);

    if (!isSuccess(branchResult)) {
      return "";
    }

    const statusLines: string[] = [];
    const branch = branchResult.stdout.trim();

    if (branch.length > 0) {
      statusLines.push(`🌿 ${theme.fg("accent", branch)}`);
    }

    statusLines.push(formatDiffLine(theme, diffResult));

    let output = statusLines.join("\n");

    const commitSection = formatCommitSection(theme, logResult);

    if (commitSection.length > 0) {
      output = `${output}\n\n${commitSection}`;
    }

    return output;
  } catch {
    // Missing git or not a git repository
    return "";
  }
}

function isSuccess(result: CommandResults): boolean {
  return result.code === SUCCESS_EXIT_CODE;
}

function formatDiffLine(theme: Theme, diffResult: CommandResults): string {
  const shortStat = diffResult.stdout.trim();

  if (isSuccess(diffResult) && shortStat.length > 0) {
    return `📊 ${theme.fg("warning", shortStat)}`;
  }

  return `📊 ${theme.fg("success", "Clean working directory")}`;
}

function formatCommitSection(theme: Theme, logResult: CommandResults): string {
  if (!isSuccess(logResult)) {
    return "";
  }

  const lines = logResult.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => `  ${formatCommitLine(theme, line)}`);

  if (lines.length === 0) {
    return "";
  }

  return `📜 Recent Commits:\n${lines.join("\n")}`;
}

function formatCommitLine(theme: Theme, line: string): string {
  const firstSpaceIndex = line.indexOf(" ");

  if (firstSpaceIndex === -1) {
    return line;
  }

  const commitHash = line.slice(0, firstSpaceIndex);
  const commitMessage = line.slice(firstSpaceIndex + 1);

  return `${theme.fg("dim", commitHash)} ${commitMessage}`;
}

async function buildResourcesInfo(
  pi: ExtensionAPI,
  cwd: string,
  theme: Theme,
): Promise<string> {
  const { skills, prompts } = collectCommandResources(
    pi.getCommands() as CommandDescriptor[],
  );
  const extensions = await discoverExtensions(cwd);

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

function collectCommandResources(commands: readonly CommandDescriptor[]): {
  skills: string[];
  prompts: string[];
} {
  const skills: string[] = [];
  const prompts: string[] = [];

  for (const command of commands) {
    const { source, name } = command;

    if (source === "skill") {
      skills.push(name.replace(/^skill:/, ""));
      continue;
    }

    if (source === "prompt") {
      prompts.push(name);
    }
  }

  skills.sort();
  prompts.sort();

  return { skills, prompts };
}

function formatResourceSection(
  theme: Theme,
  label: string,
  items: readonly string[],
): string {
  const header = theme.bold(theme.fg("mdHeading", `[${label}]`));

  return `${header}\n  ${items.join(", ")}`;
}

async function discoverExtensions(cwd: string): Promise<string[]> {
  const localExtensions = await discoverLocalExtensions();
  const packageExtensions = discoverConfiguredPackageExtensions(cwd);

  const found = new Set<string>();

  for (const extensionName of localExtensions) {
    found.add(extensionName);
  }

  for (const extensionName of packageExtensions) {
    found.add(extensionName);
  }

  return [...found].sort();
}

async function discoverLocalExtensions(): Promise<string[]> {
  try {
    const entries = await fs.readdir(EXTENSIONS_DIR, { withFileTypes: true });

    const directoryNames = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !shouldSkipExtensionEntry(entry.name))
      .map((entry) => entry.name);

    const fileNames = entries
      .filter(isStandaloneExtensionFile)
      .filter((entry) => !shouldSkipExtensionEntry(entry.name))
      .map((entry) => entry.name);

    const directoryExtensions =
      await discoverDirectoryExtensions(directoryNames);

    return [...fileNames, ...directoryExtensions];
  } catch {
    // Extensions directory missing — nothing to discover locally
    return [];
  }
}

function shouldSkipExtensionEntry(name: string): boolean {
  return name.startsWith(".") || EXTENSION_DIR_BLOCKLIST.has(name);
}

function isStandaloneExtensionFile(entry: Dirent): boolean {
  return (
    entry.isFile() &&
    entry.name.endsWith(".ts") &&
    !entry.name.endsWith(".d.ts") &&
    !entry.name.endsWith(".spec.ts")
  );
}

async function discoverDirectoryExtensions(
  directoryNames: readonly string[],
): Promise<string[]> {
  const extensionFlags = await Promise.all(
    directoryNames.map(async (directoryName) => {
      const hasIndex = await hasExtensionIndex(directoryName);

      return { directoryName, hasIndex };
    }),
  );

  return extensionFlags
    .filter((entry) => entry.hasIndex)
    .map((entry) => entry.directoryName);
}

async function hasExtensionIndex(directoryName: string): Promise<boolean> {
  const indexPath = path.join(EXTENSIONS_DIR, directoryName, "index.ts");

  try {
    await fs.access(indexPath);
    return true;
  } catch {
    return false;
  }
}

function discoverConfiguredPackageExtensions(cwd: string): string[] {
  try {
    const packages = SettingsManager.create(cwd).getPackages();

    return packages
      .map(getPackageExtensionName)
      .filter((entry): entry is string => entry !== null);
  } catch {
    // Settings load can fail (missing/invalid file) — local discovery still works
    return [];
  }
}

function getPackageExtensionName(packageSource: PackageSource): string | null {
  const source =
    typeof packageSource === "string" ? packageSource : packageSource.source;
  const trimmedSource = source.trim();

  if (trimmedSource.length === 0) {
    return null;
  }

  const normalizedSource = trimmedSource.startsWith(NPM_PACKAGE_PREFIX)
    ? trimmedSource.slice(NPM_PACKAGE_PREFIX.length)
    : trimmedSource;

  return normalizedSource.length > 0 ? normalizedSource : null;
}
