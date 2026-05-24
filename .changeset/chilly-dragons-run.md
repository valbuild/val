---
"@valbuild/next": patch
---

Add Suspense support to draft-mode client hooks: `useValStega` now suspends until the required module data has loaded, instead of rendering published/empty content first. Backed by the new `ValExternalStore.hasAllLoaded` / `waitForLoad` methods and the `valSuspense` helper that bridges React 18 (throw-promise) and React 19 (`React.use`).

`ValProvider` now accepts an optional `enabled` prop. Pass it from a Server Component that reads the `VAL_ENABLE` cookie (e.g. via `next/headers`) so Val is known to be enabled synchronously during SSR. This lets `useValRoute` suspend on the first render instead of calling `notFound()`, so navigating to a route that only exists in an uncommitted draft no longer 404s.
