---
"@valbuild/next": minor
---

Add Suspense support to draft-mode client hooks: with the new opt-in `suspend` prop on `ValProvider` (`<ValProvider config={config} suspend>`), `useValStega` / `useValRouteStega` suspend until the required module data has loaded, instead of rendering published/empty content first. Backed by the new `ValExternalStore.hasAllLoaded` / `waitForLoad` methods. Requires React 19+ (`React.use` is used internally).

The Val Enable cookie is detected client-side after hydration, so layouts stay synchronous and routes stay statically renderable — no server-side cookie read is needed (and none should be added: reading cookies in a layout opts every route into dynamic rendering). The Suspense gate activates inside a transition, so SSR/hydration render the static committed content and the swap to draft data happens without a fallback flash or hydration mismatch. Production visitors without the cookie pay no cost, and hooks never suspend once draft mode is known to be off.

With `suspend`, client-side navigation to a route that only exists in an uncommitted draft suspends until the draft data arrives instead of calling `notFound()`. Hard loads of such routes still 404 (the server only knows committed content).
