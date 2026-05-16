import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  CommandDescriptor,
  CommandResults,
  EnabledWelcomeSections,
  PackageConfig,
  PackageSource,
  Theme,
  WelcomeExtensionAPI,
  WelcomeMessageConfig,
} from "./types";
import { WelcomeLogoColor, WelcomeSection } from "./types";

const SUCCESS_EXIT_CODE = 0;
const RECENT_COMMITS_COUNT = 5;
const DEFAULT_WELCOME_HEADER_WIDTH = 48;
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DEEP_BLUE: Rgb = [22, 83, 189];
const BLUE: Rgb = [48, 129, 247];
const SKY: Rgb = [93, 171, 255];
const ICE: Rgb = [151, 205, 255];
const DEEP_ORANGE: Rgb = [255, 92, 0];
const ORANGE: Rgb = [255, 132, 38];
const AMBER: Rgb = [255, 186, 73];
const PEACH: Rgb = [255, 214, 153];
const DEEP_GREEN: Rgb = [22, 163, 74];
const GREEN: Rgb = [34, 197, 94];
const MINT: Rgb = [134, 239, 172];
const ICE_GREEN: Rgb = [187, 247, 208];
const HEADER_GRADIENT_PALETTES: Record<WelcomeLogoColor, readonly Rgb[]> = {
  [WelcomeLogoColor.Blue]: [DEEP_BLUE, BLUE, SKY, ICE, SKY, BLUE],
  [WelcomeLogoColor.Orange]: [DEEP_ORANGE, ORANGE, AMBER, PEACH, AMBER, ORANGE],
  [WelcomeLogoColor.Green]: [DEEP_GREEN, GREEN, MINT, ICE_GREEN, MINT, GREEN],
};
const HEADER_GRADIENT_ROW_PHASE_STEP = 0.045;
const HEADER_MODEL_PHASE = 0.18;
const PI_LOGO_LINES = [
  "  ██████╗  ██╗ ",
  "  ██╔══██╗ ██║ ",
  "  ██████╔╝ ██║ ",
  "  ██╔═══╝  ██║ ",
  "  ██║      ██║ ",
  "  ╚═╝      ╚═╝ ",
];

const AGENT_DIR = getAgentDir();
const EXTENSIONS_DIR = path.join(AGENT_DIR, "extensions");
const SETTINGS_PATH = path.join(AGENT_DIR, "settings.json");
const NPM_PACKAGE_PREFIX = "npm:";
const EXTENSION_DIR_BLOCKLIST = new Set([
  "node_modules",
  "tests",
  "coverage",
  "dist",
]);
const KNOWN_WELCOME_SECTIONS = new Set<string>(Object.values(WelcomeSection));
const DEFAULT_ENABLED_WELCOME_SECTIONS: EnabledWelcomeSections = {
  nodePackage: true,
  git: true,
  piResources: true,
};
const DEFAULT_SHOW_LOGO = true;
const DEFAULT_SHOW_ON_NEW_SESSION = true;
const DEFAULT_LOGO_COLOR = WelcomeLogoColor.Orange;

type Rgb = readonly [number, number, number];

type WelcomeMessageSettings = {
  sections?: unknown;
  showLogo?: unknown;
  showOnNewSession?: unknown;
  logoColor?: unknown;
};

type GlobalSettings = {
  welcomeMessage?: WelcomeMessageSettings;
};

export function buildWelcomeHeader(
  modelId: string,
  logoColor: WelcomeLogoColor,
  width: number = DEFAULT_WELCOME_HEADER_WIDTH,
): string {
  const palette = HEADER_GRADIENT_PALETTES[logoColor];
  const logoLines = PI_LOGO_LINES.map((line, row) =>
    gradientText(
      centerLine(line, width),
      row * HEADER_GRADIENT_ROW_PHASE_STEP,
      palette,
    ),
  );
  const modelLine = `${BOLD}${gradientText(
    centerLine(modelId, width),
    HEADER_MODEL_PHASE,
    palette,
  )}${RESET}`;

  return ["", ...logoLines, modelLine, ""].join("\n");
}

export function formatWelcomeOutput(
  sections: readonly string[],
): string | null {
  const formattedSections = sections.filter(
    (section) => section.trim().length > 0,
  );

  if (formattedSections.length === 0) {
    return null;
  }

  return formattedSections.join("\n\n");
}

function mix(start: number, end: number, ratio: number): number {
  return Math.round(start + (end - start) * ratio);
}

function sampleGradient(position: number, palette: readonly Rgb[]): Rgb {
  const wrapped = ((position % 1) + 1) % 1;
  const scaled = wrapped * palette.length;
  const index = Math.floor(scaled);
  const nextIndex = (index + 1) % palette.length;
  const ratio = scaled - index;
  const start = palette.at(index) ?? DEEP_ORANGE;
  const end = palette.at(nextIndex) ?? DEEP_ORANGE;

  return [
    mix(start.at(0) ?? 0, end.at(0) ?? 0, ratio),
    mix(start.at(1) ?? 0, end.at(1) ?? 0, ratio),
    mix(start.at(2) ?? 0, end.at(2) ?? 0, ratio),
  ];
}

