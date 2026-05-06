import {
  CustomEditor,
  type ExtensionUIContext,
} from "@mariozechner/pi-coding-agent";
import type { EditorComponent } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  InjectionStatus,
  type HistoryFile,
  type InjectionResult,
  type RuntimeState,
} from "./types";

export const DEFAULT_MAX_ENTRIES = 250;
const HISTORY_DIRECTORY_NAME = ".pi";
const HISTORY_FILE_NAME = "input-history.json";
const MIN_MAX_ENTRIES = 1;
const MAX_MAX_ENTRIES = 5000;

export function createDefaultRuntime(): RuntimeState {
  return {
    maxEntries: DEFAULT_MAX_ENTRIES,
    entries: [],
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

function sanitizeEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toHistoryFile(value: unknown): HistoryFile {
  const parsed = value as Partial<HistoryFile>;

  return {
    maxEntries: sanitizeMaxEntries(parsed.maxEntries),
    entries: sanitizeEntries(parsed.entries),
  };
}

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function persistHistory(filePath: string, history: HistoryFile): void {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

export function persistRuntime(cwd: string, runtime: RuntimeState): void {
  persistHistory(getHistoryFilePath(cwd), {
    maxEntries: runtime.maxEntries,
    entries: runtime.entries,
  });
}

export function loadRuntime(cwd: string): RuntimeState {
  const filePath = getHistoryFilePath(cwd);

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = toHistoryFile(JSON.parse(raw));

    return {
      maxEntries: parsed.maxEntries,
      entries: parsed.entries.slice(0, parsed.maxEntries),
      lastInjection: null,
    };
  } catch (error: unknown) {
    const code =
      error instanceof Error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    const defaults = createDefaultRuntime();

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

function isHistoryEditor(value: unknown): value is HistoryEditor {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as HistoryEditor).addToHistory === "function";
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

export function buildStatusMessage(cwd: string, runtime: RuntimeState): string {
  const injection = runtime.lastInjection
    ? `${runtime.lastInjection.status}: ${runtime.lastInjection.message}`
    : "not-run";

  return [
    "persistent-history status",
    `cwd: ${cwd}`,
    `file: ${getHistoryFilePath(cwd)}`,
    `entries: ${runtime.entries.length}`,
    `maxEntries: ${runtime.maxEntries}`,
    `injection: ${injection}`,
  ].join("\n");
}
