---
"@valbuild/ui": patch
"@valbuild/tanstack": patch
---

A page opened in draft mode after a publish now shows the published
`.jsonValues()` entries in its hooks (`useVal`, `useValKey`, `useValRoute`),
on a host that does not rebuild the site after a publish. It used to show
those entries as they were before the publish -- from the site's bundle --
until the site was rebuilt; on TanStack Start the server render showed the
new content and the page then switched back to the old. The Studio now loads
those entries from Val's server and hands them to the page, and the TanStack
server render includes them.
