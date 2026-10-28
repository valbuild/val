---
"@valbuild/ui": patch
"@valbuild/tanstack-build": patch
---

The Studio's files now also ship as plain files, so a host can serve them itself instead of from your app's server.

- `@valbuild/ui` includes `static/`: every Studio file, plus a `manifest.json` that says which request path under `/api/val/static` serves which file. Binary files are copied byte for byte. `@valbuild/ui/server` is unchanged, and so is every host that uses it.
- `@valbuild/tanstack-build` uses it on Val Build's hosting. When the platform says it serves build assets, the site's dependency layer leaves out the Studio copy embedded in `@valbuild/ui/server` and carries the Studio's files as build assets instead. The site's server then loads about 18 MB less JavaScript and uses roughly 80-100 MB less memory. That margin is what kept a Studio from loading on a hosted site: its server ran out of memory and was restarted on almost every request.