function foreground([red, green, blue]: Rgb, text: string): string {
  return `\x1b[38;2;${red};${green};${blue}m${text}${RESET}`;
}

function gradientText(
  text: string,
  phase: number,
  palette: readonly Rgb[],
): string {
  const chars = [...text];
  const span = Math.max(chars.length - 1, 1);

  return chars
    .map((char, index) => {
      if (char === " ") {
        return char;
      }

      return foreground(sampleGradient(index / span + phase, palette), char);
    })
    .join("");
}

function centerLine(text: string, width: number): string {
  const length = [...text].length;

  if (length >= width) {
    return text;
  }

  return `${" ".repeat(Math.floor((width - length) / 2))}${text}`;
}

function parseGlobalSettings(raw: string): Partial<GlobalSettings> {
  return JSON.parse(raw) as Partial<GlobalSettings>;
}

function getWelcomeMessageSettings(
  settings: Partial<GlobalSettings>,
): Partial<WelcomeMessageSettings> {
  const { welcomeMessage } = settings;

  if (!welcomeMessage || typeof welcomeMessage !== "object") {
    return {};
  }

  return welcomeMessage;
}

function isWelcomeSection(value: string): value is WelcomeSection {
  return KNOWN_WELCOME_SECTIONS.has(value);
}

function sanitizeEnabledWelcomeSections(
  sections: unknown,
): EnabledWelcomeSections {
  if (!Array.isArray(sections)) {
    return { ...DEFAULT_ENABLED_WELCOME_SECTIONS };
  }

  const configuredSections = new Set(
    sections
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry): entry is WelcomeSection => isWelcomeSection(entry)),
  );

  return {
    nodePackage: configuredSections.has(WelcomeSection.NodePackage),
    git: configuredSections.has(WelcomeSection.Git),
    piResources: configuredSections.has(WelcomeSection.PiResources),
  };
}

function sanitizeBooleanSetting(
  value: unknown,
  defaultValue: boolean,
): boolean {
  if (typeof value !== "boolean") {
    return defaultValue;
  }

  return value;
}

function sanitizeLogoColor(value: unknown): WelcomeLogoColor {
  if (typeof value !== "string") {
    return DEFAULT_LOGO_COLOR;
  }

  const trimmedValue = value.trim();

  if (isLogoColor(trimmedValue)) {
    return trimmedValue;
  }

  return DEFAULT_LOGO_COLOR;
}

function isLogoColor(value: string): value is WelcomeLogoColor {
  return Object.values(WelcomeLogoColor).includes(value as WelcomeLogoColor);
}

export async function loadWelcomeMessageConfig(): Promise<WelcomeMessageConfig> {
  try {
    const rawSettings = await fs.readFile(SETTINGS_PATH, "utf8");
    const parsedSettings = parseGlobalSettings(rawSettings);
    const welcomeMessageSettings = getWelcomeMessageSettings(parsedSettings);

    return {
      sections: sanitizeEnabledWelcomeSections(welcomeMessageSettings.sections),
      showLogo: sanitizeBooleanSetting(
        welcomeMessageSettings.showLogo,
        DEFAULT_SHOW_LOGO,
      ),
      showOnNewSession: sanitizeBooleanSetting(
        welcomeMessageSettings.showOnNewSession,
        DEFAULT_SHOW_ON_NEW_SESSION,
      ),
      logoColor: sanitizeLogoColor(welcomeMessageSettings.logoColor),
    };
  } catch {
    return {
      sections: { ...DEFAULT_ENABLED_WELCOME_SECTIONS },
      showLogo: DEFAULT_SHOW_LOGO,
      showOnNewSession: DEFAULT_SHOW_ON_NEW_SESSION,
      logoColor: DEFAULT_LOGO_COLOR,
    };
  }
}

export async function buildPackageInfo(
  cwd: string,
  theme: Theme,
): Promise<string> {
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
    return "";
  }
}

export async function buildGitInfo(
  pi: WelcomeExtensionAPI,
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

export async function buildResourcesInfo(
  pi: WelcomeExtensionAPI,
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
  const found = new Set([...localExtensions, ...packageExtensions]);

  return [...found].sort();
}

function collectExtensionEntryNames(
  entries: readonly Dirent[],
  predicate: (entry: Dirent) => boolean,
): string[] {
  return entries
    .filter(predicate)
    .filter((entry) => !shouldSkipExtensionEntry(entry.name))
    .map((entry) => entry.name);
}

async function discoverLocalExtensions(): Promise<string[]> {
  try {
    const entries = await fs.readdir(EXTENSIONS_DIR, { withFileTypes: true });
    const directoryNames = collectExtensionEntryNames(entries, (entry) =>
      entry.isDirectory(),
    );
    const fileNames = collectExtensionEntryNames(
      entries,
      isStandaloneExtensionFile,
    );

    const directoryExtensions =
      await discoverDirectoryExtensions(directoryNames);

    return [...fileNames, ...directoryExtensions];
  } catch {
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
