import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { DEFAULT_FOOTER_CONFIG } from "./defaults";
import type { FooterConfig, FooterLineInput } from "./models";

const CONFIG_FILENAME = "footer.json";
const FOOTER_END_CAP = "";
const ANSI_SEQUENCE_PATTERN = /^\x1b\[([0-9;]*)m/;

export function getFooterConfigPath(): string {
  return path.join(getAgentDir(), CONFIG_FILENAME);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function convertBackgroundAnsiToForegroundAnsi(
  sequence: string,
): string | null {
  const match = sequence.match(ANSI_SEQUENCE_PATTERN);
  const codes = match?.at(1);

  if (!codes) {
    return null;
  }

  if (codes.startsWith("48;")) {
    return `\x1b[38;${codes.slice(3)}m`;
  }

  const code = Number(codes);

  if (!Number.isInteger(code) || code < 40 || code > 47) {
    return null;
  }

  return `\x1b[${code - 10}m`;
}

function applyBackground(text: string, backgroundAnsi: string): string {
  return `${backgroundAnsi}${text.replaceAll("\x1b[0m", `\x1b[0m${backgroundAnsi}`)}\x1b[49m`;
}

function formatFooterEndCap(theme: FooterLineInput["theme"]): string {
  const capForeground = convertBackgroundAnsiToForegroundAnsi(
    theme.getBgAnsi("customMessageBg"),
  );

  return capForeground
    ? `${capForeground}${FOOTER_END_CAP}\x1b[39m`
    : theme.fg("accent", FOOTER_END_CAP);
}

function formatFooterBody(
  line: string,
  theme: FooterLineInput["theme"],
): string {
  return applyBackground(line, theme.getBgAnsi("customMessageBg"));
}

function parseConfig(raw: string): FooterConfig {
  const parsed = JSON.parse(raw) as Partial<FooterConfig>;
  const icons =
    parsed.icons && typeof parsed.icons === "object"
      ? parsed.icons
      : ({} as Partial<FooterConfig["icons"]>);
  const promptInput =
    parsed.promptInput && typeof parsed.promptInput === "object"
      ? parsed.promptInput
      : ({} as Partial<FooterConfig["promptInput"]>);
  const segments =
    parsed.segments && typeof parsed.segments === "object"
      ? parsed.segments
      : ({} as Partial<FooterConfig["segments"]>);

  return {
    icons: {
      model: readString(icons.model, DEFAULT_FOOTER_CONFIG.icons.model),
      context: readString(icons.context, DEFAULT_FOOTER_CONFIG.icons.context),
      project: readString(icons.project, DEFAULT_FOOTER_CONFIG.icons.project),
      branch: readString(icons.branch, DEFAULT_FOOTER_CONFIG.icons.branch),
      provider: readString(
        icons.provider,
        DEFAULT_FOOTER_CONFIG.icons.provider,
      ),
    },
    promptInput: {
      prefix: readString(
        promptInput.prefix,
        DEFAULT_FOOTER_CONFIG.promptInput.prefix,
      ),
    },
    separator: readString(parsed.separator, DEFAULT_FOOTER_CONFIG.separator),
    segments: {
      model: readBoolean(segments.model, DEFAULT_FOOTER_CONFIG.segments.model),
      context: readBoolean(
        segments.context,
        DEFAULT_FOOTER_CONFIG.segments.context,
      ),
      project: readBoolean(
        segments.project,
        DEFAULT_FOOTER_CONFIG.segments.project,
      ),
      branch: readBoolean(
        segments.branch,
        DEFAULT_FOOTER_CONFIG.segments.branch,
      ),
      provider: readBoolean(
        segments.provider,
        DEFAULT_FOOTER_CONFIG.segments.provider,
      ),
    },
  };
}

export async function loadFooterConfig(): Promise<FooterConfig> {
  try {
    const raw = await fs.readFile(getFooterConfigPath(), "utf8");

    return parseConfig(raw);
  } catch {
    return { ...DEFAULT_FOOTER_CONFIG };
  }
}

export function formatFooterLine({
  config,
  modelId,
  providerName,
  thinkingLevel,
  contextUsagePercent,
  projectName,
  branchName,
  extensionStatuses,
  theme,
}: FooterLineInput): string {
  const parts: string[] = [];

  if (config.segments.provider && providerName !== null) {
    parts.push(`${config.icons.provider} ${providerName}`);
  }

  if (config.segments.model && modelId !== null) {
    const thinkingSuffix = thinkingLevel ? ` (${thinkingLevel})` : "";

    parts.push(`${config.icons.model} ${modelId}${thinkingSuffix}`);
  }

  if (config.segments.context && contextUsagePercent !== null) {
    parts.push(`${config.icons.context} ${Math.round(contextUsagePercent)}%`);
  }

  if (config.segments.project) {
    parts.push(`${config.icons.project} ${projectName}`);
  }

  if (config.segments.branch && branchName !== null) {
    parts.push(`${config.icons.branch} ${branchName}`);
  }

  parts.push(...extensionStatuses);

  const textParts = parts.map((part) => theme.fg("text", part));
  const line = ` ${textParts.join(` ${theme.fg("dim", config.separator)} `)} `;

  return `${formatFooterBody(line, theme)}${formatFooterEndCap(theme)}`;
}
