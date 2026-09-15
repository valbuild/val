---
"@valbuild/core": patch
---

External page keys that are not absolute URLs are now reported.

`externalPageRouter` has always documented one rule — a key must start with
`https://` or `http://` — and never enforced it: the validator collected the
errors and then returned an empty list, so a key like `discord.gg/val` or
`/about` was accepted in silence and behaved as a relative link on the site.

Val Studio's add form checks the same rule while you type, which is why this
went unnoticed. A key written by hand in a `.val.ts`, or pasted into a
`*.val.json`, never goes through that form.

If your project has such a key, it will start showing a validation error on
that entry. Give it a scheme, or move it out of the external router.
