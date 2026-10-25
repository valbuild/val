---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

The typecheck the Studio runs on an upgrade, which reports the type errors a project would have after `pnpm install`, is now `@valbuild/shared/typecheck`, so the platform's upgrade page can run the same check. The Studio's typecheck works as before. Type bundles and compilers can now also be fetched with a credential of the caller's own (`adeptSources({ base, headers, credentials })`).
