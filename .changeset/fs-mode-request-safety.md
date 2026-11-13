---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/init": patch
---

Security fixes. Update if you run Val's dev server, or have deployed a site without `VAL_API_KEY` and `VAL_SECRET`.

- **`/api/val/files` serves media only.** It answered any path in the project, without a sign-in: `/api/val/files/.env` returned the file. It now serves files under `/public`, and their drafts, and nothing else.
- **An upload cannot be written outside Val's patch store.** A file's path and a patch's id are checked before anything is written or read, so a path with `..` in it is refused.
- **In local filesystem mode, the API answers only your own Studio.** A request from another site's page is refused, and so is one addressed to a host name that is not `localhost` or an IP address. If you develop on another name (`my-app.test`, a tunnel that passes its own `Host`), list it in the `VAL_ALLOWED_HOSTS` environment variable, comma separated.
- **A deployed site without credentials no longer serves the API.** Without `VAL_API_KEY` and `VAL_SECRET` an app runs in local filesystem mode, which has no sign-in. With `NODE_ENV=production` it now refuses, and says what to set.
- **`redirect_to` stays on your site.** `/api/val/logout`, `/enable`, `/disable` and `/authorize` redirected to any URL they were given. They now accept a path, or a URL on the same site.
- **Draft mode is turned on after sign-in**, not when the sign-in starts, so a visitor who is not signed in can no longer switch it on.
- `image-size`, `simple-git` and `zod` are updated past their published advisories.
