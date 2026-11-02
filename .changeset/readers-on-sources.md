---
"@valbuild/react": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Every content reader in `@valbuild/next` and `@valbuild/tanstack` — `fetchVal`,
`useVal`, the key and route readers, on the server and in the browser — now
loads content the same way, so they can no longer disagree about which content
wins. Nothing you call changes. What you may notice:

- `useValRoute` on a `.jsonValues()` router loads only the entry for the
  current route. It used to load every entry of the record first.
  `useValRouteUrl` and `fetchValRouteUrl` load none at all: a URL does not need
  them.
- In development, an edited `*.val.json` entry shows its new content after a
  hot reload. The hooks kept the entry they had loaded before it.
- Next.js: `useValKey` no longer shows the published entry of a nullable
  `.jsonValues()` record that a draft has set to `null`, nor anything for an
  entry named like a built-in object property (such as `toString`) that the
  draft does not have.
- With `suspend` on `ValProvider`, `useValKey` now waits for draft mode and the
  editor's changes too, as `useVal` and `useValRoute` already did.
- When one entry of a `.jsonValues()` record cannot be loaded, `useVal` logs
  the error and renders the others, as `fetchVal` already did, instead of
  failing the whole component.
