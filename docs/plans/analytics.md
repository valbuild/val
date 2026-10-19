# Content analytics

> **Status: proposed** (October 2026). Nothing is built. Scope for the first
> version: **TanStack Start, hosted by Val**. Next.js and self-hosted apps come
> later and are noted where the design has to leave room for them.
>
> This file is the Val side: the config, the analytics mode, the browser
> script and the wire format. The backend (the loader, the aggregator, Postgres,
> billing and the dashboard) is `valbuild/home`'s `docs/analytics.md`. The wire
> format below is the contract between the two, and lives here because Val is
> what sends it.

Val knows something no general analytics tool does: which piece of content a
DOM element shows. Stega already puts that on the page as `data-val-path` when
the Studio is open. Analytics keeps it on for every visitor, and a small script
counts which content was **rendered** (on the page) and **viewed** (on screen),
page view by page view.

No cookies, no storage, no visitor IDs, no unique visitors. What is kept is
counts.

---

## Decisions

| Question                     | Decided                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| What is counted              | Content **rendered** and **viewed**, per page view. Page views per route.                                                                  |
| Also counted                 | Source (referrer host), campaign (`utm_*`), country, device class, browser and OS family. Each on its own, never combined with each other. |
| Unique visitors              | **No.** Nothing that could recognise a visitor twice.                                                                                      |
| Where beacons go             | `POST /api/val/analytics` on the site's own origin, which ad blockers rarely list.                                                         |
| How it is turned on          | `analytics: { enabled: true }` in `val.config.ts`, or `VAL_ANALYTICS`. The env wins, so the platform can switch it with one click.         |
| Stega leaking out of the DOM | Encode exactly as draft mode does, and warn in dev about every place a tag survived. See [The leak warning](#the-leak-warning).            |
| Price                        | $25 a month per project, 100k page views included, graduated above that. In `home`.                                                        |

---

## 1. Analytics mode

Today stega is decided per request: draft mode on → encode, otherwise not
(`initValContent.ts`, `isEnabled = () => draftMode.isEnabled()`), and the
client holds tags out of SSR and the hydration render because the auto-tag
switch is process-wide and editors and visitors share a process
(`useEncodesEditTags`, and quirks.md on why).

Analytics mode makes the answer the same for everyone: **encode always**. That
removes the reason the client holds tags back, because the server encoded too,
so the hydration render matches.

| Where                                        | Today                                                 | With analytics on                                    |
| -------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `initValContent` (`tanstack/src/server`)     | `disabled: !draftMode`                                | `disabled: false`, `SET_AUTO_TAG_JSX_ENABLED(true)`  |
| `useEncodesEditTags` (`tanstack/src/client`) | `draftMode && (!serverDraft \|\| hydrated)`           | `true`, including SSR and hydration                  |
| `ValTanStackProvider`                        | `SET_AUTO_TAG_JSX_ENABLED(false)` without the overlay | leaves it on                                         |
| The analytics script                         | —                                                     | mounted when on, and NOT in draft mode or the canvas |

Analytics changes how content is **encoded**, never which content is read.
Draft mode still decides published versus patched source.

### Configuration

```ts
// val.config.ts
export const config = { project: "acme/site", analytics: { enabled: true } };
```

`VAL_ANALYTICS=true|false` overrides it. In TanStack the env is read by the
app's own `val.server.ts` and passed in as an option (`initValServer` and
`initValContent` already take `apiKey` and `http` this way, because a
separately bundled dependency cannot see `process.env`). On a hosted site the
generated `val.server.ts` does it, which is what makes the switch one click.

The flag reaches the client through the provider, from the same SSR pass, so
server and client can never disagree about it.

### The leak warning

`autoTagJSX` strips tags from the props of intrinsic elements and moves the path
to `data-val-path`. Anything that does not go through it keeps the invisible
characters: JSON-LD built with `dangerouslySetInnerHTML`, feeds and sitemaps
built as strings, `encodeURIComponent(title)` in a share link, a string
comparison in app code. Editors have lived with that in draft mode. With
analytics on, crawlers and every visitor get it.

