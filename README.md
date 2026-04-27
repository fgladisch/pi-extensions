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

## Scripts

- `npm run typecheck` — run `tsc --noEmit`
- `npm test` — run jest
- `npm run test:coverage` — jest with coverage
