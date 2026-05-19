import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  DEFAULT_FOOTER_CONFIG,
  type FooterConfig,
  type FooterLineInput,
} from "./types";

const CONFIG_FILENAME = "footer.json";

export function getFooterConfigPath(): string {
  return path.join(getAgentDir(), CONFIG_FILENAME);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
      project: readString(icons.project, DEFAULT_FOOTER_CONFIG.icons.project),
      branch: readString(icons.branch, DEFAULT_FOOTER_CONFIG.icons.branch),
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
      project: readBoolean(
        segments.project,
        DEFAULT_FOOTER_CONFIG.segments.project,
      ),
      branch: readBoolean(
        segments.branch,
        DEFAULT_FOOTER_CONFIG.segments.branch,
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

export function formatFooterLine(input: FooterLineInput): string {
  const {
    config,
    modelId,
    thinkingLevel,
    projectName,
    branchName,
    extensionStatuses,
  } = input;
  const parts: string[] = [];

  if (config.segments.model) {
    const thinkingSuffix = thinkingLevel ? ` (${thinkingLevel})` : "";

    parts.push(`${config.icons.model} ${modelId}${thinkingSuffix}`);
  }

  if (config.segments.project) {
    parts.push(`${config.icons.project} ${projectName}`);
  }

  if (config.segments.branch) {
    parts.push(`${config.icons.branch} ${branchName}`);
  }

  parts.push(...extensionStatuses);

  return parts.join(` ${config.separator} `);
}
