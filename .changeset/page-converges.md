---
"@valbuild/react": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

A draft page now catches up with an edit as soon as the server has it, instead
of on a timer.

- **The page settles faster, and without the 10 second fallback.** Content your
  page reads on the server (a TanStack Start loader, a Next.js server component)
  is refreshed when the editor's change has been saved, once per saved change.
  It used to be refreshed the moment you typed — before the change was saved,
  so the refresh often came back without it — and then again every 10 seconds
  for half a minute in case it had. That safety refresh is gone, and so are the
  extra requests it made while you edited. Another editor's change refreshes
  the page too, once the server has it.
- **Next.js: `ValProvider` takes an optional `draft` prop**, as
  `@valbuild/tanstack`'s does: the editor's draft, read on the server for the
  request. With it, the server renders the draft and the browser hydrates the
  same thing, so a draft page no longer shows the published text first, and a
  page that exists only as an unpublished change is found on the first render
  instead of answering 404. Without it, nothing changes. See "The `draft` prop"
  in the `@valbuild/next` README.
- **`suspend` waits for the editor's changes properly.** With `suspend` on
  `ValProvider`, a page could be told it had everything before the editor had
  sent the pending change it needed, and render the published content first —
  for a page that exists only as an unpublished change, a 404. It now waits
  until the change is there.
- A draft page whose draft was discarded or published before the editor's
  overlay or canvas connected now shows what the editor has, instead of keeping
  the draft it was rendered with.
