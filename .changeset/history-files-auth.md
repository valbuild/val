---
"@valbuild/server": patch
"@valbuild/shared": patch
---

Require a session to read a file from history

`GET /api/val/history/files` served a file at a given commit to anyone who
asked. It followed the reasoning of `/api/val/files`, which is deliberately
open — and neither half of that reasoning applies to it:

- `/files` stands on `patch_id` being an unguessable UUID. A **commit sha is
  published** — `git log`, the GitHub UI, every pull request — so it is no
  substitute for a credential.
- `/files` also _cannot_ require auth: draft images are fetched by the app's own
  backend during Next image optimisation, with no cookies to send. Nothing
  fetches history files server-side; both callers are the Studio, in a browser
  that already holds the session.

So history files now require a session. `/files` is unchanged, and the reason
the two differ is written down in `architecture/media.md` so it is not "fixed"
in either direction later.

No action needed: the Studio sends its session cookie automatically.
