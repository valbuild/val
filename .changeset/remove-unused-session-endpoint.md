---
"@valbuild/shared": patch
"@valbuild/server": patch
---

Remove the unused `GET /api/val/session` endpoint.

Nothing called it. The Studio reads the profile id from `/stat`, and in proxy
mode the route proxied to `${VAL_BUILD_URL}/api/val/${project}/auth/session`,
an upstream route that no longer exists — so calling it by hand returned a 500
rather than a session. It is gone from both the route declarations in
`@valbuild/shared` and the implementation in `@valbuild/server`.

Session cookie handling itself is unchanged: `/authorize`, `/callback` and
`/logout` still set and clear `val_session` as before.
