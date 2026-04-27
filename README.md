# pi extensions workspace

Personal pi extensions. Pi auto-discovers `*.ts` files in this directory at
runtime; the `package.json`, `tsconfig.json`, and `node_modules/` here exist
solely to give VSCode/tsserver type resolution and to host dev tooling.

> Do **not** add a `pi.extensions` field to `package.json` — that would
> override pi's auto-discovery.

## Setup

Install dev dependencies:

```sh
npm install
```

Run this:

- once after cloning
- after upgrading dependencies
- whenever VSCode stops resolving pi types

Running `npm install` also installs the husky `pre-commit` hook (via the
`prepare` script), which runs lint-staged + typecheck + tests on every commit.

## Scripts

- `npm run typecheck` — run `tsc --noEmit`
- `npm test` — run jest
- `npm run test:coverage` — jest with coverage
- `npm run lint` — eslint (auto-fix) over root and `tests/` `.ts` files
- `npm run lint:file <path>` — eslint (auto-fix) on a single file
- `npm run format` — prettier `--write` over `**/*.{ts,js,cjs,md,json}`
- `npm run format:file <path>` — prettier `--write` on a single file
