---
"@valbuild/eslint-plugin": minor
"@valbuild/language-server": patch
"@valbuild/server": patch
"@valbuild/create": patch
"@valbuild/react": patch
"@valbuild/shared": patch
"@valbuild/init": patch
"@valbuild/cli": patch
---

Bump every dependency to its latest usable version

TypeScript moves to 6, eslint to 10, vite to 8, and the remaining runtime
dependencies to their current majors: `@vercel/stega` 1, `vscode-languageserver`
10, `chalk` 6, `degit` 3, `diff` 9, `@inquirer/prompts` 8, `jscodeshift` 17,
`express` 5, `minimatch` 10, `react-day-picker` 10.

Two changes are visible from outside:

- **`@valbuild/eslint-plugin` now requires eslint 8.40 or newer**
  (`^8.40.0 || ^9.0.0 || ^10.0.0`, previously `6 || 7 || 8 || 9`), and accepts
  TypeScript 5 or 6. eslint 10 removed `context.getFilename()` and
  `context.getCwd()`, which the rules used as a fallback for versions before
  `context.filename` arrived in 8.40. With the fallback gone, claiming eslint 6
  and 7 would be false. Both are long past end of life.
- **`@valbuild/init` no longer depends on `@types/diff`.** `diff` 9 ships its own
  types, and a separate `@types` package alongside them is how you end up with
  two conflicting declarations.

Everything else is internal. `@vercel/stega` 1.1 encodes byte-identically to
0.1.2 and decodes in both directions, so edit tags written by either version
stay readable by the other.

Held back deliberately, each for a reason rather than an oversight: Babel 8
(`@preconstruct/cli` depends on `@babel/core ^7` outright), TypeScript 7 (its
main export is the version string — the compiler API this project is built on
moved), meow 14 (requires `import.meta`, which breaks the CJS bin), prettier 3.9
(never reaches a stable format on one of our Markdown files), and Tailwind 4
with `tailwind-merge` 3 (a scoped migration, written up in
`docs/plans/tailwind-4-migration.md`).
