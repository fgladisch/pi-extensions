# AGENTS.md

## Commands

```bash
# Setup
npm install                    # Install dev dependencies (run once after clone, after upgrades,
                               # or whenever VSCode stops resolving pi types).
                               # Also installs the husky pre-commit hook via the `prepare` script.

# Development
npm run typecheck              # tsc --noEmit
npm test                       # jest
npm run test:coverage          # jest with coverage report (HTML in coverage/)
npm run lint                   # eslint --fix over root .ts and tests/**/*.ts
npm run lint:file <path>       # eslint --fix on a single file
npm run format                 # prettier --write over **/*.{ts,js,cjs,md,json}
npm run format:file <path>     # prettier --write on a single file
npm run organize-imports       # organize-imports-cli over all tracked .ts files (via git ls-files)
npm run organize-imports:file <path>  # organize-imports-cli on a single file
```

There is no build step. Pi auto-discovers `*.ts` files at runtime; `tsc` is configured with `noEmit: true` purely for type-checking.

**Pre-commit hook** (`.husky/pre-commit`) runs `npx lint-staged && npm run typecheck && npm test`. For staged `.ts` files lint-staged runs `organize-imports-cli` (sorts/removes unused imports via the TS language service) and then `eslint --fix`; for staged `.{ts,js,cjs,md,json}` files it runs `prettier --write` (see `lint-staged` config in [package.json](package.json)).

## Project Layout

```
.
├── <name>.ts              # Single-file extensions (auto-discovered by pi)
├── <name>/index.ts        # Multi-file extensions (auto-discovered by pi)
├── tests/
│   └── <name>.spec.ts     # Jest specs — kept under tests/ so pi does not
│                          # try to load them as extensions at runtime
├── .husky/pre-commit      # lint-staged + typecheck + tests, installed by `npm install`
├── .eslintrc.js           # ESLint (legacy config) + @typescript-eslint + prettier integration
├── .eslintignore          # ESLint ignores (coverage, node_modules, JS configs)
├── .prettierrc            # Prettier config
├── .prettierignore        # Prettier ignores (coverage, node_modules, package-lock.json)
├── jest.config.cjs        # Jest config (ts-jest preset)
├── tsconfig.json          # Strict TS, ES2022, NodeNext, noUncheckedIndexedAccess
├── package.json           # Dev tooling only — must NOT have a `pi.extensions` field
└── README.md              # Workspace overview
```

> **Do not** add a `pi.extensions` field to `package.json` — that would override pi's auto-discovery and silently disable every extension that isn't listed there.

## Architecture

This repo is a personal workspace for pi (`@mariozechner/pi-coding-agent`) extensions. Each extension is a single TypeScript file (or `<name>/index.ts`) with a default export of `(pi: ExtensionAPI) => void`. Pi loads it on startup; the extension registers commands and event hooks against the `ExtensionAPI`.

**Extension hooks in use** (see [bash-approval.ts](bash-approval.ts) for the canonical example):

- `pi.registerCommand(name, { description, handler })` — adds a `/<name>` slash command
- `pi.on("tool_call", handler)` — intercepts tool calls; fall through (bare `return`) to allow, `{ block: true, reason }` to deny

**Extension contexts**:

- Interactive (TUI): `ctx.hasUI === true` and `ctx.ui.{select, notify, ...}` is available
- Non-interactive (e.g. `pi -p`): `ctx.hasUI === false`. Extensions must not call `ctx.ui.select` and should fall back to a safe default (typically: block)

**Config files** live under `~/.pi/agent/` (e.g. `~/.pi/agent/bash-approval.json`). Extensions own their config schema, load lazily, and provide a `<name>-reload` command to re-read from disk without restarting pi.

## Testing

