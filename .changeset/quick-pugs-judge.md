---
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/shared": patch
---

Read draft content once per request instead of once per `fetchVal`

In draft mode, `fetchVal` resolves its selector by asking the Val server for the
whole module tree. It did that on every call, so a page with three reads made
three requests for three identical answers — and `fetchValRouteUrl` added a
fourth by calling `fetchVal` again on top of the caller's own. The answer cannot
differ between reads in one request, so it is now read once and shared. On a
60-module project a three-read draft render goes from ~187ms to ~70ms.

The memo is scoped to the request and nothing wider, because the response it
holds contains the caller's own unpublished patches: React's `cache()` in a
Next RSC, a `WeakMap` keyed on the `Request` in TanStack Start, and no caching
at all where neither is available.

What this does **not** change:

- **Production is untouched.** With Val disabled the reader never calls the
  server; it resolves against the statically imported module, as before.
- **What a draft shows is unchanged.** Same query, same patch scoping — a draft
  still shows the caller's own staged work and nobody else's.
- **The client readers are untouched.** `useVal` already subscribed to exactly
  the modules its selector names.
- **The server still evaluates every module per request.** Narrowing the
  request's path was measured and does not help: `/sources/~` evaluates,
  previews and validates everything and only then filters the response, so a
  narrow path returns less for the same milliseconds. That remains open.
