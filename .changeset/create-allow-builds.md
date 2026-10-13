---
"@valbuild/create": patch
---

`npm create @valbuild` now also takes a feature's packages off `allowBuilds` in the template's `pnpm-workspace.yaml` when you leave that feature out. That is where the templates list the packages allowed to run build scripts now, because pnpm 11 no longer reads `pnpm.onlyBuiltDependencies` in `package.json`.
