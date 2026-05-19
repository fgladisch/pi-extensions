import {
  CustomEditor,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { EditorComponent } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  InjectionStatus,
  type HistoryLine,
  type InjectionResult,
  type RuntimeState,
} from "./types";

export const DEFAULT_MAX_ENTRIES = 250;
const HISTORY_DIRECTORY_NAME = ".pi";
const HISTORY_FILE_NAME = "input-history.jsonl";
const HISTORY_FILE_DISPLAY_PATH = `${HISTORY_DIRECTORY_NAME}/${HISTORY_FILE_NAME}`;
const GLOBAL_SETTINGS_PATH = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "settings.json",
);
const MIN_MAX_ENTRIES = 1;
const MAX_MAX_ENTRIES = 5000;

type PersistentHistorySettings = {
  maxEntries?: unknown;
  showStartupMessage?: unknown;
};

type GlobalPersistentHistoryConfig = {
  maxEntries: number;
  showStartupMessage: boolean;
};

type GlobalSettings = {
  persistentHistory?: PersistentHistorySettings;
};

export function createDefaultRuntime(): RuntimeState {
  return {
    maxEntries: DEFAULT_MAX_ENTRIES,
    showStartupMessage: true,
    entries: [],
    loadedSinceTimestampMs: null,
    lastInjection: null,
  };
}

export function getHistoryFilePath(cwd: string): string {
  return path.join(cwd, HISTORY_DIRECTORY_NAME, HISTORY_FILE_NAME);
}

function sanitizeMaxEntries(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_ENTRIES;
  }

  const rounded = Math.floor(value);

  return Math.min(MAX_MAX_ENTRIES, Math.max(MIN_MAX_ENTRIES, rounded));
}

function sanitizeEntryText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function sanitizeUnixTimestampMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.floor(value);

  if (rounded < 0) {
    return null;
  }

  return rounded;
}

function getUnixTimestampMs(): number {
  return Date.now();
}

type ParsedHistoryLine = {
  text: string;
  timestampMs: number | null;
};

function parseHistoryLine(rawLine: string): ParsedHistoryLine | null {
  try {
    const parsed = JSON.parse(rawLine) as HistoryLine | string;

    if (typeof parsed === "string") {
      const text = sanitizeEntryText(parsed);

      if (!text) {
        return null;
      }

      return {
        text,
        timestampMs: null,
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const text = sanitizeEntryText(parsed.text);

    if (!text) {
      return null;
    }

    return {
      text,
      timestampMs: sanitizeUnixTimestampMs(parsed.timestamp),
    };
  } catch {
    return null;
  }
}

function parseHistoryJsonl(raw: string): ParsedHistoryLine[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseHistoryLine(line))
    .filter((line): line is ParsedHistoryLine => line !== null);
}

function getLoadedSinceTimestampMs(
  lines: readonly ParsedHistoryLine[],
): number | null {
  const timestamps = lines
    .map((line) => line.timestampMs)
    .filter((timestamp): timestamp is number => timestamp !== null);

  if (timestamps.length === 0) {
    return null;
  }

  return Math.min(...timestamps);
}

function sanitizeShowStartupMessage(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return true;
}

function getPersistentHistorySettings(
  settings: Partial<GlobalSettings>,
): Partial<PersistentHistorySettings> {
  const { persistentHistory } = settings;

  if (!persistentHistory || typeof persistentHistory !== "object") {
    return {};
  }

  return persistentHistory;
}

function loadGlobalPersistentHistoryConfig(): GlobalPersistentHistoryConfig {
  try {
    const rawSettings = fs.readFileSync(GLOBAL_SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(rawSettings) as Partial<GlobalSettings>;
    const persistentHistorySettings = getPersistentHistorySettings(parsed);

    return {
      maxEntries: sanitizeMaxEntries(persistentHistorySettings.maxEntries),
      showStartupMessage: sanitizeShowStartupMessage(
        persistentHistorySettings.showStartupMessage,
      ),
    };
  } catch {
    return {
      maxEntries: DEFAULT_MAX_ENTRIES,
      showStartupMessage: true,
    };
  }
}

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function persistHistory(
  filePath: string,
  entries: readonly string[],
): void {
  ensureDirectory(filePath);

  const lines = entries.map((entry) => {
    const historyLine: HistoryLine = {
      text: entry,
      timestamp: getUnixTimestampMs(),
    };

    return JSON.stringify(historyLine);
  });

  const content = lines.length > 0 ? `${lines.join("\n")}\n` : "";

  fs.writeFileSync(filePath, content, "utf8");
}

export function persistRuntime(cwd: string, runtime: RuntimeState): void {
  persistHistory(getHistoryFilePath(cwd), runtime.entries);
}

export function loadRuntime(cwd: string): RuntimeState {
  const filePath = getHistoryFilePath(cwd);
  const globalConfig = loadGlobalPersistentHistoryConfig();
  const { maxEntries, showStartupMessage } = globalConfig;

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsedLines = parseHistoryJsonl(raw);
    const loadedLines = parsedLines.slice(0, maxEntries);

    return {
      maxEntries,
      showStartupMessage,
      entries: loadedLines.map((line) => line.text),
      loadedSinceTimestampMs: getLoadedSinceTimestampMs(loadedLines),
      lastInjection: null,
    };
  } catch (error: unknown) {
    const code =
      error instanceof Error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    const defaults = {
      ...createDefaultRuntime(),
      maxEntries,
      showStartupMessage,
    };

    if (code === "ENOENT") {
      try {
        persistRuntime(cwd, defaults);
      } catch {
        // Ignore recovery write failures and continue with in-memory defaults.
      }
    }

    return defaults;
  }
}

export function recordHistoryEntry(
  entries: readonly string[],
  text: string,
  maxEntries: number,
): string[] {
  const trimmed = text.trim();

  if (!trimmed) {
    return [...entries];
  }

  if (entries.at(0) === trimmed) {
    return [...entries];
  }

  return [trimmed, ...entries].slice(0, maxEntries);
}

type FocusedTui = {
  focusedComponent?: unknown;
};

type HistoryEditor = EditorComponent & {
  addToHistory?: (text: string) => void;
};

type CustomEditorLike = HistoryEditor & {
  actionHandlers?: unknown;
  onExtensionShortcut?: (data: string) => boolean | undefined;
};

function isHistoryEditor(value: unknown): value is HistoryEditor {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as HistoryEditor).addToHistory === "function";
}

