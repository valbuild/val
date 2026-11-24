# Pitfalls of a real app on Val's hosting

What went wrong while moving a real site, Blank's www.blank.no (Next.js on
Vercel, `blankoslo/blankno-v3`), to TanStack Start on Val's hosting
(`blankoslo/blankno-v4`, hosted project 5415389), November 2026. Another app
doing the same will meet the same things.

Each issue says what an app author sees, why, and where it stands. The rule
this note exists to enforce: **an issue Val does not fix has to be one an app
author can find out about and avoid** -- from a message, a check they can run,
or the docs they read -- rather than by reading Val's source or the platform's
logs, as was needed here.

Status: **fixing** means a session on that repository is on it (2026-11-24);
**open** means nobody is, yet. The last section lists the open work by
repository.

---

## Build and publish

### 1. A JS Tailwind config builds locally and fails to publish

- **Seen:** `pnpm dev` and `pnpm build` work. `val publish` fails with
  `Tailwind's '@config "../tailwind.config.js"' could not be resolved from the
project. Add it to package.json and install, or remove the directive.`
- **Why:** Val's publish build compiles Tailwind itself, with `base: "/"`
  (`packages/tanstack-build/src/tailwind.ts`), so a relative `@config` or
  `@plugin` is looked up from `/`. And a build in the Studio has no module
  loader at all, so a JS config or plugin can never work there.
- **Status:** fixing (valbuild/val): resolve relative to the stylesheet, and a
  message that names the real cause. Still a rule an author has to know:
  **CSS-only Tailwind config** (`@theme`, `@utility`, `@custom-variant`).
- **Open:** say it in the README, and in the message when the Studio build
  refuses a JS module.

### 2. What works locally is not what Val builds

- **Seen:** issue 1 reached `main` and failed in CI. Nothing local had
  complained.
- **Why:** Val's publish build is its own bundler (rolldown, a dependency
  layer, a canary), not the app's Vite build.
- **What exists:** `val publish --dry-run` builds exactly as a publish does,
  has Val verify a canary, and stops before the site changes. It would have
  caught issue 1. Nothing tells an author it exists: the TanStack README never
  mentions it, and the template has no script for it.
- **Open:** a `check:publish` script in the templates and a README section on
  "check a publish before you push". blankno-v4 added
  `"check:publish": "val publish --dry-run"` and says when to run it in its
  AGENTS.md.

### 3. `val publish --help` publishes

- **Seen:** `val publish --help` started a publish (it stopped only because
  the network was blocked).
- **Status:** fixing (valbuild/val): `--help` prints help, for every command.

### 4. Build tools in `dependencies` are bundled into the site

- **Seen:** every publish warned
  `Could not resolve '@vitejs/devtools/config'` and
  `@tailwindcss/vite is not in the dependency layer: loads the native binary …`.
- **Why:** Val's dependency layer gets an entry for **every** package in
  `dependencies`, imported or not, so the Studio can import a newly added one.
  The template lists `@tailwindcss/vite`, `tailwindcss` and the TanStack
  devtools there, so a Vite plugin is bundled, and Vite with it.
- **Status:** fixing (valbuild/val): a warning that says to move build tools to
  `devDependencies`.
- **Open:** the templates (`tanstack/full`, `tanstack/minimal`) still list them
  under `dependencies`. That is valbuild/templates.

### 5. `tanstack-start-manifest:v` "could not be resolved" on every publish

- **Seen:** a full rolldown diagnostic, twice, on a project with nothing wrong.
- **Status:** fixing (valbuild/val). Noise like this teaches authors to ignore
  warnings, which is how issue 4 went unnoticed.

### 6. `pnpm dev` reloads the page on first load

- **Seen:** `optimized dependencies changed. reloading` on every cold start.
- **Why:** Vite's scan does not see `@valbuild/core` and `@valbuild/ui`,
  because Val loads them lazily.
- **Open:** templates: `optimizeDeps: { include: ['@valbuild/core', '@valbuild/ui'] }`
  in `vite.config.ts` (blankno-v4 has it).

### 7. `val validate --fix` behind a proxy says "check your network connection"

