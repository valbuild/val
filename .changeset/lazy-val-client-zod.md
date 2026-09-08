---
"@valbuild/shared": patch
"@valbuild/next": patch
---

Stop shipping zod to every visitor of a Val site (~113 KB)

`@valbuild/next`'s client code needed five things from
`@valbuild/shared/internal`, three of which are string constants like
`VAL_THEME_SESSION_STORAGE_KEY`. But preconstruct publishes each entrypoint as
a single bundled module, so importing a string constant pulled in the whole
entrypoint — including `ApiRoutes.ts` and its zod schemas. Measured on
val.build, that was 113 KB of zod in the initial JS of every page, for
visitors who never open the Studio.

Two changes:

- New `@valbuild/shared/client` entrypoint carrying the parts that are safe in
  a browser bundle: the session-storage keys, the canvas protocol, and the
  route-pattern helpers. Nothing reachable from it may import zod, and
  `noZodInClientEntrypoint.test.ts` walks the source graph to enforce that —
  one careless re-export would silently put the 113 KB back.
- `ValNextProvider` now imports `createValClient` on first use rather than at
  module scope. It genuinely needs zod (it `safeParse`s every request and
  response), but its only caller is the draft-mode poll, which returns early
  unless the overlay is mounted. A visitor without the Val Enable cookie never
  triggers the import.

No API change. `@valbuild/shared/internal` still exports everything it did.