A tag is about **1.5 KB** of invisible characters per string (measured, 60
strings, `@vercel/stega` 1.1.0), so a leak is heavy as well as wrong.

In dev, with analytics on, the script scans once after load and on every route
change:

- `document.title` and every `<meta>` `content`
- `<script type="application/ld+json">` bodies
- the dehydrated router state TanStack writes into the page
- every attribute value, and text nodes not under an element that has `data-val-path`

For each tag it finds, it decodes the path and logs:

```
[val] Content from /content/blog.val.ts?p="intro"."title" reached <script type="application/ld+json"> with its edit tag still in it.
      Wrap the value in val.raw() where it leaves React.
```

Production never runs the scan.

---

## 2. The browser script

`@valbuild/react/analytics`, a new preconstruct entrypoint in `@valbuild/react`
so Next can use it later. **It imports nothing from core, shared or zod**: it
reads `data-val-path` attributes, which `autoTagJSX`, `ValImage` and
`ValRichText` have already written, so it needs no stega decoder. See
`client-bundle-weight.md` for why that matters. It is loaded with a dynamic
`import()` after the `load` event, off the critical path.

It does nothing when any of these hold: draft mode, the Studio canvas, the Val
enable cookie (an editor browsing the live site), `navigator.webdriver`.

### What it counts

- **Rendered**: an element with `data-val-path` is in the DOM. Found by one
  scan after hydration, then a `MutationObserver` on `document.body`
  (`childList`, `subtree`, `attributeFilter: ["data-val-path"]`), coalesced
  through `requestAnimationFrame` like `ValCanvasBridge` does.
- **Viewed**: an `IntersectionObserver` reports the element at least 50%
  visible, or covering at least 50% of the viewport for an element taller than
  it, for at least 1 second without interruption.
- One element can carry several paths (`data-val-path` is comma-joined). The
  script splits them with a quote-aware splitter of its own, tested for parity
  with core's `splitJoinedSourcePaths`, rather than importing core.
- Each path counts **at most once per page view** for each of the two.

### Page views

A page view starts on load and on every client navigation, found by wrapping
`history.pushState` / `replaceState` and listening to `popstate`, then
comparing `location.pathname`. Starting one flushes the previous one. Elements
that stay on screen across a navigation (header, footer) count again for the
new page view, because they were rendered on it.

### Sending

- The first beacon goes about 3 s after the page view starts, with what has been
  rendered and viewed so far and the page view's own fields.
- Later beacons carry only what is new: newly rendered or viewed paths. They are
  sent on `visibilitychange` to `hidden`, on `pagehide`, when a page view
  ends, and at most every 15 s while more than 50 new paths are waiting.
- `navigator.sendBeacon` with a string body, so the request is `text/plain`,
  needs no CORS preflight, and survives the page closing. `fetch` with
  `keepalive: true` where `sendBeacon` is missing.
- About 1.5 beacons per page view on average. Every cost estimate in `home`
  rests on that number, so the loader meters it.

### The response

| Status | Meaning                                  | The script                             |
| ------ | ---------------------------------------- | -------------------------------------- |
| 204    | Counted, or deliberately dropped         | Carries on                             |
| 410    | Analytics is off or paused for this site | Stops sending until the next full load |
| 413    | Body too large                           | Drops it; a bug, not a retry           |

`sendBeacon` cannot read the status, so the script uses `fetch` with
`keepalive` for the first beacon of a page load and `sendBeacon` after that. A
410 on the first stops the rest.

---

## 3. Wire format, version 1

```http
POST /api/val/analytics
Content-Type: text/plain;charset=UTF-8
```

```jsonc
{
  "v": 1,
  // location.pathname, never the query or the hash
  "route": "/blogs/my-post",
  // only on the first beacon of a page view; its presence IS the page view
  "view": {
    "ref": "news.ycombinator.com", // document.referrer's host, only if another site
    "utm": { "source": "newsletter", "medium": "email", "campaign": "oct" },
    "device": "phone", // phone < 640 px <= tablet < 1024 px <= desktop
  },
  // module file path → module paths (the part after ?p=)
  "rendered": {
    "/src/routes/blogs.$postId.val.ts": [
      "\"/blogs/my-post\".\"title\"",
      "\"/blogs/my-post\".\"sections\".0.\"body\"",
    ],
  },
  "viewed": {
    "/src/routes/blogs.$postId.val.ts": ["\"/blogs/my-post\".\"title\""],
  },
}
```

