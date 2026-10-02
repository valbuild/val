---
"@valbuild/tanstack": patch
---

The TanStack Start toolchain `@valbuild/tanstack` is developed and tested against is now `@tanstack/react-start@1.168.60` (with `@tanstack/react-router@1.170.41`), the first release with the fix for the XSS vulnerability [GHSA-qx66-fv34-fjm8](https://github.com/advisories/GHSA-qx66-fv34-fjm8) (CVE-2026-102989), which affects `@tanstack/react-start` `>=1.143.12 <1.168.60`.

`@valbuild/tanstack` does not bring TanStack Start with it — your app's own `@tanstack/react-start` is the one that ships — so **upgrade it to `>=1.168.60`** (`pnpm add @tanstack/react-start@^1.168.60 @tanstack/react-router@^1.170.41`) and check that your lock file no longer resolves an older one, including `@tanstack/start-server-core` below `1.169.39`. Vercel blocks deploys whose dependency tree contains a vulnerable version.