Tests use Jest + ts-jest and live under `tests/<feature>.spec.ts`. They are kept out of the workspace root specifically so pi's auto-discovery doesn't try to load them as extensions at runtime (`testMatch` and the `tsconfig.json` `include` keep this boundary explicit — don't move spec files to the root).

**Conventions**:

- One spec file per extension, named to match.
- Mock `@mariozechner/pi-coding-agent` with `jest.mock(..., { virtual: true })` — it's ESM-only and Jest's CJS resolver can't load it. Stub only the helpers your extension imports (e.g. `isToolCallEventType`).
- Mock `node:fs` rather than touching the real filesystem.
- Provide a `setup()` helper that resets modules, applies fs mocks, calls the extension's default export against a fake `pi` API, and returns the recorded `tool_call` handler and registered commands. See [tests/bash-approval.spec.ts](tests/bash-approval.spec.ts) for the canonical pattern.
- Build a `makeCtx()` helper that returns `{ ctx, notify, select }` with `ctx.hasUI` togglable and `select` driven by an injected `pick` function — this keeps interactive tests readable.

**Coverage**: thresholds are 80% lines/branches/functions/statements. New extensions should be added to `collectCoverageFrom` in [jest.config.cjs](jest.config.cjs).

## Verification

Before considering a change done:

1. `npm run lint` — must pass cleanly (eslint + prettier integration).
2. `npm run typecheck` — must pass cleanly.
3. `npm test` — all specs green; new behavior must have a test.
4. For changes that affect runtime behavior, also exercise the extension in pi itself (e.g. trigger the hook) — type-checks and unit tests don't catch e.g. accidentally-removed `void` on a fire-and-forget `ctx.ui.notify`.

The pre-commit hook runs lint-staged + typecheck + tests, so most of this is enforced automatically on commit.

There is no build artifact to verify; pi loads the `.ts` files directly.

## Tech Stack

Node.js 20+ • TypeScript 5.6 (strict, ES2022, NodeNext) • Jest 29 + ts-jest • ESLint 8 + `@typescript-eslint` 8 • Prettier 3 • husky 9 + lint-staged 16 • `@mariozechner/pi-coding-agent` (ExtensionAPI host)

## Code Conventions

Reference this section when writing or modifying extensions.

### Imports

This project is flat — no path aliases. Use Node's built-in `node:` specifiers explicitly, and import pi types from `@mariozechner/pi-coding-agent`.

```typescript
// Good
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// Bad — bare-name node imports
import * as fs from "fs";
```

### Types

Prefer `type` over `interface`. Avoid `any` outside tests. Strict compiler options are enabled (target ES2022, `noUncheckedIndexedAccess`, `noImplicitOverride`).

```typescript
// Good
type BashApprovalConfig = {
  allowed: string[];
  splitChains: boolean;
};

// Bad
interface BashApprovalConfig {
  allowed: string[];
  splitChains: boolean;
}
```

### Enums

Prefer enums over string literal union types when there is a closed set of named values. Reuse existing enums from `@mariozechner/pi-coding-agent` where they exist instead of inventing parallel ones.

### Async

Only mark a function `async` when it actually awaits. Use `void` for fire-and-forget calls. Never leave floating promises.

```typescript
// Good
function fetchConfig() {
  return fs.promises.readFile(CONFIG_PATH, "utf8");
}

void ctx.ui.notify("done", "info");

// Bad
async function fetchConfig() {
  return fs.promises.readFile(CONFIG_PATH, "utf8");
}

ctx.ui.notify("done", "info"); // floating promise
```

### Naming

- Extensions: `<feature>.ts` at the workspace root (or `<feature>/index.ts` for multi-file extensions)
- Tests: `tests/<feature>.spec.ts` — exactly one spec file per extension
- Config files: `~/.pi/agent/<feature>.json`
- Slash commands: `<feature>-<verb>` (e.g. `bash-approval-reload`, `bash-approval-list`)
- Prefix unused parameters with `_` (e.g. `(_args, ctx) => …`)

Use descriptive variable names. Avoid single- or double-character names — prefer names that convey meaning.

```typescript
// Good
const trimmedCommand = command.trim();

for (let index = 0; index < command.length; index++) {
  /* … */
}

// Bad
const c = command.trim();

for (let i = 0; i < command.length; i++) {
  /* … */
}
```

### Type Assertions

Avoid double type assertions (`value as unknown as Type`). Fix the underlying type mismatch instead. When parsing untrusted JSON, type the result as `Partial<T>` and validate field-by-field rather than asserting through `as T`.

```typescript
// Good
const parsed = JSON.parse(raw) as Partial<BashApprovalConfig>;
const allowed = Array.isArray(parsed.allowed)
  ? parsed.allowed.filter((entry): entry is string => typeof entry === "string")
  : [];

// Bad
const parsed = JSON.parse(raw) as unknown as BashApprovalConfig;
```

### Booleans

Use `Boolean(value)` instead of `!!value` for type coercion.

### Null vs Undefined

Prefer `null` for "explicit absence" return values; `undefined` is reserved for "not yet provided" / optional. The pi `tool_call` hook contract treats fall-through (a bare `return` or no return at all) as "no opinion, proceed" — respect that contract; do not write `return undefined` explicitly.

```typescript
// Good — explicit absence
function suggestPrefixPattern(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const firstToken = tokens.at(0);

  if (!firstToken) {
    return null;
  }

  return `${firstToken}:*`;
}
```

### Object Spreading

Use spread operations instead of `Object.assign` for object copying and merging.

```typescript
// Good
const merged = { ...DEFAULT_CONFIG, ...userConfig };

// Bad
const merged = Object.assign({}, DEFAULT_CONFIG, userConfig);
```

### Destructuring

Prefer destructuring over repeatedly reading fields off the same object or copying them into local variables one-by-one. Destructure as close to first use as practical — typically at the top of the function — so the inputs a function actually depends on are explicit and call sites stay short.

Use default values in the destructuring pattern instead of post-hoc `??` / `=== true` checks when the field is optional with a known default.

```typescript
// Good
function execute(params: UserSelectInput, ctx: ExtensionContext) {
  const { question, options, allowCustom = false } = params;
  const { hasUI, ui } = ctx;

  if (!hasUI) {
    throw new Error("No UI available");
  }

  const choice = await ui.select(question, options);
  // …
}

// Bad — repeated property access, manual default coercion
function execute(params: UserSelectInput, ctx: ExtensionContext) {
  if (!ctx.hasUI) {
    throw new Error("No UI available");
  }

  const allowCustom = params.allowCustom === true;
  const choice = await ctx.ui.select(params.question, params.options);
  // …
}
```

Applies to function parameters, callback arguments, and any object you read multiple fields from. Use renaming (`const { foo: bar } = obj`) only when there is a real naming conflict; gratuitous renames hide the source field.

**Caveat — methods:** Do not destructure methods off their owning object (e.g. `const { select } = ctx.ui;`). It detaches `this` and trips `@typescript-eslint/unbound-method`. Destructure the owner instead and call through it (`const { ui } = ctx; ui.select(...)`).

### Nullish Coalescing

Prefer `??` over `||` for default values when `0`, `""`, or `false` are valid inputs.

```typescript
// Good
const splitChains = parsed.splitChains ?? true;

// Bad — `false` would incorrectly be replaced with `true`
const splitChains = parsed.splitChains || true;
```

### Constants

Define constants as uppercase variables in module scope, not inline within functions. Avoid magic numbers — give numeric literals a named constant that explains their meaning.

```typescript
// Good
const PREFIX_GLOB_SUFFIX_LENGTH = 2;

const prefix = pattern.slice(0, -PREFIX_GLOB_SUFFIX_LENGTH);

// Bad
const prefix = pattern.slice(0, -2);
```

### Array Access

Use `array.at()` instead of bracket notation for safer access. Combined with `noUncheckedIndexedAccess`, this surfaces possibly-`undefined` returns in the type system.

```typescript
// Good
const firstToken = tokens.at(0);
const lastChar = command.at(-1);

// Bad
const firstToken = tokens[0];
const lastChar = command[command.length - 1];
```

### Control Flow Braces

Always use braces `{}` for `if`, `else`, `for`, `while`, etc. — even for single-line bodies.

```typescript
// Good
if (value === "example") {
  return true;
}

// Bad
if (value === "example") return true;
```

### Spacing

Add blank lines between logical groups of statements within a function — not between every line, and not zero. The goal is breathing room around distinct steps.

```typescript
// Good
function loadConfig(): BashApprovalConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<BashApprovalConfig>;

  return {
    allowed: Array.isArray(parsed.allowed) ? parsed.allowed : [],
    splitChains: parsed.splitChains !== false,
  };
}
```

### Early Returns

Prefer early returns (guard clauses) to reduce nesting. Exit early for edge cases and "no-op" branches — this is especially important in `tool_call` hooks where most events should fall through with a bare `return;`.

```typescript
// Good
pi.on("tool_call", async (event, ctx) => {
  if (!isToolCallEventType("bash", event)) {
    return;
  }

  const command = String(event.input.command ?? "").trim();

  if (!command) {
    return;
  }

  // … main logic
});
```

### Error Handling

Use `unknown` in catch blocks and narrow with `instanceof` or type guards. Never use `any` for caught errors. For I/O against the user's filesystem (config files), inspect `NodeJS.ErrnoException.code` to distinguish ENOENT (recover by writing defaults) from other errors (fall back to in-memory defaults; do not crash pi).

```typescript
// Good
try {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return parse(raw);
} catch (error: unknown) {
  const code =
    error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;

  if (code === "ENOENT") {
    return { ...DEFAULT_CONFIG };
  }

  return { ...DEFAULT_CONFIG };
}

// Bad
try {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  return parse(raw);
} catch (error: any) {
  console.log(error.message);
  throw error;
}
```

User-facing errors should go through `ctx.ui.notify(message, "error")` — do not throw out of an extension hook; that crashes pi.

### Readonly

Use `readonly` for properties and parameters that should not be reassigned, especially on config types loaded once and shared.

### Template Literals

Prefer template literals over string concatenation.

```typescript
// Good
ctx.ui.notify(`Added rule: ${pattern}`, "info");

// Bad
ctx.ui.notify("Added rule: " + pattern, "info");
```

### Optional Chaining

Prefer optional chaining (`?.`) over manual null/undefined checks.

```typescript
// Good
const command = String(event.input?.command ?? "");

// Bad
const command = String(
  event.input && event.input.command ? event.input.command : "",
);
```

## Writing a New Extension

1. Create `<feature>.ts` at the workspace root (or `<feature>/index.ts` for multi-file extensions).
2. Default-export `(pi: ExtensionAPI) => void`.
3. If the extension reads user config, store it under `~/.pi/agent/<feature>.json` and create the file with sensible defaults on first run (ENOENT → write defaults).
4. Register slash commands via `pi.registerCommand` — at minimum a `<feature>-reload` if the extension is config-driven.
5. Register event hooks via `pi.on(...)`. Always early-return (bare `return;`) for events you don't handle.
6. Handle `ctx.hasUI === false` explicitly — pick a safe default (typically: block / no-op) for non-interactive runs.
7. Add `tests/<feature>.spec.ts` (see Testing).
8. Run `npm run typecheck && npm test` before committing.

**Skeleton**:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("my-feature-reload", {
    description: "Reload my-feature config from disk",
    // eslint-disable-next-line @typescript-eslint/require-await -- API requires Promise<void>
    handler: async (_args, ctx) => {
      // …
      ctx.ui.notify("Reloaded", "info");
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) {
      return;
    }

    if (!ctx.hasUI) {
      return { block: true, reason: "Blocked: no UI for approval" };
    }

    // …
  });
}
```