- Grouping by module roughly halves the size. 60 rendered and 36 viewed paths
  is about 4.8 KB.
- The client sends no country, browser or OS. The edge adds those: country from
  `request.cf.country`, browser and OS family from the User-Agent, without the
  version.
- Limits, enforced by the receiver: body at most 16 KB, at most 200 paths per
  beacon, `route` at most 512 characters, only `utm_source`, `utm_medium` and
  `utm_campaign`, each at most 100 characters.
- A new field gets a new `v`. A receiver drops a version it does not know with
  a 204, so an old receiver never breaks a new site.

**Known limit: array items are counted by index.** `"sections".0` is whatever
is first today. Reordering a list moves its counts to other items. Record
entries have stable keys. The dashboard says so on array items rather than
pretending otherwise.

---

## 4. `/api/val/analytics` outside the hosted platform

On a hosted site the loader answers this route before the request reaches the
app (see `home`), so the app's handler never runs there.

Everywhere else it does, so `createValApiRouter` gets the route (`ApiRoutes.ts`
and `ValServer.ts`, as every endpoint does): it validates the body against the
wire format and answers 204. In dev it also logs a one-line summary per beacon,
which is how the showcase shows analytics working without a backend.
Self-hosted forwarding to Val's ingest, authenticated with the project's
`VAL_API_KEY`, is the later step that turns that 204 into a count.

---

## 5. Testing

- **Unit, `@valbuild/react/analytics`**: rendered and viewed rules with a fake
  `IntersectionObserver` and timers; one count per path per page view; page
  view boundaries on `pushState` / `popstate`; payload grouping and limits; the
  path splitter against `splitJoinedSourcePaths` on the same inputs; nothing
  sent in draft mode, in the canvas, with the enable cookie or with
  `navigator.webdriver`.
- **Unit, `@valbuild/tanstack`**: with analytics on, SSR output carries
  `data-val-path`, and the hydration render matches it (no mismatch warning);
  with it off, today's behaviour is unchanged, byte for byte.
- **Leak warning**: a fixture page with JSON-LD, a title and a share link, each
  leaking one tag, and the warning naming all three.
- **Bundle weight**: a test that the analytics entrypoint's import graph
  contains no `@valbuild/core`, `@valbuild/shared` or `zod`.
- **e2e, `tanstack` project**: Playwright intercepts `/api/val/analytics`,
  scrolls a page, and checks the beacon names the content that was scrolled
  past as viewed, and the content below the fold as rendered only.

## 6. The showcase

Per `CLAUDE.md`, a feature is not done until `examples/tanstack` shows it:

- `analytics: { enabled: true }` in its `val.config.ts`
- a long page whose content is partly below the fold
- the dev log from section 4 printed in the terminal while it is browsed

Add "analytics" to the showcase list in `CLAUDE.md`.

## 7. Build order

1. `analytics` in `ValConfig` and the TanStack options; the analytics mode in
   `initValContent`, `useEncodesEditTags` and the provider, with the
   hydration test.
2. `@valbuild/react/analytics`: counting, page views, sending, with its unit
   tests and the bundle-weight test.
3. The `/api/val/analytics` route in `ValRouter` and the dev log; the showcase;
   the e2e test.
4. The leak warning.
5. Release, then the template bump, so hosted sites built from
   `template-tanstack-starter` carry it.

`home`'s loader side can be built in parallel against the wire format above.

## Later

- **Next.js**: the same mode in `initValRsc` / `initValClient`, and
  `generateMetadata` checked against the leak warning first.
- **Self-hosted**: forwarding from `/api/val/analytics` to Val's ingest.
- **In the Studio**: views shown beside the content being edited, named through
  `describePath`.
