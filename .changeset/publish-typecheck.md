---
"@valbuild/cli": patch
"@valbuild/shared": patch
---

`val publish` now typechecks the project while it builds. It uses the `node_modules` the build already reads for the dependency layer, so nothing is downloaded for the check. It is the same typecheck the Studio runs for a proposal that changes dependencies. Type errors are printed as warnings, first line each (at most 20), and do not stop the publish. `--no-typecheck` turns the check off.

Only a pnpm project with its own `pnpm-lock.yaml` is typechecked. Anything else says why it was skipped and publishes as before.

For a build on the server, `@valbuild/shared/typecheck/node` exports `typecheckInstalled({ root, files })` and `installedSources(root)`: the typecheck run against a project installed on that machine.
