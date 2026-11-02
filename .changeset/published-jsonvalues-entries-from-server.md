---
"@valbuild/server": patch
"@valbuild/core": patch
"@valbuild/tanstack": patch
"@valbuild/next": patch
---

After a publish, a draft-mode `fetchVal` of a whole `.jsonValues()` record now
shows the published entries straight away. On a host that does not rebuild
the site after a publish, it used to show those entries as they were before
the publish -- from the site's bundle -- while `fetchValKey` and
`fetchValRoute` showed the new content. Val's server now marks each entry a
publish wrote, and the readers load a marked entry from the server rather
than from the bundle.
