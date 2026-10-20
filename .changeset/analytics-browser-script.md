---
"@valbuild/react": patch
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/tanstack": patch
"@valbuild/next": patch
---

The content analytics script. With analytics on (it is off by default, and turned on in a hosted project's settings), a TanStack site counts which content each visitor's page **rendered** and which they actually **viewed** (at least half on screen for a second), and sends it to `/api/val/analytics`.

- No cookies, no storage, no visitor IDs. Each page view also says where it came from (the referring site's host and any `utm_source` / `utm_medium` / `utm_campaign`) and whether it was a phone, tablet or desktop.
- A page is sent as its route's pattern (`/posts/$postId`), never its address, so a path that holds something about one visitor (an order number, a token) is never stored. `startValAnalytics` takes this as `routeFor`; `ValProvider` passes TanStack's matched route.
- Editors are never counted: nothing is sent in draft mode, in the Studio, with Val enabled, or at a proposal's address, and nothing from automated browsers. A page the browser prerenders counts nothing until it is shown.
- The script is the new `@valbuild/react/analytics` entry, loaded only for visitors of a site with analytics on, after the page has hydrated. It imports nothing else from Val.
- Storing the counts and showing them is part of Val's hosting, which takes these beacons before they reach the site. Anywhere else, `/api/val/analytics` checks each beacon and stores nothing; in local development, with `VAL_DEBUG=1`, it logs a line per beacon, so you can see it working.
- `ValProvider`'s Studio check now matches `/val` and what is below it only, not every route starting with those letters (`/values`). The same fix is in `@valbuild/next`.
