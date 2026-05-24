---
"@valbuild/next": patch
---

Add Suspense support to draft-mode client hooks: `useValStega` now suspends until the required module data has loaded, instead of rendering published/empty content first. Backed by the new `ValExternalStore.hasAllLoaded` / `waitForLoad` methods and the `valSuspense` helper that bridges React 18 (throw-promise) and React 19 (`React.use`).