- **Seen:** `Could not get public project id: Failed to get project id. Check
network connection and try again.` The network was fine.
- **Why:** Node's built-in `fetch` ignores `HTTPS_PROXY` unless run with
  `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21). Corporate networks and CI runners
  behind proxies are common. The message hides the underlying error and
  guesses at the cause (CLAUDE.md: "Don't blame them for our failures").
- **Open:** valbuild/val: show the underlying error under the message, and
  when `HTTPS_PROXY` is set but not honoured, say how to honour it.

---

## Runtime on Val's hosting

### 8. The site runs in a Worker isolate, not Node

- **Seen:** the contact form used `nodemailer` (SMTP) and the calendar used
  `google-auth-library`. Both work in `pnpm dev`, and neither is safe in a
  Worker isolate. blankno-v4 moved to Mailgun's HTTP API and a WebCrypto-signed
  Google token.
- **Why:** hosted sites run in a Cloudflare Worker isolate: `fetch` and
  WebCrypto, Node builtins through `nodejs_compat`, but no real sockets for
  SMTP and no persistent filesystem. `val publish --dry-run` renders pages, so
  a server route that fails only when called passes every check.
- **Open:** valbuild/val README: a "what runs where" section (Worker isolate;
  `process.env` on the server; no SMTP or filesystem; use HTTP APIs). Possibly
  a publish-time warning for dependencies known not to work there (`nodemailer`,
  raw `net`/`tls`).

### 9. A head read through `createServerFn` costs a server round trip per navigation

- **Seen:** every first client-side navigation waited 2–4 s (9.3 s at worst)
  on `/_serverFn/<route>_getHead`. Back and forward were instant (TanStack's
  loader cache). This is the template's own pattern:
  `_site.products.$sku.tsx` reads `head` through `createServerFn`.
- **Why:** a loader runs in the browser too, so a server read from a loader
  means an HTTP call per navigation, and on Val's hosting that call often
  lands on a cold isolate (issue 10).
- **What blankno-v4 did:** on the server the loader still calls `getHead`, which
  sees drafts. In the browser it builds the head from the content the site was
  built with, `val.unstable_getUnpatchedUnencodedVal(module)[pathname]`
  (`bundledRoute` in `src/utils/getPageMetadata.ts`), which is what `useVal`
  renders from there. Measured: 0 server calls across 9 navigations, the same
  titles, and 404s still 404.
- **Open:** valbuild/val: a supported way for a loader to read content in the
  browser (not `unstable_` and not a hook), and the template's routes using
  it, so new apps do not start with a round trip per navigation.

### 10. Every uncached request takes 2–4 s; latency grows with concurrent load

- **Seen:** kept pages answer in about 0.25 s. The same page with a query
  string, every `/_serverFn/*` call, every Studio API call, and even a request
  rejected with an immediate 403, takes 2–4 s. In waves of 20 concurrent
  uncached requests the slowest took about 8 s. In the loader's tail, wall time
  is 1.6–2.6 s against 0.13–0.35 s of CPU: it is waiting on the project's
  isolate.
- **Why (two parts):**
  - The isolate is mostly cold. Whether it is evicted, not reused, or
    serialised while it starts is being investigated (valbuild/home: fixing).
  - Starting one is expensive. Rendering a public page evaluates about 37 MB
    of JS: `@valbuild/ui` (the Studio, 21.6 MB), `typescript` (9.1 MB),
    prettier, sucrase, the MCP SDK. Locally, the first request in a fresh
    process takes 1.9 s, nearly all of it module loading; once warm, pages
    render in 18–45 ms (valbuild/val: fixing, keep the editing stack off the
    serving path).
- **Open:** see issue 12. An author cannot tell any of this from the outside.

### 11. Concurrent requests fail with the platform's 503

- **Seen:** "This site could not answer just now. The server running it
  stopped while it was working on the request." 9 of 55 requests in a load
  test, failing in 0.2–0.4 s. The editor saw it from opening the site a few
  times, and TanStack's "Something went wrong!" when it hit a loader.
- **Why:** the loader logged "This promise was created by a request that has
  since ended, so it can never settle" (`handle_cross_request_promise_resolution`)
  for every one. The loader shares in-flight reads between requests
  (`joinShared.ts`), written for cancelled work that hangs, but under that flag
  a joiner is rejected instead, and the rejection is passed on as the answer.
  Most likely the background head refresh in `headCache.ts`; not yet proven.
- **Status:** fixing (valbuild/home), with a load test before and after. The
  same check on Val's own serving path (`ReaderRuntime` in
  `@valbuild/tanstack/server`): fixing (valbuild/val).

### 12. An app author cannot see why their hosted site is slow or failing

- **Seen:** everything in issues 10 and 11 was found with the platform
  account's Cloudflare API (GraphQL analytics and a live tail of
  `platform-loader`). An app author has none of that. Kept pages also make a
  site look fast to whoever checks with a plain URL, which hides the problem.
- **Open:** valbuild/home:
  - Response headers that say what served a request: kept page or rendered,
    warm or cold isolate, render time (`Server-Timing`).
  - The project's own errors and outcomes (exceptions, CPU or memory
    exceeded, cold starts) where its owners can read them, in Val Build.
  - The 503 page already carries the Ray ID: make it something an owner can
    look up.

### 13. The default error screen is TanStack's

- **Seen:** "Something went wrong! Hide Error", with no way forward.
- **Open:** templates: a `defaultErrorComponent` in the site's style with Try
  again (CLAUDE.md, "An error says what the person can do about it"), and the
  README saying an app needs one.

---

## Content and media

### 14. Edit tags leak into libraries outside React

- **Seen:** for an editor with Val on, a video never loaded. The edge log shows
  a 503 for `…/jump_8a193.mp4%E2%80%8B%E2%80…`: the URL with Val's invisible
  edit tags in it, which `video.js` had been handed as `src`.
- **Why:** strings read through Val carry stega-encoded edit tags. React
  attributes are handled; a value passed through a JavaScript API (`video.js`,
  a map library, `fetch`) is not. Only editors are affected, so it is easy to
  miss.
- **Open:**
  - valbuild/val: the TanStack README mentions `val.raw` nowhere. Say when it
    is needed: URLs, keys, comparisons, anything handed to a non-React library.
    Also check whether the dev-mode leak warning catches this case.
  - valbuild/home: `/_val/file/…` should answer a path with edit tags in it
    with a 400 that says so ("this URL contains Val's edit tags; read it with
    `val.raw`"), not a 503 that blames the platform.

### 15. Images are served at their original size

- **Seen:** `/arbeider` downloaded 58 MB; one 16.7 MB PNG (4695×7287) was
  shown at 600×960. On Vercel, `next/image` resized everything. On Val's
  hosting `ValImage` is an `<img>`, and `/_val/file` serves the original.
- **What blankno-v4 did:** re-encoded the 241 oversized images from their
  originals (WebP, 1200 or 2400 px on the longest side, by where they are
  shown) with a one-off script, and uploaded them with `val validate --fix`:
  457 MB became 35 MB; `/arbeider` is 6.8 MB. Every `s.image()` now has
  `encode: { type: 'webp' }`, so new uploads are scaled in the browser.
- **Status:** fixing (valbuild/home): resizing on `/_val/file` so `ValImage` can
  send `srcset`.
- **Open:**
  - valbuild/val: `val validate` should warn about an image far larger than its
    schema's `encode` limits (or than any sensible display size), with a fix
    that re-encodes it. Today a project can only do what blankno-v4 did by hand.
  - The README should recommend `encode` for every image field until resizing
    exists.

### 16. Porting from `@valbuild/next`: what silently changed

- `ValImage` took `next/image`'s props (`fill`, `priority`, `sizes`). The
  TanStack one does not, and the README's table says only "is an `<img>`".
  blankno-v4 wraps it in `src/framework.tsx`.
- A file value's `mimeType` is top-level; older code that read
  `metadata?.mimeType` got `undefined` and no error.
- `s.date()` rejects the timestamps older content holds. `val validate` reports
  it, so this one is findable.
- **Open:** valbuild/val: a "moving from `@valbuild/next`" section in the
  TanStack README with these.

---

## The Studio

### 17. Signing in on a phone is impossible

- **Seen:** on a phone, `/val` showed "Log in required" after about 20 s, and
  the Log in button did nothing.
- **Why:** `LoginDialog` wraps `DialogContent` in its own portal and overlay,
  and `DialogContent` renders both again. The outer overlay covers the button
  and swallows taps.
- **Status:** fixing (valbuild/val). Workaround until then: open
  `/api/val/authorize?redirect_to=<the /val URL>` directly.
- Also seen: signed out, the Studio retried a request answering 401 every few
  seconds. Asked to check in the same session.

---

## Not Val's, for completeness

- Big media in git history: the move rewrote history to drop it and stored
  media remotely (`scripts/rewrite-v3-history.py` in blankno-v4).
- A GitHub OAuth app without the `workflow` scope cannot push a history that
  contains `.github/workflows/`.

---

## Open work, by repository

**valbuild/val**

- [ ] README: CSS-only Tailwind config (1), `val publish --dry-run` (2),
      dependencies versus devDependencies (4), what runs where (8), `val.raw`
      beyond React (14), `encode` on every image field (15), moving from
      `@valbuild/next` (16), an error component (13).
- [ ] A supported browser-side content read for loaders, and the template's
      head pattern moved to it (9).
- [ ] The CLI's network errors show the underlying error and the proxy hint (7).
- [ ] `val validate`: warn about oversized images, with a fix that re-encodes
      (15).
- [ ] Check that the dev leak warning catches a tagged string passed to a
      library (14).

**valbuild/templates**

- [ ] Build tools in `devDependencies` (4); `optimizeDeps.include` (6); a
      `check:publish` script (2); an error component (13); the head pattern from
      (9) once Val has it.

**valbuild/home**

- [ ] Headers that say kept or rendered, warm or cold, and how long (12).
- [ ] The project's own errors and outcomes, readable by its owners (12).
- [ ] `/_val/file` answers a path with edit tags with a 400 that says so (14).
