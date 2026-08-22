---
"@valbuild/ui": minor
"@valbuild/next": minor
---

Client components now show your unpublished changes in draft mode.

They were rendering committed content while server components on the same page rendered drafts, so a page built from both showed two different versions of the same content. The overlay was being handed the un-patched module source; it now receives the patched one, and it receives it as you type rather than only when the editor syncs.

`useValKey` and `useValRoute` follow the same rule for a `.jsonValues()` entry: the draft view wins when it has an answer — including the answer "this entry was deleted", which previously fell back to rendering the published content of an entry the editor had just removed. `fetchValKey` and `fetchValRoute` had that same fallback and are fixed too.

Emissions are debounced, since the trigger is now every edit rather than every sync.
