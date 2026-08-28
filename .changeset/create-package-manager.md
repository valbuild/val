---
"@valbuild/create": minor
---

Install with the package manager that ran `create`, not always npm

`pnpm create @valbuild` used to hand the new project to `npm install`: it wrote
a `node_modules` and a `package-lock.json` the person who asked for pnpm did not
want, next to the template's own committed `package-lock.json`, and then told
them to run `npm run dev`.

The package manager that invoked us is now the one used. Every package manager
sets `npm_config_user_agent` when it runs a lifecycle script, so pnpm, yarn and
bun are recognized the same way npm is, and the install command, the printed
next steps and the `val connect` line all follow. The lock files belonging to
the package managers not chosen are removed from the downloaded template, so
the project is left with exactly one, and it is real.

To override the detection, pass `--use-npm`, `--use-pnpm`, `--use-yarn` or
`--use-bun` (or `--package-manager <name>`). An unrecognized name is an error
rather than a silent fall back to npm.
