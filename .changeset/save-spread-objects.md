---
"@valbuild/server": patch
---

Saving an edit no longer fails with `Converting circular structure to JSON` when a `.val.ts` file uses object spreads, such as `{ title: "…", ...noMedia, learnMore: null }`.

An edit to a key written out after every spread in its object is now saved, and the spread is left as it is. An edit to a key a spread supplies, or one a later spread may override, is refused with a message that names the file, the line and the spread, so you know which value to write out — before, any spread anywhere along the edited path refused the save, and the refusal itself crashed `/save` with a 500.
