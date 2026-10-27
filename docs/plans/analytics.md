# Content analytics

> **Status: in progress** (October 2026). Steps 1–4 of the
> [build order](#7-build-order) are built, in valbuild/val #878, #881 and #887.
> On `home`'s side the loader's route and meter, the aggregator and delivery
> to Postgres are merged (valbuild/home#255, #256, #258, #260); the project
> setting, billing and the dashboard are not built. Scope for the first
> version: **TanStack Start, hosted by Val**.
> Next.js and self-hosted apps come later and are noted where the design has
> to leave room for them.
>
> This file is the Val side: the switch, the analytics mode, the browser
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

| Question                     | Decided                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is counted              | Content **rendered** and **viewed**, per page view. Page views per route.                                                                                                                                                       |
| Also counted                 | Source (referrer host), campaign (`utm_*`), country, device class, browser and OS family. Each on its own, never combined with each other; only the source is also kept per route ("where did this page's visitors come from"). |
| Unique visitors              | **No.** Nothing that could recognise a visitor twice.                                                                                                                                                                           |
| Where beacons go             | `POST /api/val/analytics` on the site's own origin, which ad blockers rarely list.                                                                                                                                              |
| How it is turned on          | **Off by default.** Only in the hosted project's settings, which reach the site as `VAL_ANALYTICS`. No `val.config.ts` option.                                                                                                  |
| Stega leaking out of the DOM | Encode exactly as draft mode does, and warn in dev about every place a tag survived. See [The leak warning](#the-leak-warning).                                                                                                 |
| Price                        | $25 a month per project, 100k page views included, graduated above that. In `home`.                                                                                                                                             |

---

## 1. Analytics mode

Today stega is decided per request: draft mode on → encode, otherwise not
(`initValContent.ts`, `isEnabled = () => draftMode.isEnabled()`). For a page
rendered from a server-read draft, the client hooks already hold the tags out
of the server's render and the hydration render, and add them in the render
React does right after (`useEncodesEditTags`, via `useHydrated`). They do that
because the server cannot be relied on to tag: whether the patched JSX runtime
is the one it renders with depends on how the app was bundled.

Analytics mode is **that same rule, for every visitor**: no tags on the server
or while a component hydrates, tags from the render after. An earlier draft of
this plan encoded on the server too, and was wrong for that reason.

| Where                                        | Today                                                 | With analytics on                                                                         |
| -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `useEncodesEditTags` (`tanstack/src/client`) | `draftMode && (!serverDraft \|\| hydrated)`           | the same in draft mode; otherwise `hydrated`                                              |
| `ValTanStackProvider`                        | `SET_AUTO_TAG_JSX_ENABLED(false)` without the overlay | `SET_AUTO_TAG_JSX_ENABLED(true)`                                                          |
| `initValContent` (`tanstack/src/server`)     | `disabled: !draftMode`                                | **unchanged**: server reads stay untagged for visitors                                    |
| The analytics script                         | —                                                     | mounted when on, and NOT in draft mode, on a page rendered from a draft, or in the canvas |

What follows from it:

- **The content in the HTML a visitor is sent is the same with analytics on or
  off**, and no edit tag reaches a crawler that does not run the page. Only the
  setting itself differs, where it travels to the browser (the site layout's
  loader data). On a hosted site that needs nothing new: a kept (prerendered)
  page is served only while the project's secrets revision is the one it was
  rendered with, so switching makes the site's pages render live until `home`
  crawls them again.
- **Content read with the client hooks is counted. Content read through a
  loader or a server function is not**, the same way it is not
  click-to-edit (quirks.md). The hooks are the recommended way to read content
  anyway.
- One extra render per component that reads content, right after hydration.
  Draft mode already pays it.

Analytics changes how content is **encoded**, never which content is read.
Draft mode still decides published versus patched source.

### Turning it on

**Off by default, and for now turned on only in the hosted project's
settings.** There is no `val.config.ts` option: a switch in the code is one the
project's owner cannot see, and two switches raise the question of which wins.

- The owner turns it on in admin; the platform sets the `VAL_ANALYTICS` secret
  (see `home`'s `docs/analytics.md`).
- The `val.server.ts` the platform writes (`@valbuild/tanstack-build`'s
  `wire.ts`) exports `fetchValAnalytics()`, which reads that secret at
  runtime, so switching is not a rebuild. It reads only the secrets the
  platform hands over (`__PLATFORM_SECRETS`), never `process.env`: a value
  baked in at build time would be a second switch, and one that stays on
  after the owner turns it off.
- The site layout's loader passes it to `<ValProvider analytics>`, beside
  `fetchValDraft()`. The provider keeps the value it mounted with, because the
  loader runs only on the server and a client navigation hands it `undefined`.

```tsx
const getValPage = createServerFn().handler(async () => ({
  draft: await fetchValDraft(),
  analytics: await fetchValAnalytics(),
}));
// ...
<ValProvider config={config} draft={page?.draft} analytics={page?.analytics}>
```

### The leak warning

`autoTagJSX` strips tags from the props of intrinsic elements and moves the path
to `data-val-path`. Anything that does not go through it keeps the invisible
characters: JSON-LD built with `dangerouslySetInnerHTML`, feeds and sitemaps
built as strings, `encodeURIComponent(title)` in a share link, a string
comparison in app code. Editors have lived with that in draft mode. With
analytics on, every visitor gets it after hydration, and so does any crawler
that runs the page, Googlebot included. The server's HTML stays clean.

A tag is about **1.5 KB** of invisible characters per string (measured, 60
strings, `@vercel/stega` 1.1.0), so a leak is heavy as well as wrong.

In development, with analytics on, `ValProvider` watches the page a VISITOR
gets (`watchStegaLeaks` in `@valbuild/react/stega`) and scans it whenever it
has settled after a change -- after load, after the render that adds the tags,
after every route change. It looks at everything a tag can reach:

- `document.title`, every `<meta>` `content` and every other attribute value,
  percent-decoded too, so `encodeURIComponent(title)` in a share link is found
- `<script type="application/ld+json">` bodies, and every other text node

Anything that went through `autoTagJSX` is clean, so a tag found anywhere is a
leak. For each one it logs, once per path and place:

```
[val] Content from /content/blog.val.ts?p="intro"."title" reached <script type="application/ld+json"> with its edit tag still in it. Wrap the value in val.raw() where it leaves React.
```

Three decisions in it:

- **A visitor's page only** -- the analytics script's own gate, so a browser
  with Val enabled sees no warning; open the site in a private window. An
  editor's page is rendered from a draft, and content the server read for one
  carries its tags in its text until the browser renders it again (the
  showcase's docs route says why). No visitor gets that, and `val.raw()` would
  not fix it, so warning about it would be noise.
- **"Development" is React's development build** (`isReactDevelopmentBuild`:
  `react/jsx-dev-runtime` has a `jsxDEV`). `process.env.NODE_ENV` is not
  reliable in the browser: TanStack Start's dev server hands it a `process.env`
  without one. Production never runs the scan.
- **It found a leak in `autoTagJSX` itself on its first run.** A fragment cannot
  carry `data-val-path`, so `autoTagJSX` skipped fragments, and the text in
  `<li><a>{link.title}</a><> — {link.blurb}</></li>` kept its tag on every
  visitor's page. A fragment's text is now cleaned and its paths go to the
  element it is in.

The showcase's post page writes JSON-LD and a share link through `val.raw()`,
and `e2e/tanstack/leakWarning.spec.ts` checks it warns about nothing there, and
names a title, JSON-LD and a share link put on the page that each leak a tag.

---

## 2. The browser script

`@valbuild/react/analytics`, a new preconstruct entrypoint in `@valbuild/react`
so Next can use it later. **It imports nothing from core, shared or zod**: it
reads `data-val-path` attributes, which `autoTagJSX`, `ValImage` and
`ValRichText` have already written, so it needs no stega decoder. See
`client-bundle-weight.md` for why that matters. The provider loads it with a
dynamic `import()` in an effect after hydration, off the critical path.

It does nothing when any of these hold: draft mode, a page the server rendered
from a draft, a proposal's address (its snapshot is unpublished content), the
Studio canvas, the Studio's own pages, the Val enable cookie (an editor
browsing the live site), `navigator.webdriver`.

### What it counts

- **Rendered**: an element with `data-val-path` is in the DOM. Found by one
  scan when a page view starts, then a `MutationObserver` on `document.body`
  (`childList`, `subtree`, `attributeFilter: ["data-val-path"]`) whose added
  and removed nodes are processed incrementally, coalesced with a 50 ms
  timeout, so a page that changes all the time costs what it changes.
- **Viewed**: an `IntersectionObserver` reports the element at least 50%
  visible, or covering at least 50% of the viewport for an element taller than
  it, for at least 1 second without interruption while the tab is visible. The
  timers are cleared when the tab is hidden and started again on return for
  what is still on screen.
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

Three more rules decide what a page view is:

- **What is on screen when the URL changes is carried.** The old page stays up
  until the new one has loaded, so it is not counted for the new route until
  the page changes under it (new tagged content is added, or carried content
  is removed) or the first beacon goes at 3 s. What is still there then is the
  layout around both pages, and it counts. Left before either, it is not
  counted.
- **The landing page view is sent on its own** when the visitor moved on
  before the script started: it carries the referrer, and nothing counted on
  it. The provider hands the script the pathname at hydration
  (`landingPath`), so a URL the router only normalised is not a second page
  view.
- **A page restored from the back/forward cache** (`pageshow` with
  `persisted`) starts a page view.
- **Navigating on again before the new page has changed the screen** credits
  the carried content to neither route: the page view in between still
  counts, with nothing rendered on it.
- **A prerendered page** (`document.prerendering`: speculation rules, the
  address bar's guess) counts nothing until it is shown, and nothing if it
  never is.

A page view is a change of PATHNAME; what is sent is its route. `/blogs/a` to
`/blogs/b` is two page views of `/blogs/$slug`.

### Sending

- The first beacon goes about 3 s after the page view starts, with what has been
  rendered and viewed so far and the page view's own fields.
- Later beacons carry only what is new: newly rendered or viewed paths. They are
  sent on `visibilitychange` to `hidden`, on `pagehide`, when a page view
  ends, and at most every 15 s while 50 or more new paths are waiting.
- A beacon holds at most 200 paths and about 12 KB (`MAX_BEACON_BYTES`, an
  estimate of the UTF-8 JSON), and more is split over several. A path longer
  than the wire format allows is dropped rather than cut.
- `navigator.sendBeacon` with a string body, so the request is `text/plain`,
  needs no CORS preflight, and survives the page closing. `fetch` with
  `keepalive: true` where `sendBeacon` is missing.
- About 1.5 beacons per page view on average. Every cost estimate in `home`
  rests on that number, so the loader meters it.

### The response

| Status | Meaning                                  | The script                             |
| ------ | ---------------------------------------- | -------------------------------------- |
| 2xx    | Counted, or deliberately dropped         | Carries on                             |
| 410    | Analytics is off or paused for this site | Stops sending until the next full load |
| 413    | Body too large                           | Drops it; a bug, not a retry           |

`sendBeacon` cannot read the status, so the first beacon of a page load that
is not sent while leaving goes with `fetch` and `keepalive`, and the rest with
`sendBeacon`. A 410 on it stops the rest. A beacon sent while leaving, before
that one, goes with `sendBeacon` and its answer is not read.

---

## 3. Wire format, version 1

```http
POST /api/val/analytics
Content-Type: text/plain;charset=UTF-8
```

```jsonc
{
  "v": 1,
  // the ROUTE the page is, as the app names it -- never the pathname, the
  // query or the hash. A pathname can hold something about one visitor (an
  // order number, a token, an email address); a route pattern cannot. The
  // TanStack provider passes the matched route's `fullPath` as `routeFor`;
  // a pathname no route matches is "(not found)"
  "route": "/blogs/$slug",
  // the content version the page was rendered from: the id of the content
  // version the hosted site served it from, the same one whether or not the
  // bundle holds it. Absent outside Val's hosting -- see "The content version"
  "cv": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
- Limits: at most 200 paths per beacon in all, a module path at most 1,024
  characters and a module file path at most 512, `route` at most 512, `ref`
  at most 253, `cv` at most 128, only `utm_source`, `utm_medium` and
  `utm_campaign`, each at most 100. The script never sends more, and keeps a
  beacon to about 12 KB. The hosted loader also refuses a body over 16 KB
  (413) and cuts anything else over a limit to it; Val's own route (section 4)
  refuses a v1 beacon over a limit with a 400.
- A new field gets a new `v`. A receiver ignores a version it does not know
  with a 2xx (the hosted loader 204, Val's own route `200 { counted: false }`),
  so an old receiver never breaks a new site.

### The content version

**Built** in valbuild/val #887 and valbuild/home#255.

**Every count is stored with the content version it was seen in** (`cv`).
That answers "did the new hero do better than the old one" across a publish,
and it is what makes positions safe to count, below.

- **One identity per version**: the id of the content version the loader
  serves (`head.content.id`, or a preview's), always -- also when the
  bundle's own content is live, where the isolate is handed no `VAL_CONTENT`.
  Never the build's commit, which would give the same content a second key.
- **The loader hands it to every isolate it starts** as
  `VAL_CONTENT_VERSION` (`dynamicEnv` in `trust.ts`), except at a proposal's
  address, whose content is no published version. It is constant for an
  isolate: one without a content suffix in its id serves only its build's
  own version, one with it is keyed by that id. A project's secret by that
  name is dropped.
- **`fetchValAnalytics()` returns a `ValAnalytics`**, `{ enabled,
contentVersion? }`, read from what the platform hands over; the layout
  passes it to `<ValProvider analytics>` as before, and the provider passes
  `contentVersion` to the script, which sends it as `cv`.
- **`cv` is optional in the wire format**, because a site Val does not host
  has no version to send. On a hosted site every beacon from a site built
  with this carries one; the loader stamps the head it is serving only on a
  beacon from a site built before. That is a fallback, not the design: it
  names the version live when the beacon arrives, not the one the page was
  rendered from, which is wrong across a publish -- the case `cv` exists for.

**Array items are counted by position.** This is decided, not a gap.
`"sections".0` is whatever is first that day, and reordering a list moves
its counts to the item now in that place. Record entries have stable keys.
Because each count carries its content version, the dashboard can name the
item that was at that position in that version, and labels the rest by
position.

---

## 4. `/api/val/analytics` outside the hosted platform

On a hosted site the loader answers this route before the request reaches the
app (see `home`), so the app's handler never runs there -- once `home` has
built that route. Until then a hosted site with analytics on would send every
beacon to its isolate as a full render, so the admin switch must not ship
before it.

Everywhere else it does, so `createValApiRouter` gets the route (`ApiRoutes.ts`
and `ValServer.ts`, as every endpoint does): it validates the body against the
wire format, limits included, and answers `200 { counted: false }`. A body
whose `v` is a number other than 1 gets the same answer, ignored. A body with
no `v`, one that is not an object, or a v1 beacon that does not parse gets a 400. It checks no body size. In local dev (`fs` mode) it
also logs a line per beacon (`[val] analytics: / (page view): 12 rendered, 4
viewed`), which is how the showcase shows analytics working without a backend.
Self-hosted forwarding to Val's ingest, authenticated with the project's
`VAL_API_KEY`, is the later step that turns `counted` true.

---

## 5. Testing

- **Unit, `@valbuild/react/analytics`**: rendered and viewed rules with a fake
  `IntersectionObserver` and timers; one count per path per page view; page
  view boundaries on `pushState` / `popstate`; payload grouping and limits; the
  path splitter against `splitJoinedSourcePaths` on the same inputs; nothing
  sent in draft mode, in the canvas, with the enable cookie or with
  `navigator.webdriver`.
- **Unit, `@valbuild/tanstack`**: with analytics on, the server's HTML is
  identical to analytics off and carries no tag; hydrating it reports no
  mismatch, and the render after carries the tags; draft mode is unchanged.
- **e2e, `tanstack` project**: the HTML a visitor is sent names no content,
  and after hydration the showcase's content has `data-val-path` and clean
  text, a lazy component handed a string as a prop included.
- **Leak warning** (built): `stegaLeaks.test.ts` and `autoTagJSX.test.ts`; in
  e2e, the showcase's post page warning about nothing, and a title, JSON-LD
  and a share link each leaking one tag, named, all three.
- **Bundle weight**: a test that the analytics entrypoint's import graph
  contains no `@valbuild/core`, `@valbuild/shared` or `zod`.
- **e2e, `tanstack` project**: Playwright intercepts `/api/val/analytics` and
  checks the first beacon names the content at the top of the page as
  rendered and viewed, and that a client navigation is a page view of its own
  (built). Still to add: scroll a long page, and check the content scrolled
  past is viewed and the content below the fold rendered only.

## 6. The showcase

Per `CLAUDE.md`, a feature is not done until `examples/tanstack` shows it:

- `VAL_ANALYTICS=true` in its `.env.development`, which TanStack Start loads
  into `process.env`, read by its own `fetchValAnalytics()` (built)
- the dev log from section 4 printed in the terminal while it is browsed
  (built)
- a long page whose content is partly below the fold (not built yet)

The showcase list in `CLAUDE.md` names analytics.

## 7. Build order

1. `<ValProvider analytics>` and `fetchValAnalytics()`; the analytics mode in
   `useEncodesEditTags` and the provider, with the hydration test and an e2e
   test on the showcase. **Built**: valbuild/val #878
   (`claude/tanstack-analytics-mode`), open.
2. `@valbuild/react/analytics`: counting, page views, sending, with its unit
   tests and the bundle-weight test. **Built**: #881
   (`claude/analytics-browser-script`), open.
3. The `/api/val/analytics` route in `ValRouter` and the dev log; the showcase's
   switch; the e2e tests of the beacon and of a navigation. **Built**, in #881.
4. The content version: `VAL_CONTENT_VERSION` from the loader,
   `fetchValAnalytics()` returning a `ValAnalytics`, the provider passing it
   on. **Built**: #887 and valbuild/home#255. See
   [The content version](#the-content-version).
5. The showcase's long page and the scroll e2e test.
6. The leak warning. **Built**, with the fragment fix in `autoTagJSX`.
7. Release, then the template bump, so hosted sites built from
   `template-tanstack-starter` carry it.

`home`'s loader side can be built in parallel against the wire format above.

## Later

- **Next.js**: the same mode in `initValRsc` / `initValClient`, and
  `generateMetadata` checked against the leak warning first.
- **Self-hosted**: forwarding from `/api/val/analytics` to Val's ingest.
- **In the Studio** (built): views shown beside the content being edited.
  Val Build answers one module at a time
  (`GET /v1/studio/orgs/:org/projects/:project/analytics/module?module=`,
  valbuild/home), through this app's `/api/val/admin/proxy` like every other
  Val Build call the Studio makes, so it works deployed and, after
  `val login`, locally. `packages/ui/spa/analytics/`: one request per module,
  kept five minutes; a field, a list row or a module gets the most any path
  inside it got (a page view has no "item", only the elements it showed, so
  adding them would count a page view once per field); the heading of what is
  open lists what in it was seen most, named through `describePath`. Nothing
  is shown where there is nothing to say: analytics off, not signed in to Val
  Build, the demo, or a request that failed.
