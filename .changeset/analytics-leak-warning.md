---
"@valbuild/react": patch
"@valbuild/tanstack": patch
---

Content analytics now warns in development about edit tags that leak out of React. With analytics on, `ValProvider` looks at the page as a visitor gets it and names every place content arrived with its edit tag still in it: a `<title>`, a `<meta>`, JSON-LD, a share link built with `encodeURIComponent`, or any other attribute or text. Each warning says which content it was and where, and that `val.raw()` fixes it. Open the site in a window where Val is not enabled to see them; production never runs the check.

Also fixed: text inside a fragment (`<li>{a}<> — {b}</></li>`) kept its edit tag on the page. It is now cleaned, and the element the fragment sits in is tagged with its content instead.
