---
"@valbuild/server": minor
"@valbuild/shared": minor
---

A link-check endpoint, so the Studio can find out whether an external page is
still there.

`POST /external-urls/check` opens up to twenty URLs and reports what answered:
the final status after redirects, where it ended up, and how long it took. The
Studio's Check button in the external pages dialog is the only caller, and it
cannot do this itself — a cross-origin `fetch` from a browser cannot read a
response status without CORS headers no ordinary site sends.

It is an endpoint that makes outbound requests to addresses your content
supplies, so it is built as one:

- It requires a Studio session, like every other authenticated route.
- It refuses to connect to anything that is not a public internet address —
  loopback, link-local, the private ranges, the carrier-grade NAT range, and
  the cloud metadata service that hands out instance credentials. The check is
  on the RESOLVED address rather than the hostname, so a name that resolves to
  `127.0.0.1` is refused, and it runs again at every redirect hop.
- It answers with one generic message for anything it refused, so the endpoint
  cannot be used to find out what a hostname resolves to from inside your
  network. The reason is logged on the server.
- `HEAD` first, `GET` only where a site answers 405 or 501 to it, and no
  connection reuse between targets.
