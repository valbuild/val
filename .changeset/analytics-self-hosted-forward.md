---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/tanstack": patch
---

Content analytics now counts on self-hosted sites (Custom hosting), not only on sites Val hosts.

A self-hosted app's own Val server now hands each analytics beacon on to Val's ingest, which counts it. To turn it on:

- Run the app with Val's content service: `VAL_API_KEY`, `VAL_SECRET` and `VAL_PROJECT` set. Most deployed apps already do.
- Set `VAL_ANALYTICS=true`. In TanStack Start, read it in your layout's loader (`{ enabled: process.env.VAL_ANALYTICS === "true" }`) and pass the result to `<ValProvider analytics>`. A self-hosted site has no platform to pass it for you.
- Switch analytics on for the project in Val's admin. While it is off there, the script on your pages is told so and stops sending.

The server forwards only same-origin beacons from a browser. It passes on the visitor's User-Agent and, where your host provides one (Vercel, Cloudflare or CloudFront), their country. It never passes on their IP address. If the api key is not accepted, the server logs one warning naming `VAL_API_KEY` and `VAL_PROJECT`. Local development (fs mode) works as before and counts nothing.

`VAL_ANALYTICS_INGEST_URL` overrides where beacons are sent. You will normally not need it.
