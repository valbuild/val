---
"@valbuild/eslint-plugin": minor
"@valbuild/language-server": minor
"@valbuild/server": minor
"@valbuild/create": minor
"@valbuild/react": minor
"@valbuild/shared": minor
"@valbuild/init": minor
"@valbuild/cli": minor
---

Bump every dependency to its latest usable version, and stop shipping ones nothing imports

TypeScript moves to 6, eslint to 10, vite to 8, and the remaining runtime
dependencies to their current majors: `@vercel/stega` 1, `vscode-languageserver`
10, `chalk` 6, `degit` 3, `diff` 9, `@inquirer/prompts` 8, `jscodeshift` 17,
`minimatch` 10, `react-day-picker` 10.

Three things are visible from outside:

**`engines.node` now says what actually works.** It claimed `>=18.17.0`, which
had already stopped being true: the CJS `bin.js` requires ESM-only packages, and
that needs Node's `require(esm)`. The ranges are derived from the resolved tree
rather than picked:

- `@valbuild/cli`, `@valbuild/init`, `@valbuild/create`:
  **`^22.13.0 || >=23.5.0`** — `chalk` 6 requires `>=22`, and `@inquirer/prompts`
  8 requires `>=23.5.0 || ^22.13.0 || ^20.17.0`. The intersection also clears the
  `require(esm)` floor.
- `@valbuild/server`, `@valbuild/language-server`: **`^20.19.0 || >=22`** —
  `chokidar` 5 requires `>=20.19.0` and `minimatch` 10 allows `18 || 20 || >=22`.
  These do not depend on chalk, so they still run on Node 20.

**Dependencies that nothing imports are gone.** Each was checked against every
file in its package for `from`, `require()` and `import()`, including dynamic
string references:

- `@valbuild/init` drops `@inquirer/confirm`, `cors`, `eslint`, `express`,
  `fast-glob`, `open`, `picocolors`, `recast`, `typescript` and `zod` — from 17
  runtime dependencies to 7. It edits eslint config files as _text_ and never
  loads eslint, and its codemods go through jscodeshift's `tsx` parser, which is
  `@babel/parser` and not the `typescript` package.
- `@valbuild/cli` drops `cors`, `open` and `zod`. It still imports `typescript`,
  which it takes as a peer dependency, not a direct one.

That is 473 lines out of the lock file, and an install every consumer was paying
for. Nothing behavioural changes — `express` 5's breaking changes could never
reach us, because nothing called express.

**`@valbuild/eslint-plugin` now requires eslint 8.40 or newer**
(`^8.40.0 || ^9.0.0 || ^10.0.0`, previously `6 || 7 || 8 || 9`), and accepts
TypeScript 5 or 6. eslint 10 removed `context.getFilename()` and
`context.getCwd()`, which the rules used as a fallback for versions before
`context.filename` arrived in 8.40. With the fallback gone, claiming eslint 6 and
7 would be false. Both are long past end of life.

`@valbuild/init` also no longer depends on `@types/diff`: `diff` 9 ships its own
types, and a separate `@types` package alongside them is how you end up with two
conflicting declarations.

Everything else is internal. `@vercel/stega` 1.1 encodes byte-identically to
0.1.2 and decodes in both directions, so edit tags written by either version stay
readable by the other.

Held back deliberately, each for a reason rather than an oversight: Babel 8
(`@preconstruct/cli` depends on `@babel/core ^7` outright), TypeScript 7 (its
main export is the version string — the compiler API this project is built on
moved), meow 14 (requires `import.meta`, which breaks the CJS bin), prettier 3.9
(never reaches a stable format on one of our Markdown files), and Tailwind 4
with `tailwind-merge` 3 (a scoped migration, written up in
`docs/plans/tailwind-4-migration.md`).