function preventSelfReferentialShortcutFallback(editor: HistoryEditor): void {
  const customEditor = editor as CustomEditorLike;

  if (
    customEditor.actionHandlers instanceof Map &&
    !customEditor.onExtensionShortcut
  ) {
    customEditor.onExtensionShortcut = () => false;
  }
}

export function injectHistoryIntoFocusedEditor(
  ui: ExtensionUIContext,
  entries: readonly string[],
): InjectionResult {
  let result: InjectionResult = {
    status: InjectionStatus.Unavailable,
    message: "Focused editor not available",
  };

  ui.setEditorComponent((tui, theme, keybindings) => {
    const focusedComponent = (tui as unknown as FocusedTui).focusedComponent;

    if (!isHistoryEditor(focusedComponent)) {
      result = {
        status: InjectionStatus.Unavailable,
        message: "Focused editor has no addToHistory()",
      };

      if (focusedComponent && typeof focusedComponent === "object") {
        return focusedComponent as EditorComponent;
      }

      return new CustomEditor(tui, theme, keybindings);
    }

    try {
      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries.at(index);

        if (entry) {
          focusedComponent.addToHistory?.(entry);
        }
      }

      result = {
        status: InjectionStatus.Applied,
        message: `Injected ${entries.length} entries`,
      };

      preventSelfReferentialShortcutFallback(focusedComponent);

      return focusedComponent;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      result = {
        status: InjectionStatus.Failed,
        message: `Injection failed: ${message}`,
      };

      return new CustomEditor(tui, theme, keybindings);
    }
  });

  return result;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatTimestampForStartupMessage(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());

  return `${year}/${month}/${day}, ${hours}:${minutes}`;
}

function getLoadedSinceTimestamp(runtime: RuntimeState): number {
  return runtime.loadedSinceTimestampMs ?? getUnixTimestampMs();
}

export function buildLoadedHistoryMessage(runtime: RuntimeState): string {
  const sinceTimestampMs = getLoadedSinceTimestamp(runtime);
  const since = formatTimestampForStartupMessage(sinceTimestampMs);

  return [
    "[Persistent History]",
    `  Loaded ${runtime.entries.length} entries (max: ${runtime.maxEntries})`,
    `  Since: ${since}`,
    `  From file: ${HISTORY_FILE_DISPLAY_PATH}`,
  ].join("\n");
}

export function buildStatusMessage(runtime: RuntimeState): string {
  return buildLoadedHistoryMessage(runtime);
}
