---
"@valbuild/tanstack-build": patch
"@valbuild/cli": patch
---

`val publish` now refuses to build a site whose installed TanStack disagrees with the platform's. A project's CI builds its dependency layer from its own `node_modules`, and a lockfile two patches away from the platform's `@tanstack/*` used to publish fine and then fail on the first request that reached the mismatched code — typically signing in — with "does not provide an export named …". The build now stops with a message naming the package, the version the project resolved and the version the platform carries, and the fix is to pin the package to that version (with `pnpm.overrides` for a transitive one) and reinstall.

The same build also checks every import a dependency takes from the platform's React and TanStack against what the platform says those modules export, which until now ran only in the platform's own checkout.

Both checks use what the platform reports about itself, so they run once the platform does; until then `val publish` builds as before and says in its output that the check was skipped. They run in the `@valbuild/tanstack-build` the project has installed, so upgrade it alongside `@valbuild/cli`.
