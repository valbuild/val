---
"@valbuild/server": patch
"@valbuild/shared": patch
---

In local development, a draft page no longer flickers back to the content from
before a code change.

After you change a `.val.ts` (a field added, text written in code edited), the
dev server reloads Val with the new code, while a request the Studio or a page's
overlay had already made could still be answered by the code from before. That
answer named the old content as the one the editor's changes belong on, so the
Studio fetched it, and a page open in draft mode showed the new text, then the
old text, then the new text again. The old code's answer now names the content
the new code loaded, so nothing old is fetched or shown.

On a site Val hosts, the same flicker can still happen for a moment while a new
build is rolling out; that part needs a change on Val's side of the hosting and
is not in this release.
