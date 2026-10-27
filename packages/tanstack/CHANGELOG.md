# @valbuild/tanstack

## 0.150.7

### Patch Changes

- Updated dependencies [[`2d5ad2e`](https://github.com/valbuild/val/commit/2d5ad2e90f2a2bdd6ad8af98b21e19bc0bf6dbcc)]:
  - @valbuild/react@0.150.7

## 0.150.6

### Patch Changes

- [#962](https://github.com/valbuild/val/pull/962) [`f84222b`](https://github.com/valbuild/val/commit/f84222b2c902d8725b1da96f79481060fb8b9842) Thanks [@freekh](https://github.com/freekh)! - Text rendered through `React.createElement` no longer keeps Val's invisible edit tag. TanStack Router's `<Link>` renders its link that way, so with content analytics on, the text of a link built from content carried the tag on every visitor's page.

  New: `import "@valbuild/tanstack/autotag"` as the first import of `src/router.tsx`. Under `vite dev`, components whose modules ran before `@valbuild/tanstack` was imported were not click-to-edit, and the leak warning named their text as leaked. A production build was not affected.

- Updated dependencies [[`f84222b`](https://github.com/valbuild/val/commit/f84222b2c902d8725b1da96f79481060fb8b9842)]:
  - @valbuild/react@0.150.6

## 0.150.5

### Patch Changes

- Updated dependencies [[`47a31cc`](https://github.com/valbuild/val/commit/47a31cc3574841acf4f3207d5053f8bc728d25cd)]:
  - @valbuild/server@0.150.5
  - @valbuild/ui@0.150.5
  - @valbuild/language-server@0.150.5
  - @valbuild/mcp@0.150.5
  - @valbuild/react@0.150.5

## 0.150.4

### Patch Changes

- [#957](https://github.com/valbuild/val/pull/957) [`820cd47`](https://github.com/valbuild/val/commit/820cd479ff6c44e7db195b9dd320a001129c17a4) Thanks [@freekh](https://github.com/freekh)! - Content analytics can be turned on while developing: `VAL_ANALYTICS=true` in the app's `.env.development` turns it on under `vite dev` for a `<ValProvider>` that is passed no `analytics`, so the leak warning shows you where an edit tag leaves React before any visitor gets it. It is read only on the development server; a hosted site is still switched on in its project settings.

  The "Val is currently hidden" note in the browser console now shows in development with TanStack Start. It looked for `process.env.NODE_ENV`, which the development server does not set in the browser.

## 0.150.3

### Patch Changes

- Updated dependencies [[`bc0cc43`](https://github.com/valbuild/val/commit/bc0cc433e157cca08f9ee384a4fb8be9bd3dad2c)]:
  - @valbuild/ui@0.150.3
  - @valbuild/core@0.150.3
  - @valbuild/shared@0.150.3
  - @valbuild/react@0.150.3
  - @valbuild/server@0.150.3
  - @valbuild/language-server@0.150.3
  - @valbuild/mcp@0.150.3

## 0.150.2

### Patch Changes

- [#946](https://github.com/valbuild/val/pull/946) [`e24dc6e`](https://github.com/valbuild/val/commit/e24dc6e56e7647654e27ee2390d2181b0eaff3ad) Thanks [@freekh](https://github.com/freekh)! - Content analytics now warns in development about edit tags that leak out of React. With analytics on, `ValProvider` looks at the page as a visitor gets it and names every place content arrived with its edit tag still in it: a `<title>`, a `<meta>`, JSON-LD, a share link built with `encodeURIComponent`, or any other attribute or text. Each warning says which content it was and where, and that `val.raw()` fixes it. Open the site in a window where Val is not enabled to see them; production never runs the check.

  Also fixed: text inside a fragment (`<li>{a}<> — {b}</></li>`) kept its edit tag on the page. It is now cleaned, and the element the fragment sits in is tagged with its content instead.

- [#944](https://github.com/valbuild/val/pull/944) [`155a079`](https://github.com/valbuild/val/commit/155a0792c2a437a1cbcdd6342131999be70e0d70) Thanks [@freekh](https://github.com/freekh)! - A TanStack splat route now has a page of its own. `src/routes/docs.$.tsx` serves `/docs` as well as everything under it, the way TanStack Router matches it, and `/docs` is now a valid key in its Val module. It used to be refused ("does not match `/docs/[..._splat]`"), so the page TanStack served at `/docs` could not be given content. `useValRoute` on that page reads the `/docs` entry.
- Updated dependencies [[`e24dc6e`](https://github.com/valbuild/val/commit/e24dc6e56e7647654e27ee2390d2181b0eaff3ad), [`c674aae`](https://github.com/valbuild/val/commit/c674aae361be3c75b5232acb41ea6d8da973c678), [`c044e55`](https://github.com/valbuild/val/commit/c044e55452ba34ec5b7b38c935c9c25491d980be), [`36412b2`](https://github.com/valbuild/val/commit/36412b28bb009083f652b26462b76a74c80ff595), [`155a079`](https://github.com/valbuild/val/commit/155a0792c2a437a1cbcdd6342131999be70e0d70), [`8f598b6`](https://github.com/valbuild/val/commit/8f598b618b794e59ef5b9c6ef94650be4ff006e7), [`95d17e6`](https://github.com/valbuild/val/commit/95d17e6bbecceb2f09d6a6226808e9c60b2d4795), [`520d22c`](https://github.com/valbuild/val/commit/520d22cc721ff23b83e4bae0b4ba7f52a6a0fa0c)]:
  - @valbuild/react@0.150.2
  - @valbuild/ui@0.150.2
  - @valbuild/shared@0.150.2
  - @valbuild/core@0.150.2
  - @valbuild/server@0.150.2
  - @valbuild/language-server@0.150.2
  - @valbuild/mcp@0.150.2

## 0.150.1

### Patch Changes

- Updated dependencies [[`9171baa`](https://github.com/valbuild/val/commit/9171baad7beb1b2a355c70724d2339467b126e02), [`fd9ee2a`](https://github.com/valbuild/val/commit/fd9ee2ad76ef45bc6c4801aaccaae6e183960f11)]:
  - @valbuild/core@0.150.1
  - @valbuild/mcp@0.150.1
  - @valbuild/server@0.150.1
  - @valbuild/shared@0.150.1
  - @valbuild/language-server@0.150.1
  - @valbuild/ui@0.150.1
  - @valbuild/react@0.150.1

## 0.150.0

### Patch Changes

- Updated dependencies [[`baf2f56`](https://github.com/valbuild/val/commit/baf2f56498ca2ae5ec1f5bef356faf09a382b768), [`f638188`](https://github.com/valbuild/val/commit/f638188c27fc338ace3d8282f59e83084adcb002)]:
  - @valbuild/ui@0.150.0
  - @valbuild/react@0.150.0
  - @valbuild/server@0.150.0
  - @valbuild/language-server@0.150.0
  - @valbuild/mcp@0.150.0

## 0.149.7

### Patch Changes

- [#932](https://github.com/valbuild/val/pull/932) [`8be6e6a`](https://github.com/valbuild/val/commit/8be6e6abd2536b5758f0d5f8dfb1e468f29a7015) Thanks [@freekh](https://github.com/freekh)! - A site's Val can now check the site's content with its own rules: `Internal.selfCheck` in `@valbuild/tanstack`. The platform's upgrade page calls it on the version an upgrade moves to, so content the new version would reject is found before the upgrade is published, not after. It answers the errors that would hold a publish back, the same ones the Studio shows, and loads nothing until it is called, so it adds nothing to a site's pages.

- [#930](https://github.com/valbuild/val/pull/930) [`8366c57`](https://github.com/valbuild/val/commit/8366c575df66ee19c3400b7fdbc14a8fd517afd6) Thanks [@freekh](https://github.com/freekh)! - Every loading spinner in the Studio is now drawn the same way, at even sizes. Odd-sized spinners, of which the Studio had several, are known to wobble in Safari.
- Updated dependencies [[`8be6e6a`](https://github.com/valbuild/val/commit/8be6e6abd2536b5758f0d5f8dfb1e468f29a7015), [`cc2a37a`](https://github.com/valbuild/val/commit/cc2a37a74c52cab6fa062e8252fb292b84a479c3), [`7e78b1f`](https://github.com/valbuild/val/commit/7e78b1f863c47d4f38d9f1c9855a92e711170865), [`8366c57`](https://github.com/valbuild/val/commit/8366c575df66ee19c3400b7fdbc14a8fd517afd6)]:
  - @valbuild/shared@0.149.7
  - @valbuild/ui@0.149.7
  - @valbuild/language-server@0.149.7
  - @valbuild/mcp@0.149.7
  - @valbuild/react@0.149.7
  - @valbuild/server@0.149.7

## 0.149.6

### Patch Changes

- Updated dependencies [[`8e79b44`](https://github.com/valbuild/val/commit/8e79b44b4610d188a206ed0b6de448c602a99965)]:
  - @valbuild/ui@0.149.6
  - @valbuild/server@0.149.6
  - @valbuild/react@0.149.6
  - @valbuild/language-server@0.149.6
  - @valbuild/mcp@0.149.6

## 0.149.5

### Patch Changes

- Updated dependencies [[`1e18a1b`](https://github.com/valbuild/val/commit/1e18a1ba31e169895fb75074028822dda305d26f), [`9e44644`](https://github.com/valbuild/val/commit/9e44644933103d0db38bf72463478d80a1a9b0dd)]:
  - @valbuild/ui@0.149.5
  - @valbuild/server@0.149.5
  - @valbuild/react@0.149.5
  - @valbuild/language-server@0.149.5
  - @valbuild/mcp@0.149.5

## 0.149.4

### Patch Changes

- Updated dependencies [[`1a426f4`](https://github.com/valbuild/val/commit/1a426f41759c5f70492be5f1795bdc260ac3572b)]:
  - @valbuild/ui@0.149.4
  - @valbuild/react@0.149.4
  - @valbuild/server@0.149.4
  - @valbuild/language-server@0.149.4
  - @valbuild/mcp@0.149.4

## 0.149.3

### Patch Changes

- Updated dependencies [[`ce7d5f4`](https://github.com/valbuild/val/commit/ce7d5f4f0732acb49068ae79a90aeff6fdc9e574)]:
  - @valbuild/ui@0.149.3
  - @valbuild/react@0.149.3
  - @valbuild/server@0.149.3
  - @valbuild/language-server@0.149.3
  - @valbuild/mcp@0.149.3

## 0.149.1

### Patch Changes

- [#916](https://github.com/valbuild/val/pull/916) [`f607bca`](https://github.com/valbuild/val/commit/f607bcae16723505fbd19bdfe791d3eaa1208524) Thanks [@freekh](https://github.com/freekh)! - Content analytics now works with nothing in the code: switching it on in a hosted project's settings is enough. With no `analytics` prop, `<ValProvider>` reads the setting itself -- the server render reads the `VAL_ANALYTICS` value Val's hosting hands the site, with the content version, and writes it into the page as a few bytes of JSON (`<script id="__val_analytics">`), which the browser reads back. Nothing is written while it is off.

  A layout that passes `analytics={...}` from `fetchValAnalytics()` keeps working, and what it passes wins. The browser never reads `VAL_ANALYTICS` from the environment, so it needs no `VITE_` prefix and a build never fixes it: switching it off stops the counting without a rebuild.

- Updated dependencies [[`6777ea4`](https://github.com/valbuild/val/commit/6777ea42e3164e913381cccabb1bccca3cf58243), [`357bea6`](https://github.com/valbuild/val/commit/357bea6148467838819d46daa1fb575f41365185)]:
  - @valbuild/ui@0.149.1
  - @valbuild/react@0.149.1
  - @valbuild/server@0.149.1
  - @valbuild/language-server@0.149.1
  - @valbuild/mcp@0.149.1

## 0.149.0

### Patch Changes

- Updated dependencies [[`32b3210`](https://github.com/valbuild/val/commit/32b3210c11bbd526c1882177c1870aa0be1d3ca4), [`bf24bc0`](https://github.com/valbuild/val/commit/bf24bc00e8f8c2a08538d59218d9da005943ac03)]:
  - @valbuild/ui@0.149.0
  - @valbuild/server@0.149.0
  - @valbuild/react@0.149.0
  - @valbuild/language-server@0.149.0
  - @valbuild/mcp@0.149.0

## 0.148.8

### Patch Changes

- Updated dependencies [[`213c6fc`](https://github.com/valbuild/val/commit/213c6fca9636f9b4bb54f15336a21d2ac4846a9b), [`1856a4a`](https://github.com/valbuild/val/commit/1856a4af7827794cbcd50d66a0800394bc386f87), [`1856a4a`](https://github.com/valbuild/val/commit/1856a4af7827794cbcd50d66a0800394bc386f87)]:
  - @valbuild/ui@0.148.8
  - @valbuild/react@0.148.8
  - @valbuild/server@0.148.8
  - @valbuild/language-server@0.148.8
  - @valbuild/mcp@0.148.8

## 0.148.7

### Patch Changes

- Updated dependencies [[`fb2eed8`](https://github.com/valbuild/val/commit/fb2eed8b51092cc2ad5c812bdf88b528913c824a), [`1a5ad65`](https://github.com/valbuild/val/commit/1a5ad65205ff65b54e9c5f2a7b41e24cca9fd68c)]:
  - @valbuild/core@0.148.7
  - @valbuild/react@0.148.7
  - @valbuild/ui@0.148.7
  - @valbuild/server@0.148.7
  - @valbuild/language-server@0.148.7
  - @valbuild/mcp@0.148.7
  - @valbuild/shared@0.148.7

## 0.148.6

### Patch Changes

- [#902](https://github.com/valbuild/val/pull/902) [`b580292`](https://github.com/valbuild/val/commit/b580292ac3c335b055f5ed5f18d6a12d075169c7) Thanks [@freekh](https://github.com/freekh)! - The demo has a script: `<ValApp demo={{ tours, audiences }}>`. Instead of a tour that opens by itself, the demo card asks "What brings you here?" and lists short tours for the answer, each ticked off once done. `/val?tour=<id>` starts one from a link.

  A tour can start on a page of its own (`start`). A step can ask for a new page (`moveOn: { newPage }`), write any value or add one (`moveOn: { edit, value, add }`), and show the code behind what it is about (`code`).

- Updated dependencies [[`b580292`](https://github.com/valbuild/val/commit/b580292ac3c335b055f5ed5f18d6a12d075169c7)]:
  - @valbuild/ui@0.148.6
  - @valbuild/shared@0.148.6
  - @valbuild/react@0.148.6
  - @valbuild/server@0.148.6
  - @valbuild/language-server@0.148.6
  - @valbuild/mcp@0.148.6

## 0.148.5

### Patch Changes

- Updated dependencies [[`e1e41e2`](https://github.com/valbuild/val/commit/e1e41e2f2c3a2c511299f57ac36fcae50cc35bf6)]:
  - @valbuild/ui@0.148.5
  - @valbuild/react@0.148.5
  - @valbuild/server@0.148.5
  - @valbuild/language-server@0.148.5
  - @valbuild/mcp@0.148.5

## 0.148.4

### Patch Changes

- Updated dependencies [[`7c432b3`](https://github.com/valbuild/val/commit/7c432b3f05af414bd6cbc37cd58a71a783056caa)]:
  - @valbuild/ui@0.148.4
  - @valbuild/react@0.148.4
  - @valbuild/server@0.148.4
  - @valbuild/language-server@0.148.4
  - @valbuild/mcp@0.148.4

## 0.148.3

### Patch Changes

- [#881](https://github.com/valbuild/val/pull/881) [`0139436`](https://github.com/valbuild/val/commit/0139436426142d91cbb29ec6c696dfb86f34ab9d) Thanks [@freekh](https://github.com/freekh)! - The content analytics script. With analytics on (it is off by default, and turned on in a hosted project's settings), a TanStack site counts which content each visitor's page **rendered** and which they actually **viewed** (at least half on screen for a second), and sends it to `/api/val/analytics`.

  - No cookies, no storage, no visitor IDs. Each page view also says where it came from (the referring site's host and any `utm_source` / `utm_medium` / `utm_campaign`) and whether it was a phone, tablet or desktop.
  - A page is sent as its route's pattern (`/posts/$postId`), never its address, so a path that holds something about one visitor (an order number, a token) is never stored. `startValAnalytics` takes this as `routeFor`; `ValProvider` passes TanStack's matched route.
  - Editors are never counted: nothing is sent in draft mode, in the Studio, with Val enabled, or at a proposal's address, and nothing from automated browsers. A page the browser prerenders counts nothing until it is shown.
  - The script is the new `@valbuild/react/analytics` entry, loaded only for visitors of a site with analytics on, after the page has hydrated. It imports nothing else from Val.
  - Storing the counts and showing them is part of Val's hosting, which takes these beacons before they reach the site. Anywhere else, `/api/val/analytics` checks each beacon and stores nothing; in local development, with `VAL_DEBUG=1`, it logs a line per beacon, so you can see it working.
  - `ValProvider`'s Studio check now matches `/val` and what is below it only, not every route starting with those letters (`/values`). The same fix is in `@valbuild/next`.

- [#887](https://github.com/valbuild/val/pull/887) [`eaa77e0`](https://github.com/valbuild/val/commit/eaa77e0e5028b113037e76722e25e342a8301032) Thanks [@freekh](https://github.com/freekh)! - Content analytics records the content version each page was rendered from. `<ValProvider analytics>` takes a `ValAnalytics` -- `{ enabled, contentVersion? }` -- and the `val.server.ts` Val's hosting writes returns one from `fetchValAnalytics()`, with the id of the content version the platform is serving. Every beacon carries it as `cv`, so counts can be compared across a publish. The site layout passes `fetchValAnalytics()` to the provider exactly as before.

- [#878](https://github.com/valbuild/val/pull/878) [`4d862ce`](https://github.com/valbuild/val/commit/4d862cec40288ecbc415c3c3b8d792ddd6bc1ca3) Thanks [@freekh](https://github.com/freekh)! - TanStack Start: a new analytics mode, the first step towards content analytics. It is off by default. With `<ValProvider analytics>`, content read with the hooks (`useVal`, `useValRoute`, `useValKey`) is tagged for every visitor, not only in draft mode, so each element showing content carries a `data-val-path`. The tags are added in the browser after hydration, so the HTML the server sends is unchanged and a crawler that does not run the page never sees them.

  On a site hosted by Val, analytics is a project setting: the owner turns it on in the project's settings, and the `val.server.ts` the platform writes now exports `fetchValAnalytics()` to read it. Pass it to the provider from the site layout's loader, beside `fetchValDraft()`; see the README.

- [#896](https://github.com/valbuild/val/pull/896) [`5eff8a0`](https://github.com/valbuild/val/commit/5eff8a055a4ef50d476797c28f9c3e50deb73c89) Thanks [@freekh](https://github.com/freekh)! - A demo's tour can now be written by the site: `<ValApp demo={{ tour }}>`, with each step as data (`ValDemoTourStep`), so what it says changes with the site rather than with a Val release.

  It is drawn as a ring around what a step is about, with nothing dimmed and the Studio usable underneath, and a step can move on by itself once the visitor has done what it asks:

  ```ts
  const tour: ValDemoTourStep[] = [
    {
      id: "click",
      title: "This is Val",
      body: "Click the heading on the page.",
      target: "canvas",
      page: HEADING, // outlined on the page
      moveOn: { open: HEADING },
    },
    {
      id: "type",
      title: "Change a word",
      body: "The page changes as you type.",
      field: HEADING, // ringed wherever the field is shown
      moveOn: {
        edit: true,
        path: HEADING,
        value: "Coffee, roasted this weekend",
      },
    },
  ];
  ```

  A step that moves on has **Do it for me**, which does it the way the Studio would, and **Skip**. On a phone the card is a sheet along the bottom. The Studio's own tour is unchanged.

- Updated dependencies [[`0139436`](https://github.com/valbuild/val/commit/0139436426142d91cbb29ec6c696dfb86f34ab9d), [`5eff8a0`](https://github.com/valbuild/val/commit/5eff8a055a4ef50d476797c28f9c3e50deb73c89)]:
  - @valbuild/react@0.148.3
  - @valbuild/shared@0.148.3
  - @valbuild/server@0.148.3
  - @valbuild/ui@0.148.3
  - @valbuild/language-server@0.148.3
  - @valbuild/mcp@0.148.3

## 0.148.2

### Patch Changes

- [#892](https://github.com/valbuild/val/pull/892) [`6f1eca1`](https://github.com/valbuild/val/commit/6f1eca14cd924bc7aa9cc573c690f8386b1d91bb) Thanks [@freekh](https://github.com/freekh)! - `<ValApp demo>` no longer says "This demo was built without its content" now and again, on a build that has its content. The demo started Val's server before `<ValModulesClient>` had registered the modules, and on a page that had the server's code already it read them before they were there. It now starts once `ValApp`'s children are rendered.

- [#889](https://github.com/valbuild/val/pull/889) [`dc7c8cc`](https://github.com/valbuild/val/commit/dc7c8ccd82f643e662d00225fabec411b5d39e3a) Thanks [@freekh](https://github.com/freekh)! - Val is quieter in your app's console. Errors and warnings you can act on still
  print, now prefixed with `[val]` so you can filter them. Val's own debug
  output, which used to reach your terminal and browser console, is now off by
  default. That includes the `Invalid JWT` line that printed on every request
  with an expired session cookie, the "verifying draft mode" and polling notices,
  and the Studio's sync and WebSocket chatter.

  To turn the debug output back on, for example when reporting a bug:

  - on the server, set `VAL_DEBUG=1`
  - in the browser, run `localStorage.setItem("val:debug", "1")` in the console.
    It takes effect immediately, with no reload. Remove the key to turn it off
    again.

- Updated dependencies [[`dc7c8cc`](https://github.com/valbuild/val/commit/dc7c8ccd82f643e662d00225fabec411b5d39e3a)]:
  - @valbuild/core@0.148.2
  - @valbuild/shared@0.148.2
  - @valbuild/server@0.148.2
  - @valbuild/react@0.148.2
  - @valbuild/ui@0.148.2
  - @valbuild/language-server@0.148.2
  - @valbuild/mcp@0.148.2

## 0.148.1

### Patch Changes

- Updated dependencies [[`fff5681`](https://github.com/valbuild/val/commit/fff5681b9ac9a24b873ba74ca636240d83404e46)]:
  - @valbuild/ui@0.148.1
  - @valbuild/react@0.148.1
  - @valbuild/server@0.148.1
  - @valbuild/language-server@0.148.1
  - @valbuild/mcp@0.148.1

## 0.148.0

### Patch Changes

- Updated dependencies [[`df5544c`](https://github.com/valbuild/val/commit/df5544c6e92a4c3a52765630c9de191e854ee723), [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1), [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1), [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1), [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1), [`4176757`](https://github.com/valbuild/val/commit/41767579b01849473a94779122fd39c07dd99234), [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1), [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1), [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1), [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1)]:
  - @valbuild/server@0.148.0
  - @valbuild/shared@0.148.0
  - @valbuild/ui@0.148.0
  - @valbuild/mcp@0.148.0
  - @valbuild/core@0.148.0
  - @valbuild/language-server@0.148.0
  - @valbuild/react@0.148.0

## 0.147.0

### Minor Changes

- [#816](https://github.com/valbuild/val/pull/816) [`2f09cd5`](https://github.com/valbuild/val/commit/2f09cd5e2f4fc37f06917899f24f9ad2ee8d3a8b) Thanks [@freekh](https://github.com/freekh)! - Routers can give each route parameter a schema, and a URL can say which language a page is in.

  - **`s.router(router, params, item)`** takes a schema per route parameter, by the name the route file gives it (`$slug`, `[slug]`, `{-$locale}`). Each key's parameters are validated against them, and a name the route does not have is a schema error.

    ```ts
    s.router(tanstackRouter, { locale: urlLocale, slug: s.string() }, item);
    ```

  - **`s.enum(...).locales({ ... })`** says which of the project's languages each value means, so `/nb/…` can mean `nb-NO`. The tags are checked against `locales.available` in the settings module, like `s.locale()`. On a nullable enum, a second argument names the language of a URL that leaves the segment out, which only a router parameter may use:

    ```ts
    const urlLocale = s
      .enum("nb")
      .nullable()
      .locales({ nb: "nb-NO" }, { null: "en-US" });
    ```

    A router with a locale parameter makes each page a locale scope, so the Studio and validation know which language every page is in.

  - **A route's language segment can no longer be forgotten.** In a project that declares `locales.available`, a page route with a `locale` or `lang` segment (`{-$locale}`, `[lang]`) whose module gives that parameter no schema is reported, saying what to add. Any schema answers it, so a `$lang` that is not a language is silenced with its own, e.g. `{ lang: s.enum("typescript", "python") }`. It is an ordinary validation error: the Studio still opens and `val validate` lists it, but a project that already has such a route will see it after upgrading, and it blocks publishing until the parameter has a schema.
  - **The Studio's new-page form offers a language as a list.** A route parameter whose schema is a locale is picked from the project's languages, each named in its own language, with "no prefix" where the URL may leave the segment out. Other enum parameters get a list of their values, and every parameter's description is shown under it. The URL row previews what the choice puts there.
  - **TanStack optional segments (`{-$param}`)** are now understood: route validation, `useValRoute` and the Studio's new-page form accept keys with and without the segment.

- [#876](https://github.com/valbuild/val/pull/876) [`cb04e58`](https://github.com/valbuild/val/commit/cb04e586db1e3ffd20ec1fee744561b1c8f8cffd) Thanks [@freekh](https://github.com/freekh)! - Demo mode: run the Val Studio with no account and no backend (TanStack Start).

  `<ValApp demo>` starts Val's own server in the visitor's browser tab, and the Studio talks to it there instead of to `/api/val`. Edits show up in the page as they are typed and are held in the tab's memory: nothing is sent anywhere, and a reload starts over. Images and videos can be uploaded too: a small service worker, served by `initValDemoServer()`, hands the upload and the unpublished files to the server in the tab, so an uploaded photo or video shows in the page with nothing leaving the browser. Uploads are capped by their size after encoding. Pair `<ValApp demo>` with `<ValProvider demo>` on the site and `initValDemoServer()` from the new `@valbuild/tanstack/demo` entry on the API route. In a demo the Studio opens with a guided tour, Publish explains what it would do instead of publishing, and Preview in a new tab is shown but disabled.

  Also:

  - `@valbuild/server/browser` is a new entry: Val's request handling, bundleable for a browser. The TypeScript compiler, which only publishing and history need, is loaded when they ask for it, so a browser bundle of the server is about 140 KB rather than 3.6 MB.
  - `s.image({ encode })` now scales an image down in browsers that cannot write WebP (Safari), as a JPEG or PNG in the image's own format, instead of uploading it at full size.
  - `GET /profiles` answers with no profiles, rather than an error, when edits are stored locally and no project is configured.

### Patch Changes

- Updated dependencies [[`2f09cd5`](https://github.com/valbuild/val/commit/2f09cd5e2f4fc37f06917899f24f9ad2ee8d3a8b), [`cb04e58`](https://github.com/valbuild/val/commit/cb04e586db1e3ffd20ec1fee744561b1c8f8cffd), [`cb04e58`](https://github.com/valbuild/val/commit/cb04e586db1e3ffd20ec1fee744561b1c8f8cffd)]:
  - @valbuild/core@0.147.0
  - @valbuild/shared@0.147.0
  - @valbuild/ui@0.147.0
  - @valbuild/server@0.147.0
  - @valbuild/language-server@0.147.0
  - @valbuild/mcp@0.147.0
  - @valbuild/react@0.147.0

## 0.146.4

### Patch Changes

- [#870](https://github.com/valbuild/val/pull/870) [`81f2e80`](https://github.com/valbuild/val/commit/81f2e803c4cefdf58bbe6856c06e98ace95a8e0b) Thanks [@freekh](https://github.com/freekh)! - The canvas works on a page behind your site's own login.

  A site with its own sign-in (a dashboard, an intranet, a members' area) can be edited in the canvas. The canvas is a frame on the same origin as the Studio, so it sends your site's cookies like any other tab: if you are signed in to the site, the canvas shows the page signed in as you.

  If you were not signed in, the site redirected the canvas to its login page, and the canvas then broke. That page mounted Val's whole overlay inside the canvas, a Studio inside the Studio. The canvas stayed on "Preview is not ready yet" through the sign-in and after it, until you pressed Reload. Now a page shown in the Studio's canvas counts as the canvas wherever it navigated to, so you can sign in inside the canvas and keep editing.

- Updated dependencies [[`81f2e80`](https://github.com/valbuild/val/commit/81f2e803c4cefdf58bbe6856c06e98ace95a8e0b), [`59ff6c3`](https://github.com/valbuild/val/commit/59ff6c367bc313b2bb7718b00c1641aaccab949d), [`c31f609`](https://github.com/valbuild/val/commit/c31f609fdeed79aa0e139fa4f652ba0684e96ea3)]:
  - @valbuild/shared@0.146.4
  - @valbuild/ui@0.146.4
  - @valbuild/server@0.146.4
  - @valbuild/language-server@0.146.4
  - @valbuild/mcp@0.146.4
  - @valbuild/react@0.146.4

## 0.146.3

### Patch Changes

- [#873](https://github.com/valbuild/val/pull/873) [`289b2f3`](https://github.com/valbuild/val/commit/289b2f3dc6503393697d09ba3ed802b569a914c9) Thanks [@freekh](https://github.com/freekh)! - Opening the Studio no longer flashes an empty page. The loading screen now stays
  up until the Studio is ready to be seen, instead of disappearing as soon as the
  page loaded and leaving a blank page while the Studio downloaded.

## 0.146.2

### Patch Changes

- Updated dependencies [[`e4913e1`](https://github.com/valbuild/val/commit/e4913e1f1178e09987a7c03fd540909ab4b499b0), [`04f81ba`](https://github.com/valbuild/val/commit/04f81baeee4a98054c0673ca9fdc34bc5cadacb9), [`04f81ba`](https://github.com/valbuild/val/commit/04f81baeee4a98054c0673ca9fdc34bc5cadacb9), [`04f81ba`](https://github.com/valbuild/val/commit/04f81baeee4a98054c0673ca9fdc34bc5cadacb9)]:
  - @valbuild/core@0.146.2
  - @valbuild/shared@0.146.2
  - @valbuild/server@0.146.2
  - @valbuild/ui@0.146.2
  - @valbuild/language-server@0.146.2
  - @valbuild/mcp@0.146.2
  - @valbuild/react@0.146.2

## 0.146.1

### Patch Changes

- Updated dependencies [[`2db91a5`](https://github.com/valbuild/val/commit/2db91a5d2a280727eb2b1064e853a03be283289f)]:
  - @valbuild/ui@0.146.1
  - @valbuild/react@0.146.1
  - @valbuild/server@0.146.1
  - @valbuild/language-server@0.146.1
  - @valbuild/mcp@0.146.1

## 0.146.0

### Minor Changes

- [#864](https://github.com/valbuild/val/pull/864) [`f0c7d27`](https://github.com/valbuild/val/commit/f0c7d27846c21f81ff6ce79c579185150bc0d063) Thanks [@freekh](https://github.com/freekh)! - Patch groups are removed. **Publish** now publishes every pending change, and
  the Review list shows everyone's pending changes in one list. To keep changes
  out of a publish, move them to a proposal.

  Draft reads no longer send `own_patch_groups_only`, `patch_id` or
  `include_patch_groups`, and the server no longer has the patch-group routes or
  fields. A content host that still sends them is fine: they are ignored.

### Patch Changes

- Updated dependencies [[`89b0fa8`](https://github.com/valbuild/val/commit/89b0fa82a3ae0d8ccd5d0282c1034f1f40cc4e26), [`f0c7d27`](https://github.com/valbuild/val/commit/f0c7d27846c21f81ff6ce79c579185150bc0d063)]:
  - @valbuild/ui@0.146.0
  - @valbuild/server@0.146.0
  - @valbuild/shared@0.146.0
  - @valbuild/react@0.146.0
  - @valbuild/language-server@0.146.0
  - @valbuild/mcp@0.146.0

## 0.145.1

### Patch Changes

- Updated dependencies [[`a45f595`](https://github.com/valbuild/val/commit/a45f595a5e20b009d4110bbef8ebdc08b2d731d7)]:
  - @valbuild/shared@0.145.1
  - @valbuild/ui@0.145.1
  - @valbuild/language-server@0.145.1
  - @valbuild/mcp@0.145.1
  - @valbuild/react@0.145.1
  - @valbuild/server@0.145.1

## 0.145.0

### Patch Changes

- Updated dependencies [[`b6cb939`](https://github.com/valbuild/val/commit/b6cb9395d8bdcd5182e9c6ba84f5284930de2fa5), [`f085be0`](https://github.com/valbuild/val/commit/f085be0eb5bdc195e9d8cdb15dd5f8acfdabe23c), [`dda5c52`](https://github.com/valbuild/val/commit/dda5c523698395c6dfb96ae8e39dae04307ec332), [`ac0bb7c`](https://github.com/valbuild/val/commit/ac0bb7cb5a99df022b198326a5f8a0cf61e45388)]:
  - @valbuild/core@0.145.0
  - @valbuild/shared@0.145.0
  - @valbuild/ui@0.145.0
  - @valbuild/server@0.145.0
  - @valbuild/mcp@0.145.0
  - @valbuild/language-server@0.145.0
  - @valbuild/react@0.145.0

## 0.144.12

### Patch Changes

- [#854](https://github.com/valbuild/val/pull/854) [`2193e3a`](https://github.com/valbuild/val/commit/2193e3ae133cd05dd73d0937dde7c15c88417f71) Thanks [@freekh](https://github.com/freekh)! - `useVal` and `fetchVal` on a whole `.jsonValues()` record now give every entry's content. They gave each entry back empty in production, on the server and in the browser, because the record holds only a lazy import for each entry; content showed up only where a draft or a hosted content version supplied it. They now load every entry the record names, together. `useValKey` and `fetchValKey` still load only the entry they are asked for, which is the reader to use when a page shows one entry of a large record.
- Updated dependencies [[`2193e3a`](https://github.com/valbuild/val/commit/2193e3ae133cd05dd73d0937dde7c15c88417f71)]:
  - @valbuild/ui@0.144.12
  - @valbuild/react@0.144.12
  - @valbuild/server@0.144.12
  - @valbuild/language-server@0.144.12
  - @valbuild/mcp@0.144.12

## 0.144.11

### Patch Changes

- Updated dependencies [[`c606395`](https://github.com/valbuild/val/commit/c60639571f9e836726dfef38e6bd0defc503d726)]:
  - @valbuild/ui@0.144.11
  - @valbuild/react@0.144.11
  - @valbuild/server@0.144.11
  - @valbuild/language-server@0.144.11
  - @valbuild/mcp@0.144.11

## 0.144.10

### Patch Changes

- Updated dependencies [[`0a061c1`](https://github.com/valbuild/val/commit/0a061c124408aa127c5042c9e3a602d7dd9daf13)]:
  - @valbuild/ui@0.144.10
  - @valbuild/react@0.144.10
  - @valbuild/server@0.144.10
  - @valbuild/language-server@0.144.10
  - @valbuild/mcp@0.144.10

## 0.144.9

### Patch Changes

- Updated dependencies [[`c44b561`](https://github.com/valbuild/val/commit/c44b5611cf9e557b6b744704703dbff0cb8b23b0), [`a2125af`](https://github.com/valbuild/val/commit/a2125af79d2b2401c40bce3d8fcf0431bb101cbf)]:
  - @valbuild/ui@0.144.9
  - @valbuild/server@0.144.9
  - @valbuild/shared@0.144.9
  - @valbuild/react@0.144.9
  - @valbuild/language-server@0.144.9
  - @valbuild/mcp@0.144.9

## 0.144.8

### Patch Changes

- Updated dependencies [[`6fd8f79`](https://github.com/valbuild/val/commit/6fd8f791a83d37f95dc3ae12bd8025ccf81e4a7c), [`b67c03e`](https://github.com/valbuild/val/commit/b67c03ee1876803c31098098ae0becf3f4ad6ade)]:
  - @valbuild/ui@0.144.8
  - @valbuild/server@0.144.8
  - @valbuild/react@0.144.8
  - @valbuild/language-server@0.144.8
  - @valbuild/mcp@0.144.8

## 0.144.7

### Patch Changes

- Updated dependencies [[`45ee083`](https://github.com/valbuild/val/commit/45ee0831393345dab08093575d4ed652e20e1229)]:
  - @valbuild/ui@0.144.7
  - @valbuild/server@0.144.7
  - @valbuild/react@0.144.7
  - @valbuild/language-server@0.144.7
  - @valbuild/mcp@0.144.7

## 0.144.6

### Patch Changes

- Updated dependencies [[`4e237c9`](https://github.com/valbuild/val/commit/4e237c9b66e059344fa4c800587c572d125aa8f9)]:
  - @valbuild/ui@0.144.6
  - @valbuild/react@0.144.6
  - @valbuild/server@0.144.6
  - @valbuild/language-server@0.144.6
  - @valbuild/mcp@0.144.6

## 0.144.5

### Patch Changes

- Updated dependencies [[`39e8db3`](https://github.com/valbuild/val/commit/39e8db34cf56c6c43ffff0d3acfe8e0839fa55a9)]:
  - @valbuild/ui@0.144.5
  - @valbuild/server@0.144.5
  - @valbuild/shared@0.144.5
  - @valbuild/react@0.144.5
  - @valbuild/language-server@0.144.5
  - @valbuild/mcp@0.144.5

## 0.144.4

### Patch Changes

- Updated dependencies [[`e70a261`](https://github.com/valbuild/val/commit/e70a261ed8c0938b635214721fc4e445704b1f1f)]:
  - @valbuild/shared@0.144.4
  - @valbuild/ui@0.144.4
  - @valbuild/language-server@0.144.4
  - @valbuild/mcp@0.144.4
  - @valbuild/react@0.144.4
  - @valbuild/server@0.144.4

## 0.144.3

### Patch Changes

- [#833](https://github.com/valbuild/val/pull/833) [`99fcac5`](https://github.com/valbuild/val/commit/99fcac527f2d5ba37c4b132ef08189b955d69e51) Thanks [@freekh](https://github.com/freekh)! - A draft page no longer flips back to the text from before a content-only publish.

  After content was published without a build, the Studio's overlay on a draft page started from the text compiled into the build, which still held the old content, and handed it to the page. Depending on which arrived first, an editor reloading the page saw the new text, then the old, then the new again, in a freshly opened tab and long after the publish. Visitors were not affected.

  The page now hands the overlay the content it serves (`ValDraft.base`, from the content version and any proposal's saves), and the overlay starts from that instead of the build's text, so the two never disagree.

  The same holds for `.jsonValues()` entries: where the overlay has not loaded an entry, `useValKey` and `useValRoute` now fall back to the content version's entry, as the server did, before the build's.

- Updated dependencies [[`99fcac5`](https://github.com/valbuild/val/commit/99fcac527f2d5ba37c4b132ef08189b955d69e51), [`0e09e9c`](https://github.com/valbuild/val/commit/0e09e9cdac4918bdfa1c01a92a8968a516f8c0c6)]:
  - @valbuild/ui@0.144.3
  - @valbuild/react@0.144.3
  - @valbuild/server@0.144.3
  - @valbuild/language-server@0.144.3
  - @valbuild/mcp@0.144.3

## 0.144.2

### Patch Changes

- [#832](https://github.com/valbuild/val/pull/832) [`ab0ea20`](https://github.com/valbuild/val/commit/ab0ea2046e3872c4955f34b363881f76d48d1b1e) Thanks [@freekh](https://github.com/freekh)! - A site served by Val's platform can now be given its content separately from its build. When the platform hands a TanStack app a content version (`VAL_CONTENT`) that differs from what the build bundles, Val renders that content, in the Studio and in draft mode too. It reads it the way it already reads a proposal's saved content.

  Nothing changes for an app that is not given one, and nothing hands one over yet. This is the reading side of publishing content without rebuilding the site.

  A version too large for one environment variable can name others under `refs` (`"env://VAL_CONTENT_1"`), each holding one module's Source or one file's text. Only `refs` is resolved, never a string inside your content, and only variables named `VAL_CONTENT_<n>` are read.

  At a proposal's address, a proposal's saved content is shown over the content version the site serves, so modules the proposal did not change show what the site shows rather than what the build bundles.

  When Val's platform puts a publish live without building the site, because it changed only content, the Studio shows it being checked and going live instead of "Building".

- Updated dependencies [[`ab0ea20`](https://github.com/valbuild/val/commit/ab0ea2046e3872c4955f34b363881f76d48d1b1e), [`44a5636`](https://github.com/valbuild/val/commit/44a5636955e005a40f2e6c8544e5cf4378fd0fdf)]:
  - @valbuild/server@0.144.2
  - @valbuild/shared@0.144.2
  - @valbuild/ui@0.144.2
  - @valbuild/language-server@0.144.2
  - @valbuild/mcp@0.144.2
  - @valbuild/react@0.144.2

## 0.144.1

### Patch Changes

- [#824](https://github.com/valbuild/val/pull/824) [`a641bb0`](https://github.com/valbuild/val/commit/a641bb0286756339252c53e9230d766c23fcccc6) Thanks [@freekh](https://github.com/freekh)! - `.jsonValues()` entries saved in a proposal now show at the proposal's address. Before, the page kept showing the entry as it was when the site was last built, and the Studio there showed every entry of a saved `.jsonValues()` module as empty.
- Updated dependencies [[`a641bb0`](https://github.com/valbuild/val/commit/a641bb0286756339252c53e9230d766c23fcccc6)]:
  - @valbuild/server@0.144.1
  - @valbuild/language-server@0.144.1
  - @valbuild/mcp@0.144.1

## 0.144.0

### Patch Changes

- Updated dependencies [[`a84271c`](https://github.com/valbuild/val/commit/a84271c534822071c1e428cf9990602459682d25), [`860ab2b`](https://github.com/valbuild/val/commit/860ab2b87333daf95a48215b0e4a1b44f441c878)]:
  - @valbuild/core@0.144.0
  - @valbuild/shared@0.144.0
  - @valbuild/server@0.144.0
  - @valbuild/ui@0.144.0
  - @valbuild/language-server@0.144.0
  - @valbuild/mcp@0.144.0
  - @valbuild/react@0.144.0

## 0.143.1

### Patch Changes

- Updated dependencies [[`49969c1`](https://github.com/valbuild/val/commit/49969c1e9f7c39f9cea1a97c91d59dbba6fe3f95), [`ee8e2a2`](https://github.com/valbuild/val/commit/ee8e2a23272a512b43a03fb5f61fc0ddecd61dc4), [`d6cc677`](https://github.com/valbuild/val/commit/d6cc6777cf9c2bbef3ba25e43a6227631523758e), [`54aacab`](https://github.com/valbuild/val/commit/54aacab71893a95145183e4e9fefbfac945be24d), [`2577f4e`](https://github.com/valbuild/val/commit/2577f4e8ff19f5ea155040d4d9588b2dbc756ad9)]:
  - @valbuild/ui@0.143.1
  - @valbuild/react@0.143.1
  - @valbuild/server@0.143.1
  - @valbuild/language-server@0.143.1
  - @valbuild/mcp@0.143.1

## 0.143.0

### Patch Changes

- Updated dependencies [[`f7c25bd`](https://github.com/valbuild/val/commit/f7c25bd4b44c288db8e5ab914e6d8a72c0216ba5), [`729c4ed`](https://github.com/valbuild/val/commit/729c4edfa28f5a2942c435ccf225e65858b080cc), [`8cadf84`](https://github.com/valbuild/val/commit/8cadf840e8a47168172286ce6a9ac4b15dfe596c)]:
  - @valbuild/core@0.143.0
  - @valbuild/ui@0.143.0
  - @valbuild/language-server@0.143.0
  - @valbuild/mcp@0.143.0
  - @valbuild/react@0.143.0
  - @valbuild/server@0.143.0
  - @valbuild/shared@0.143.0

## 0.142.0

### Patch Changes

- [#805](https://github.com/valbuild/val/pull/805) [`fa03698`](https://github.com/valbuild/val/commit/fa03698ef0f2c7a6df334b4ba0e41843bde60029) Thanks [@freekh](https://github.com/freekh)! - Groundwork for proposals on the Val platform: a server can be told it is running at a proposal's address (`proposal` in the http options, `proposalFromEnv` to read it from the platform). There, the content the proposal has saved replaces the bundled content for those modules on every read, edits go to the proposal's branch, and Save commits to the proposal instead of the site. Nothing changes for a site that is not given a proposal.
- Updated dependencies [[`1ec4ff4`](https://github.com/valbuild/val/commit/1ec4ff4165a33f2248b52608ff58e626523e4212), [`1671bce`](https://github.com/valbuild/val/commit/1671bce6f0b65dac77e51655f24ef825f4671ebb), [`bb63738`](https://github.com/valbuild/val/commit/bb63738aabed1cf1287611ecaab7c35fc4b08a12), [`fa03698`](https://github.com/valbuild/val/commit/fa03698ef0f2c7a6df334b4ba0e41843bde60029), [`3d2b9e8`](https://github.com/valbuild/val/commit/3d2b9e8c11aa6a4449527e2a1bbb363566797a14), [`a3236a5`](https://github.com/valbuild/val/commit/a3236a5f2c41b92422b40340dba060b53218c6ab), [`f14e0aa`](https://github.com/valbuild/val/commit/f14e0aabedba07b832b1453d49635af5d2fbc019), [`521fe94`](https://github.com/valbuild/val/commit/521fe9400c0b660aa5b3642942cd0cc26622f193)]:
  - @valbuild/server@0.142.0
  - @valbuild/ui@0.142.0
  - @valbuild/shared@0.142.0
  - @valbuild/language-server@0.142.0
  - @valbuild/mcp@0.142.0
  - @valbuild/react@0.142.0

## 0.141.1

### Patch Changes

- Updated dependencies [[`6faacda`](https://github.com/valbuild/val/commit/6faacda398fc92bec187b7afe07a53228a6f2a3b), [`14b18d7`](https://github.com/valbuild/val/commit/14b18d7cb145cec1bc1cd832b9ca857ff4b45adc)]:
  - @valbuild/ui@0.141.1
  - @valbuild/server@0.141.1
  - @valbuild/react@0.141.1
  - @valbuild/language-server@0.141.1
  - @valbuild/mcp@0.141.1

## 0.141.0

### Minor Changes

- [#779](https://github.com/valbuild/val/pull/779) [`ba3f330`](https://github.com/valbuild/val/commit/ba3f3300a3dd8649e154097cdfca3b64db209d89) Thanks [@freekh](https://github.com/freekh)! - New: `s.video()`, for mp4/WebM files and HLS streams.

  ```ts
  const schema = s.object({
    intro: s.video({ stream: { type: "hls" } }),
  });
  ```

  - **Upload and play in the Studio.** A video field shows a player, the file's size and length, and progress while it uploads.
  - **HLS streaming without a video service.** With `stream: { type: "hls" }`, the Studio converts an upload to an HLS stream in the editor's browser before it uploads it. It makes one H.264 rendition per height (1080p, 720p and 480p by default, and never larger than the upload) and stores them as a folder of files next to your other uploads. Nothing is installed in your app for this: the converter ships inside the Studio and is only downloaded when someone uploads to a streaming field. A browser that can't convert (no WebCodecs, or a non-https address) uploads the original file and says so.
  - **Poster:** pause on a frame and choose "Use current frame". The frame is saved as an image, and `posterTime` records where it was taken.
  - **Start and end:** play part of a video without cutting the file.
  - **Focal point:** marks what must stay in frame when the page crops the video.
  - **Description:** text for people who can't see the video.
  - **Captions:** one WebVTT file per language. `.srt` files are converted on upload.
  - **`<ValVideo>`** in `@valbuild/next` and `@valbuild/tanstack` renders all of the above and is click-to-edit. For HLS in browsers that can't play it natively, pass `hls={() => import("hls.js")}`. It is only loaded when it's needed.
  - **Rename** a video in the Studio. An HLS stream is renamed as a whole: every playlist and segment moves to the new folder.
  - `npx val validate --fix` fills in `mimeType`, `width`, `height` and `duration` for a hand-written `.mp4`, `.mov`, `.webm`, `.mkv` or HLS video, on disk or on Val Remote. A remote video is not downloaded: only its headers are read, usually in one to three small requests.
  - `.remote()` works for videos. `npx val validate --fix` moves a video to Val Remote, or back into the project, together with its poster, captions and every file of an HLS stream.

  A video value always has a `mimeType`: it is how a page knows whether it has an `.mp4` or an `.m3u8`.

  New: `s.videoset()`, a collection of videos, like `s.imageset()` for images.

  ```ts
  const videosVal = c.define(
    "/content/videos.val.ts",
    s.videoset({ dir: "/public/val/videos", stream: { type: "hls" } }),
    {},
  );
  const schema = s.object({ intro: s.video(videosVal) });
  ```

  - **Upload once, set it up once, use anywhere.** A set's entry holds what is true of the file (its type, size and length) and, as defaults, a description, poster, start and end, focal point and captions. A field that picks from the set (`s.video(videosVal)`) gets all of those, and can override any of them on its own. For example, the same clip can open one page at 0:02 and every other page where the set says.
  - **Media in the Studio.** A set is listed under Media and opens as a gallery of videos, with each video's poster as its thumbnail. Hovering a video previews it, and the selected video plays in a real player (HLS streams too) beside the poster, times, focal point and captions you edit for it. You can upload into the set (with `stream`, uploads become HLS streams, and each upload gets a poster), rename a video, and delete a video that nothing uses. Renaming a video updates every field that uses it. An HLS stream is one entry, and renaming or deleting it moves or removes all of its files.
  - **Picking.** A set-backed field picks from the set, or uploads into it. Each value the set provides is marked "From gallery · Override", and once overridden, "Overridden · Use gallery's".
  - `useVal` and `fetchVal` fill in what the set holds (`mimeType`, `width`, `height`, `duration`, and every default the field does not override), so `<ValVideo>` works the same either way.
  - `.remote()` works for sets. `npx val validate --fix` fills in missing metadata for an entry, adds untracked videos found in the set's directory, and moves a set's videos to Val Remote.

  Image and file galleries use the same new gallery layout: a grid or list of entries, with the selected one open in a panel beside it.

  - An `s.imageset()` entry can hold a default focal point, as well as its description. An `s.image(galleryVal)` field shows both, and can override either.
  - Fixed: outside draft mode, `useVal` and `fetchVal` now fill a gallery-backed image or file from its gallery (dimensions, mime type, description). Before, a published page got only the `path`.

### Patch Changes

- [#801](https://github.com/valbuild/val/pull/801) [`9cbe428`](https://github.com/valbuild/val/commit/9cbe42895d006d55c3d993dc27f0779808b85306) Thanks [@freekh](https://github.com/freekh)! - Emptying a field in the preview's "On this page" list no longer removes it from the list while you are editing it.

  The list shows what the page renders, and a field you empty often renders nothing: an empty rich text, an image set to none, or a link whose label was cleared. The row you were typing in used to vanish, taking your cursor with it, and clearing a link's label also removed its URL from the list. Now a field you have worked on stays where it was, marked "Not on page", until you reload the page with the canvas's reload button or go to another page. A field you delete from the content, such as a removed list item, still goes away at once.

- Updated dependencies [[`199e214`](https://github.com/valbuild/val/commit/199e21471d98806fb34c579cb876560078c928b9), [`9cbe428`](https://github.com/valbuild/val/commit/9cbe42895d006d55c3d993dc27f0779808b85306), [`fb5f097`](https://github.com/valbuild/val/commit/fb5f09721ac07f4d90b8502fdbee3fb3884d9688), [`6473a2e`](https://github.com/valbuild/val/commit/6473a2efe874f1749b27ed6f8ac4e0d19805edb1), [`ba3f330`](https://github.com/valbuild/val/commit/ba3f3300a3dd8649e154097cdfca3b64db209d89)]:
  - @valbuild/core@0.141.0
  - @valbuild/server@0.141.0
  - @valbuild/shared@0.141.0
  - @valbuild/ui@0.141.0
  - @valbuild/language-server@0.141.0
  - @valbuild/react@0.141.0
  - @valbuild/mcp@0.141.0

## 0.140.2

### Patch Changes

- Updated dependencies [[`df1e5f5`](https://github.com/valbuild/val/commit/df1e5f5f94391f25c71839cc476a51198b90db4d)]:
  - @valbuild/ui@0.140.2
  - @valbuild/server@0.140.2
  - @valbuild/shared@0.140.2
  - @valbuild/react@0.140.2
  - @valbuild/language-server@0.140.2
  - @valbuild/mcp@0.140.2

## 0.140.0

### Patch Changes

- [#793](https://github.com/valbuild/val/pull/793) [`092e6a7`](https://github.com/valbuild/val/commit/092e6a7f78bcfcf4c6cecaf34407fdfc580ebbc1) Thanks [@freekh](https://github.com/freekh)! - A draft page on TanStack Start is now rendered as the draft by the server, so it no longer shows the published text first and the draft a moment later — most noticeable when you reload right after publishing.

  Read the request's draft in your site layout's loader and pass it to `ValProvider`:

  ```tsx
  // src/val/server.ts
  export const { fetchValDraft /* , fetchVal, ... */ } = initValContent(
    config,
    valModules,
    { draftMode },
  );

  // src/routes/_site.tsx
  const getValDraft = createServerFn().handler(() => fetchValDraft());

  export const Route = createFileRoute("/_site")({
    loader: () => (typeof document === "undefined" ? getValDraft() : null),
    component: SiteLayout,
  });

  function SiteLayout() {
    const draft = Route.useLoaderData();
    return (
      <ValProvider config={config} suspend draft={draft}>
        {/* ... */}
      </ValProvider>
    );
  }
  ```

  Visitors pay one cookie lookup and nothing else. Without `draft`, pages behave as before. Edited `.jsonValues()` entries are rendered as the draft too; the others render from the build, as they do for visitors.

  Also: a draft's `.jsonValues()` entries now include changes that were published after the build being served, instead of showing the old value until the next build is live.

  Also: a renamed or duplicated `.jsonValues()` entry now has its content in the draft, on the page and when the Studio reads the entry, instead of failing to load until it is published.

- Updated dependencies [[`cb93874`](https://github.com/valbuild/val/commit/cb938748aec15fd0ac3814c1696a2dd78ad63c27), [`092e6a7`](https://github.com/valbuild/val/commit/092e6a7f78bcfcf4c6cecaf34407fdfc580ebbc1)]:
  - @valbuild/ui@0.140.0
  - @valbuild/server@0.140.0
  - @valbuild/shared@0.140.0
  - @valbuild/react@0.140.0
  - @valbuild/language-server@0.140.0
  - @valbuild/mcp@0.140.0

## 0.139.2

### Patch Changes

- Updated dependencies [[`4d9e12c`](https://github.com/valbuild/val/commit/4d9e12c5286f981c7a8a7820db1bf580e327d2ea), [`1c3eb3a`](https://github.com/valbuild/val/commit/1c3eb3af91f6dfeff94a95d80d5291a1acf1baf2)]:
  - @valbuild/ui@0.139.2
  - @valbuild/react@0.139.2
  - @valbuild/server@0.139.2
  - @valbuild/language-server@0.139.2
  - @valbuild/mcp@0.139.2

## 0.139.1

### Patch Changes

- Updated dependencies [[`238057d`](https://github.com/valbuild/val/commit/238057d2f17a6bdd22d0bd4316dd8e3a8843a85d), [`8f08418`](https://github.com/valbuild/val/commit/8f0841882d13c991d31dfbb03dd4873c9ab636b4), [`238057d`](https://github.com/valbuild/val/commit/238057d2f17a6bdd22d0bd4316dd8e3a8843a85d), [`db13bed`](https://github.com/valbuild/val/commit/db13bed902f9f9147feb5be07ce47fe8b5b143f9), [`5ea70ce`](https://github.com/valbuild/val/commit/5ea70cefde3c74961cfa76b4a5f4c333b850b60a)]:
  - @valbuild/ui@0.139.1
  - @valbuild/core@0.139.1
  - @valbuild/server@0.139.1
  - @valbuild/shared@0.139.1
  - @valbuild/react@0.139.1
  - @valbuild/language-server@0.139.1
  - @valbuild/mcp@0.139.1

## 0.139.0

### Patch Changes

- Updated dependencies [[`3eb5031`](https://github.com/valbuild/val/commit/3eb503167ae466ee586303c95efcc14665129481)]:
  - @valbuild/core@0.139.0
  - @valbuild/shared@0.139.0
  - @valbuild/ui@0.139.0
  - @valbuild/language-server@0.139.0
  - @valbuild/mcp@0.139.0
  - @valbuild/react@0.139.0
  - @valbuild/server@0.139.0

## 0.138.6

### Patch Changes

- [#774](https://github.com/valbuild/val/pull/774) [`9d28775`](https://github.com/valbuild/val/commit/9d287750631b239b70bc7545e3b9fa9011e81db7) Thanks [@freekh](https://github.com/freekh)! - Edits no longer disappear from a site on Val Build for up to a minute after its first publish.

  For a short while after a publish, the site can still serve the previous build. If that build was the project's starting template, it was treated as though it already had the new changes, so they vanished from the page until the new build reached you. Each build now tells Val's content service which build it is, and gets exactly the changes it is missing.

- Updated dependencies [[`9d28775`](https://github.com/valbuild/val/commit/9d287750631b239b70bc7545e3b9fa9011e81db7), [`9d28775`](https://github.com/valbuild/val/commit/9d287750631b239b70bc7545e3b9fa9011e81db7)]:
  - @valbuild/ui@0.138.6
  - @valbuild/server@0.138.6
  - @valbuild/react@0.138.6
  - @valbuild/language-server@0.138.6
  - @valbuild/mcp@0.138.6

## 0.138.5

### Patch Changes

- Updated dependencies [[`c532afc`](https://github.com/valbuild/val/commit/c532afc1818ee0249ad227a7da029c3e8d06baa8)]:
  - @valbuild/ui@0.138.5
  - @valbuild/react@0.138.5
  - @valbuild/server@0.138.5
  - @valbuild/language-server@0.138.5
  - @valbuild/mcp@0.138.5

## 0.138.4

### Patch Changes

- [#771](https://github.com/valbuild/val/pull/771) [`63bff05`](https://github.com/valbuild/val/commit/63bff0589b6df42efaa63ec606688d20a9670439) Thanks [@freekh](https://github.com/freekh)! - Changes that are already published no longer briefly vanish from the Studio, or show up twice, right after a publish in app mode.

  A build the Studio makes in the browser now records which publish it was made for, so Val knows exactly which changes the running site already has. Before this, Val worked that out from whichever build was live, and was wrong for a moment while a publish was going live. A reload in that moment could hide changes that were not on the site yet, or apply ones that were a second time. Projects set up before this release need no changes.

- Updated dependencies [[`63bff05`](https://github.com/valbuild/val/commit/63bff0589b6df42efaa63ec606688d20a9670439), [`0a885b1`](https://github.com/valbuild/val/commit/0a885b1f0304517b167b959958464066194732d0), [`8b1e47e`](https://github.com/valbuild/val/commit/8b1e47e50f9556d8469358af93ba32a084e2e131), [`58d13a2`](https://github.com/valbuild/val/commit/58d13a2a534421b341b1bf71d02f0a2290fc0d61), [`4268beb`](https://github.com/valbuild/val/commit/4268beb4beec53cb52584f59f9bbd5ffdcc9095d), [`e79451f`](https://github.com/valbuild/val/commit/e79451faab37f46e2039d681a19eea06d537dc44)]:
  - @valbuild/ui@0.138.4
  - @valbuild/server@0.138.4
  - @valbuild/shared@0.138.4
  - @valbuild/react@0.138.4
  - @valbuild/language-server@0.138.4
  - @valbuild/mcp@0.138.4

## 0.138.3

### Patch Changes

- Updated dependencies [[`a6cefc8`](https://github.com/valbuild/val/commit/a6cefc870436c9f981d6b831c318416eb6f506e6), [`9d062c2`](https://github.com/valbuild/val/commit/9d062c23597d47d80b66a94091442c5409e7e415)]:
  - @valbuild/ui@0.138.3
  - @valbuild/react@0.138.3
  - @valbuild/server@0.138.3
  - @valbuild/language-server@0.138.3
  - @valbuild/mcp@0.138.3

## 0.138.2

### Patch Changes

- [#762](https://github.com/valbuild/val/pull/762) [`3dd8e35`](https://github.com/valbuild/val/commit/3dd8e3539213505fdb03378d4a0145ae12749943) Thanks [@freekh](https://github.com/freekh)! - The TanStack Start toolchain `@valbuild/tanstack` is developed and tested against is now `@tanstack/react-start@1.168.60` (with `@tanstack/react-router@1.170.41`), the first release with the fix for the XSS vulnerability [GHSA-qx66-fv34-fjm8](https://github.com/advisories/GHSA-qx66-fv34-fjm8) (CVE-2026-102989), which affects `@tanstack/react-start` `>=1.143.12 <1.168.60`.

  `@valbuild/tanstack` does not bring TanStack Start with it — your app's own `@tanstack/react-start` is the one that ships — so **upgrade it to `>=1.168.60`** (`pnpm add @tanstack/react-start@^1.168.60 @tanstack/react-router@^1.170.41`) and check that your lock file no longer resolves an older one, including `@tanstack/start-server-core` below `1.169.39`. Vercel blocks deploys whose dependency tree contains a vulnerable version.

- Updated dependencies [[`2beb226`](https://github.com/valbuild/val/commit/2beb226446c76eb71026f43e04c13943da4a1e31), [`cf3bbc8`](https://github.com/valbuild/val/commit/cf3bbc8fc89ff349aac5ab101d0b4f28164583e6), [`443cdcd`](https://github.com/valbuild/val/commit/443cdcdfa8948db22a54adef2ad5e18d9f9868e9)]:
  - @valbuild/ui@0.138.2
  - @valbuild/shared@0.138.2
  - @valbuild/core@0.138.2
  - @valbuild/react@0.138.2
  - @valbuild/server@0.138.2
  - @valbuild/language-server@0.138.2
  - @valbuild/mcp@0.138.2

## 0.138.1

### Patch Changes

- Updated dependencies [[`1d1bb1e`](https://github.com/valbuild/val/commit/1d1bb1e5937a4194f79e1df040cb800e6bbcb865)]:
  - @valbuild/ui@0.138.1
  - @valbuild/react@0.138.1
  - @valbuild/server@0.138.1
  - @valbuild/language-server@0.138.1
  - @valbuild/mcp@0.138.1

## 0.138.0

### Patch Changes

- Updated dependencies [[`57af895`](https://github.com/valbuild/val/commit/57af8959cc46519a405b1ed7441623f8bf2e6d27), [`c523506`](https://github.com/valbuild/val/commit/c523506c8b5e148864f401c005b913330e436499), [`6216172`](https://github.com/valbuild/val/commit/62161729aa40f737590b0a8093c0394385fffd8d), [`40e933d`](https://github.com/valbuild/val/commit/40e933da7fe01cfe1c3f4a43c156f0b2f8a11f62), [`5876fe0`](https://github.com/valbuild/val/commit/5876fe075fdee1f76f1cdaa2488ac52c58c894a8), [`c523506`](https://github.com/valbuild/val/commit/c523506c8b5e148864f401c005b913330e436499)]:
  - @valbuild/core@0.138.0
  - @valbuild/ui@0.138.0
  - @valbuild/server@0.138.0
  - @valbuild/shared@0.138.0
  - @valbuild/language-server@0.138.0
  - @valbuild/mcp@0.138.0
  - @valbuild/react@0.138.0

## 0.137.0

### Patch Changes

- [#676](https://github.com/valbuild/val/pull/676) [`43b58f2`](https://github.com/valbuild/val/commit/43b58f2962840883badf91950da2c51b89d1c7cb) Thanks [@freekh](https://github.com/freekh)! - External page keys are now validated, and `mailto:` and `tel:` are allowed.

  `externalPageRouter` documented a rule — a key must start with `https://` or
  `http://` — and never enforced it: the validator collected the errors and then
  returned an empty list, so a key like `discord.gg/val` or `/about` was accepted
  in silence and behaved as a relative link on the site.

  Fixing that made the rule itself worth looking at, because it was a rule about
  the protocol standing in for a rule about links. A contact page's email address
  and phone number are external pages to whoever maintains the list, and they
  were refused. So the rule that is now enforced is a deny list rather than an
  allow list: a key must have a scheme, and the scheme must not be one of
  `javascript:`, `data:`, `vbscript:`, `file:` or `blob:` — which are not links
  at all. An external page key ends up in an `href` in your site's own markup, so
  those stay refused however the router is configured.

  A project that wants to be stricter says so:

  ```ts
  s.record(item).router(externalPageRouter({ schemes: ["https", "mailto"] }));
  ```

  `initVal()` from `@valbuild/next` and `@valbuild/tanstack` hands you the
  callable form, so the narrowed version typechecks in an app.

  Val Studio applies the same rule while you type — it calls the same function —
  and shows a narrowed project's own list in the message.

  If your project has a key with no scheme at all, it will start showing a
  validation error on that entry. Give it one, or move it out of the external
  router.

- Updated dependencies [[`8f60073`](https://github.com/valbuild/val/commit/8f60073e5490971a615cebbe8ea1243c67e43530), [`af7a4ba`](https://github.com/valbuild/val/commit/af7a4baa63da5d8a226166377a354cf2fc0c1d77), [`48ac9f0`](https://github.com/valbuild/val/commit/48ac9f06dd59a5b4ca60232b1ef198cf42f23aa6), [`daecf41`](https://github.com/valbuild/val/commit/daecf416f51990569a47a6a9ee9174b1a57f98c2), [`43b58f2`](https://github.com/valbuild/val/commit/43b58f2962840883badf91950da2c51b89d1c7cb), [`9b09bf3`](https://github.com/valbuild/val/commit/9b09bf38c9d5912f41fec1c18aa87455fd32f616), [`e2bfc0e`](https://github.com/valbuild/val/commit/e2bfc0e40383fe25d3ec0473d1032f6264a8939f), [`9b09bf3`](https://github.com/valbuild/val/commit/9b09bf38c9d5912f41fec1c18aa87455fd32f616), [`8e49bf4`](https://github.com/valbuild/val/commit/8e49bf41ad6a8ad3b01e502fb7ce0369baa316db), [`370d0df`](https://github.com/valbuild/val/commit/370d0df7ea45aeeafb4520318018d7c4e1c040d6), [`14877a8`](https://github.com/valbuild/val/commit/14877a85c5add4daa16836470b8739180a9fe8c6), [`beda04b`](https://github.com/valbuild/val/commit/beda04bd326cbab18ed103e8d43917b16f43bd8c)]:
  - @valbuild/ui@0.137.0
  - @valbuild/server@0.137.0
  - @valbuild/shared@0.137.0
  - @valbuild/core@0.137.0
  - @valbuild/react@0.137.0
  - @valbuild/language-server@0.137.0
  - @valbuild/mcp@0.137.0

## 0.136.10

### Patch Changes

- Updated dependencies [[`fef29b0`](https://github.com/valbuild/val/commit/fef29b0d9e826e4e7e63a3ae61553137a3f9d280)]:
  - @valbuild/ui@0.136.10
  - @valbuild/server@0.136.10
  - @valbuild/shared@0.136.10
  - @valbuild/mcp@0.136.10
  - @valbuild/react@0.136.10
  - @valbuild/language-server@0.136.10

## 0.136.9

### Patch Changes

- Updated dependencies [[`c2bd7e7`](https://github.com/valbuild/val/commit/c2bd7e7e537f00a269a54b72274fe5efb81c0ae9)]:
  - @valbuild/ui@0.136.9
  - @valbuild/react@0.136.9
  - @valbuild/server@0.136.9
  - @valbuild/language-server@0.136.9
  - @valbuild/mcp@0.136.9

## 0.136.8

### Patch Changes

- Updated dependencies [[`35577be`](https://github.com/valbuild/val/commit/35577be50981fec35fc27ee9435a092a26909395)]:
  - @valbuild/core@0.136.8
  - @valbuild/ui@0.136.8
  - @valbuild/language-server@0.136.8
  - @valbuild/mcp@0.136.8
  - @valbuild/react@0.136.8
  - @valbuild/server@0.136.8
  - @valbuild/shared@0.136.8

## 0.136.7

### Patch Changes

- Updated dependencies [[`5f7a4a5`](https://github.com/valbuild/val/commit/5f7a4a5f86dfe4581fbfb402059bba70e029afdc)]:
  - @valbuild/ui@0.136.7
  - @valbuild/react@0.136.7
  - @valbuild/server@0.136.7
  - @valbuild/language-server@0.136.7
  - @valbuild/mcp@0.136.7

## 0.136.6

### Patch Changes

- Updated dependencies [[`562713a`](https://github.com/valbuild/val/commit/562713a2e972e603abb43259f40ccfbf06990fe5)]:
  - @valbuild/ui@0.136.6
  - @valbuild/react@0.136.6
  - @valbuild/server@0.136.6
  - @valbuild/language-server@0.136.6
  - @valbuild/mcp@0.136.6

## 0.136.5

### Patch Changes

- Updated dependencies [[`28a71c3`](https://github.com/valbuild/val/commit/28a71c3beb40d15d628b99959c5161cee09d1871)]:
  - @valbuild/ui@0.136.5
  - @valbuild/react@0.136.5
  - @valbuild/server@0.136.5
  - @valbuild/language-server@0.136.5
  - @valbuild/mcp@0.136.5

## 0.136.4

### Patch Changes

- Updated dependencies [[`d19b1f6`](https://github.com/valbuild/val/commit/d19b1f67360b057e63536ac020f7109bd2496389)]:
  - @valbuild/ui@0.136.4
  - @valbuild/react@0.136.4
  - @valbuild/server@0.136.4
  - @valbuild/language-server@0.136.4
  - @valbuild/mcp@0.136.4

## 0.136.3

### Patch Changes

- [#726](https://github.com/valbuild/val/pull/726) [`3b19534`](https://github.com/valbuild/val/commit/3b19534bb7aa16452a104906d9594083c3bc3e89) Thanks [@freekh](https://github.com/freekh)! - A Studio publish of a project with no repository now ships every edit that was saved, and keeps the site styled.

  - A host that embeds the project's source can hand it to Val as `projectSource` (`initValServer(..., { http: { projectSource } })`). A publish then patches that text, not text fetched from the content service at a commit, which a project with no repository does not have. The build platform's wiring passes the build's own source, so `.val.ts` can be rendered for a project made on `/new`. Before, its first save produced no files, and the build that followed carried none of the save's edits.
  - New route `GET /api/val/built-source`: the `.val.ts` text of every module changed since the running build, with every commit since it applied. The Studio builds from it, so an edit whose own publish failed, and a Finish publishing, are no longer left out of the next build.
  - A Studio build that compiles no stylesheet (a browser cannot run Tailwind `@plugin`s) keeps the live site's. A Studio save never changes a stylesheet or a component, so the live CSS is still the right one.

- Updated dependencies [[`38d24f7`](https://github.com/valbuild/val/commit/38d24f723639ee109d1007854507c4571bc82575), [`3b19534`](https://github.com/valbuild/val/commit/3b19534bb7aa16452a104906d9594083c3bc3e89), [`fa28164`](https://github.com/valbuild/val/commit/fa28164dfd1e05ff53eccf375334741d857fd2ef)]:
  - @valbuild/ui@0.136.3
  - @valbuild/server@0.136.3
  - @valbuild/shared@0.136.3
  - @valbuild/react@0.136.3
  - @valbuild/language-server@0.136.3
  - @valbuild/mcp@0.136.3

## 0.136.2

### Patch Changes

- Updated dependencies [[`f76cd56`](https://github.com/valbuild/val/commit/f76cd56b9f1c1bcc0a608a7a4de24b1e776adccb)]:
  - @valbuild/ui@0.136.2
  - @valbuild/server@0.136.2
  - @valbuild/shared@0.136.2
  - @valbuild/react@0.136.2
  - @valbuild/language-server@0.136.2
  - @valbuild/mcp@0.136.2

## 0.136.1

### Patch Changes

- [#697](https://github.com/valbuild/val/pull/697) [`5c82928`](https://github.com/valbuild/val/commit/5c82928992d29f133f81cf0704a273c0449b18f1) Thanks [@freekh](https://github.com/freekh)! - Read draft content once per request instead of once per `fetchVal`

  In draft mode, `fetchVal` resolves its selector by asking the Val server for the
  whole module tree. It did that on every call, so a page with three reads made
  three requests for three identical answers — and `fetchValRouteUrl` added a
  fourth by calling `fetchVal` again on top of the caller's own. The answer cannot
  differ between reads in one request, so it is now read once and shared. On a
  60-module project a three-read draft render goes from ~187ms to ~70ms.

  The memo is scoped to the request and nothing wider, because the response it
  holds contains the caller's own unpublished patches: React's `cache()` in a
  Next RSC, a `WeakMap` keyed on the `Request` in TanStack Start, and no caching
  at all where neither is available.

  What this does **not** change:

  - **Production is untouched.** With Val disabled the reader never calls the
    server; it resolves against the statically imported module, as before.
  - **What a draft shows is unchanged.** Same query, same patch scoping — a draft
    still shows the caller's own staged work and nobody else's.
  - **The client readers are untouched.** `useVal` already subscribed to exactly
    the modules its selector names.
  - **The server still evaluates every module per request.** Narrowing the
    request's path was measured and does not help: `/sources/~` evaluates,
    previews and validates everything and only then filters the response, so a
    narrow path returns less for the same milliseconds. That remains open.

- Updated dependencies [[`cf89e74`](https://github.com/valbuild/val/commit/cf89e7429a79c4304ecbedd4f8b571a0de0f145f), [`c219574`](https://github.com/valbuild/val/commit/c21957498f3c7f4f47cef197c5dc0d591aa744ca), [`e673b43`](https://github.com/valbuild/val/commit/e673b43feaf48b7f30881d6786c858a0cb6a44a2), [`5c82928`](https://github.com/valbuild/val/commit/5c82928992d29f133f81cf0704a273c0449b18f1), [`4450be5`](https://github.com/valbuild/val/commit/4450be570ec3a66d7d98ba273c333ca2d2f163d9), [`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef)]:
  - @valbuild/ui@0.136.1
  - @valbuild/shared@0.136.1
  - @valbuild/server@0.136.1
  - @valbuild/core@0.136.1
  - @valbuild/react@0.136.1
  - @valbuild/language-server@0.136.1
  - @valbuild/mcp@0.136.1

## 0.136.0

### Patch Changes

- Updated dependencies [[`f3a4bb7`](https://github.com/valbuild/val/commit/f3a4bb7aea604943b92545c122243798c759715c), [`1d72d00`](https://github.com/valbuild/val/commit/1d72d00a1b036959ae0f1540121701cbb2694dcb)]:
  - @valbuild/ui@0.136.0
  - @valbuild/core@0.136.0
  - @valbuild/server@0.136.0
  - @valbuild/shared@0.136.0
  - @valbuild/language-server@0.136.0
  - @valbuild/react@0.136.0
  - @valbuild/mcp@0.136.0

## 0.135.0

### Patch Changes

- [#707](https://github.com/valbuild/val/pull/707) [`c9affec`](https://github.com/valbuild/val/commit/c9affece6ae6ba62bd6c1113ed1fdab6317fa112) Thanks [@freekh](https://github.com/freekh)! - `val validate --fix` now formats with your prettier config instead of prettier's defaults

  `--fix` formatted the files it repaired by calling `prettier.format(code, { filepath })`, which never reads `.prettierrc`: `filepath` picks the parser and nothing else — only `resolveConfig`, `getFileInfo` and prettier's own CLI consult the config. On a project whose style is not prettier's default, a two-line content fix therefore arrived as a whole-file rewrite, and in a repo with a format check in CI it turned a content fix into a red build.

  There is now one implementation of "format a written file the way this project does", `createPrettierFormatter`, exported from `@valbuild/server` and re-exported by `@valbuild/next/server` and `@valbuild/tanstack/server`. It resolves `.prettierrc` for each file (including any `overrides` that match it), leaves anything in `.prettierignore` untouched, and falls back to prettier's defaults when the project has no config. `val validate --fix` uses it, so the CLI and the Studio can no longer disagree about formatting.

  Use it for your app's `formatter` too — this is the recommended setup, and it replaces reading `.prettierrc.json` by hand:

  ```ts
  import prettier from "prettier";
  import {
    initValServer,
    createPrettierFormatter,
  } from "@valbuild/next/server";

  const { valNextAppRouter } = initValServer(
    valModules,
    { ...config },
    {
      draftMode,
      formatter: createPrettierFormatter(prettier, {
        projectRoot: process.cwd(),
      }),
    },
  );
  ```

  Existing `formatter` callbacks keep working unchanged.

- Updated dependencies [[`c9affec`](https://github.com/valbuild/val/commit/c9affece6ae6ba62bd6c1113ed1fdab6317fa112), [`72a7ca7`](https://github.com/valbuild/val/commit/72a7ca78354fff00e37a51359b17fba9334dc5e6)]:
  - @valbuild/server@0.135.0
  - @valbuild/language-server@0.135.0
  - @valbuild/mcp@0.135.0

## 0.134.1

### Patch Changes

- Updated dependencies [[`821e789`](https://github.com/valbuild/val/commit/821e789c1af47510af5d23eb96384ff78ddd7646)]:
  - @valbuild/shared@0.134.1
  - @valbuild/language-server@0.134.1
  - @valbuild/mcp@0.134.1
  - @valbuild/react@0.134.1
  - @valbuild/server@0.134.1
  - @valbuild/ui@0.134.0

## 0.134.0

### Minor Changes

- [#690](https://github.com/valbuild/val/pull/690) [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2) Thanks [@freekh](https://github.com/freekh)! - Read a view with `useVal` / `fetchVal`.

  A `s.view()` field reads as a pointer with no properties on it. It can now be handed to a reader, which resolves it to the module it names:

  ```tsx
  const page = useVal(pageVal);
  const header = useVal(page.header); // the header module's content, typed
  ```

  The point is single source of truth rather than a new capability: the page declares which module it shows, and a component follows that declaration instead of importing the target a second time. Change `s.view(headerVal)` to `s.view(navVal)` and the reader follows; an import would have kept reading the header.

  The readers that take a MODULE rather than a value follow the same rule — `useValKey`, `useValRoute`, `useValRouteUrl` and the `fetchVal*` counterparts, in both the Next and TanStack packages:

  ```tsx
  const page = useVal(pageVal);
  const note = useValRoute(page.notes, params); // the router module the view names
  ```

  Works in draft mode, including when the page itself has a pending edit. Two things to know:

  - **Resolve a handle in the component that read the module containing it.** A handle carries the module it points at, and that cannot survive serialization — so one passed from a server component to a client component as a prop arrives empty. It throws with an explanation rather than handing back the pointer. This is why it throws rather than returning nothing: every one of the route and key readers already uses `null` / `undefined` to mean "no such entry", so a quiet answer would be indistinguishable from a 404.
  - **`ValView<Source>` is now a member of `SelectorSource`**, since a reader accepts one.

### Patch Changes

- [#708](https://github.com/valbuild/val/pull/708) [`be78a9b`](https://github.com/valbuild/val/commit/be78a9b51678439f7ecb1c7f3887f9e8e1261a13) Thanks [@freekh](https://github.com/freekh)! - Fix `gitCommit` and `gitBranch` in `val.config.ts` never reaching the server,
  and make them the one way to say it.

  `val.config.ts` has had `gitCommit` and `gitBranch` for as long as it has had
  anything, and a deployed app that set them resolved to no repository at all.
  Nothing failed and nothing was logged: the commit was simply never sent, and
  every patch the project saved recorded none.

  ```ts
  // val.config.ts — the normal Vercel shape, and it did nothing
  initVal({
    project: "org/project",
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA,
    gitBranch: process.env.VERCEL_GIT_COMMIT_REF,
  });
  ```

  The two halves never met. The server wanted a nested
  `git: { commit, branch }`, `val.config.ts` offered two flat keys, and nothing
  mapped one onto the other — so the only thing that worked was
  `VAL_GIT_COMMIT` / `VAL_GIT_BRANCH` in the environment.

  Rather than teach the server to read both, the nested option is gone:
  `ValApiOptions` and TanStack's `ValHttpMode` now take `gitCommit` and
  `gitBranch`, the same two names `ValConfig` uses. There is one name for this
  now, wherever it is set. The framework bindings already hand the server
  `{ versions, ...config }`, so a project's config keys arrive with nothing to
  map, and a host passing them directly is saying the same thing in the same
  words.

  Flat because of where these values come from. A platform supplies them as
  `process.env.VERCEL_GIT_COMMIT_SHA` and friends, typed `string | undefined`,
  and two optional strings take that as it comes — a nested object makes every
  caller write the ternary that turns two maybe-strings into one maybe-object.

  **Breaking for a host that passed `git` itself**, which is the nested option on
  `ValApiOptions` and on TanStack's `http` mode. An app that only configures
  `val.config.ts` or the environment is unaffected.

  ```ts
  // before
  initValServer(valModules, config, {
    http: { apiKey, valSecret, git: { commit, branch } },
  });

  // after
  initValServer(valModules, config, {
    http: { apiKey, valSecret, gitCommit: commit, gitBranch: branch },
  });
  ```

  **What a commit is for**, and why its absence is worth a release rather than a
  shrug: publishing turns pending patches into new `.val.ts` text, and to patch a
  file you must first read it — at a commit. A project with none is a project
  whose publishes read whatever the content service last had, rather than the
  revision the deployed code was built from.

  **One more behaviour change.** A commit and a branch have always been taken
  together or not at all, and that check now sees config-supplied values too. A
  project that sets exactly one of `gitCommit` and `gitBranch` used to have both
  quietly ignored and will now be refused at startup, naming the missing half.
  That is the configuration that would otherwise fail later, at a publish.

- Updated dependencies [[`be78a9b`](https://github.com/valbuild/val/commit/be78a9b51678439f7ecb1c7f3887f9e8e1261a13), [`1c31dcc`](https://github.com/valbuild/val/commit/1c31dcca7f1bb0199350567fd579de29f48bb26d), [`688b9e3`](https://github.com/valbuild/val/commit/688b9e36b821323cda6870cdff03dd36ec3e782f), [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2), [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed)]:
  - @valbuild/server@0.134.0
  - @valbuild/ui@0.134.0
  - @valbuild/core@0.134.0
  - @valbuild/react@0.134.0
  - @valbuild/shared@0.134.0
  - @valbuild/language-server@0.134.0
  - @valbuild/mcp@0.134.0

## 0.133.0

### Minor Changes

- [#700](https://github.com/valbuild/val/pull/700) [`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83) Thanks [@freekh](https://github.com/freekh)! - http mode no longer needs a git repository

  A Val app can now run in http mode with no commit and no branch — its content
  service is the store of record, and git is an optional mirror of the code. This
  is what `fs` mode has always done: it has never had git, and it works.

  Before this, `VAL_API_KEY` and `VAL_SECRET` were not enough. `VAL_GIT_COMMIT`
  and `VAL_GIT_BRANCH` were required too, so a deployment with no commit to name
  either threw at boot or fell through to `fs` mode and reached for a working
  tree that was not there.

  **Breaking, if you pass `http` options in code.** `gitCommit` and `gitBranch`
  are replaced by one optional `git`:

  ```diff
   initValServer(valModules, config, {
     http: {
       apiKey,
       valSecret,
  -    gitCommit: process.env.VAL_GIT_COMMIT,
  -    gitBranch: "main",
  +    // Only for a project whose content is mirrored into a repository.
  +    // Omit it entirely otherwise.
  +    git: { commit: process.env.VAL_GIT_COMMIT, branch: "main" },
     },
   })
  ```

  `VAL_GIT_COMMIT` and `VAL_GIT_BRANCH` still work and are still read; they are
  simply no longer required. Set both or neither — a commit without a branch, or
  a branch without a commit, is refused at startup with a message naming the
  missing half, rather than failing later at a publish.

  **What a commit is for, where you have one.** Turning pending patches into new
  `.val.ts` text means reading the current text first, and that read goes to the
  content service at that commit. It is the publish path, not the serving path: a
  committed render reads the source compiled into the build and asks the content
  service nothing. With no repository there is nothing to write `.val.ts` into,
  so a publish records the module's data and its schema and skips the file — and
  that data is what history reads, so nothing is lost.

  **A publish can now be refused by name, before it is attempted.** If a project
  mirrors its commits into a repository but the running deployment was built
  before that repository existed, it has no commit to write the mirror against.
  Publishing anyway would save the content and silently leave the repository
  behind. The Studio now disables Publish and shows why, and `/save` refuses with
  a `no-base` code instead of failing partway.

  **Also:** `ValCommit` and `HistoricalCommit` have nullable `parentCommitSha`
  and `clientCommitSha`, and `/stat`'s `commitSha` is optional. A root commit has
  no parent, and a publisher with no repository does not report where it was. If
  you read these fields, handle `null`.

### Patch Changes

- Updated dependencies [[`2b9a51b`](https://github.com/valbuild/val/commit/2b9a51b7dbe2dff53b7686a4f3b7eb9bc5784fae), [`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83)]:
  - @valbuild/ui@0.133.0
  - @valbuild/server@0.133.0
  - @valbuild/shared@0.133.0
  - @valbuild/react@0.133.0
  - @valbuild/language-server@0.133.0
  - @valbuild/mcp@0.133.0

## 0.132.1

### Patch Changes

- Updated dependencies [[`c9a5cd3`](https://github.com/valbuild/val/commit/c9a5cd3a4ab5908ecb9757b7a95db17a77e3b173), [`f413c5c`](https://github.com/valbuild/val/commit/f413c5cebca27ba82052825abc8c632b6177747e), [`1ddf245`](https://github.com/valbuild/val/commit/1ddf245ec73ad5af8099c3d18d4d33c6a1cc1254), [`a19997a`](https://github.com/valbuild/val/commit/a19997a542e65cc1375837b1bdb11c8af9e10160), [`c07b1ab`](https://github.com/valbuild/val/commit/c07b1abe30e226c80ef7ec4b4f0f5ccdae061c11), [`76c5d41`](https://github.com/valbuild/val/commit/76c5d41c3afa7cc8180d156c9e19fb082af7fba4), [`cbfa2b8`](https://github.com/valbuild/val/commit/cbfa2b884898f1603bde8e5aa5cd9da78778101f), [`f2ac188`](https://github.com/valbuild/val/commit/f2ac1887c11397b597081eef7206063b52b21c5b), [`003419a`](https://github.com/valbuild/val/commit/003419ab72f3069d92e67dfea931d5accc63e730)]:
  - @valbuild/ui@0.132.1
  - @valbuild/server@0.132.1
  - @valbuild/language-server@0.132.1
  - @valbuild/react@0.132.1
  - @valbuild/mcp@0.132.1

## 0.132.0

### Minor Changes

- [#689](https://github.com/valbuild/val/pull/689) [`c1c93c1`](https://github.com/valbuild/val/commit/c1c93c1431072b37b4098bcdc49ebe207e3a28d5) Thanks [@freekh](https://github.com/freekh)! - `initValContent` takes an `http` option, so the content readers can be put in
  http mode.

  They build a Val server of their own — they resolve content by asking it, not by
  calling the API over HTTP — so the mode question is put to them separately.
  `initValServer` has had `http` for a while; these readers did not, which meant a
  host could configure its API for http mode and leave the half of Val that
  renders its pages inferring a mode instead. Where the credentials are handed to
  Val in code rather than through the environment there is nothing to infer from,
  because `process.env.VAL_API_KEY` is undefined in a bundle built separately from
  its dependencies.

  Pass the same object both halves get. `gitCommit` is the field that is silently
  wrong rather than loudly missing: every read in this mode fetches the module's
  path from the content service at that commit, so readers given a different one
  from the API resolve a different version of the same file — a draft render
  showing content that is neither the draft nor what the site serves, with nothing
  failing anywhere.

### Patch Changes

- [#689](https://github.com/valbuild/val/pull/689) [`d0d684b`](https://github.com/valbuild/val/commit/d0d684bdd62d2d9a2cddff38beadf9175f55bf91) Thanks [@freekh](https://github.com/freekh)! - A probe for the seams a host that BUILDS rather than deploys depends on.

  `examples/tanstack/scripts/hostPublishProbe.ts` configures both halves of Val in
  `http` mode and drives a publish through `publishOverride`, against
  `e2e/mock-content-host`. Nothing exercised those two together: `e2e/http/` drives
  the Studio, and `publishOverride` has no UI to drive it from.

  What it pins is the ordering. A host whose publish is a build must commit
  _first_ — building first hands its builder content the content service does not
  have yet, so every read in the new build resolves the commit from before the
  save, and the site shows pre-save content with the edits already consumed, with
  nothing failing to say so.

  No product code changed.

- Updated dependencies [[`72cc676`](https://github.com/valbuild/val/commit/72cc6765e92a6e72b5c09ddd9eed8efa7ce899f2)]:
  - @valbuild/server@0.132.0
  - @valbuild/language-server@0.132.0
  - @valbuild/mcp@0.132.0

## 0.131.0

### Minor Changes

- [#686](https://github.com/valbuild/val/pull/686) [`0d5857b`](https://github.com/valbuild/val/commit/0d5857b731e11f7e6a011f79297df6485908c31f) Thanks [@freekh](https://github.com/freekh)! - Say `VAL_MODE=memory` where there is no disk, and get a sentence instead of an `EPERM`

  Memory mode — the one for a host that holds the project's source itself — is
  selected by passing `sourceFiles`, and it has to be: nothing in an environment
  can supply a project's source, so a mode that an env var could switch on would
  be a server with no content in it.

  The cost was the failure when a host forgot. Val inferred `fs` mode, `fs` mode
  went looking for a working tree, and in a Worker isolate the first thing to
  touch the disk failed:

  ```
  patch-error /bundle/.val/patches.lock: EPERM
  ```

  That names a path two layers below the decision that caused it, and nobody
  reading it would guess "your server was configured for the wrong mode".

  So an environment can now DECLARE that it has no disk:

  ```
  VAL_MODE=memory
  ```

  It does not turn memory mode on. It says the host is supposed to be supplying
  `sourceFiles`, so if none arrive, Val refuses at configuration time and says
  where to pass them. `VAL_MODE=` counts as unset, the way a shell means it; any
  other value is refused rather than ignored, since leaving you in `fs` mode is
  the exact failure this is meant to catch.

  **`initValContent` takes the same options, and this is the release that
  noticed.** It builds a Val server of its own — these readers resolve content by
  asking it, not by calling the API over HTTP — so configuring `initValServer`
  alone left them inferring `fs` mode. On a host with no filesystem that is a
  reader looking for a working tree that is not there; it went unnoticed because
  published reads still worked.

  ```ts
  const patchStore = new InMemoryPatchStore(); // now exported from this package

  const { valApiHandler, draftMode } = initValServer(valModules, config, {
    sourceFiles: FILES,
    patchStore,
    unsafelyAllowUnauthenticated: true,
  });

  const { fetchValStega } = initValContent(config, valModules, {
    draftMode,
    // The same three. Two patch stores are two sets of pending edits, and a
    // reader that checks a session the host never issues answers itself 401 and
    // falls back to published content — a draft render showing the live site.
    sourceFiles: FILES,
    patchStore,
    unsafelyAllowUnauthenticated: true,
  });
  ```

  All three are optional. Left out, this reader gets its own store and its own
  answer about authentication, which is right for published content.

  `@valbuild/next` has no memory mode: its `initValServer` takes neither option,
  so for a Next app `VAL_MODE=memory` names an environment Val cannot serve from,
  and the error says so.

  Nothing changes for an app that sets none of this: `http` when `VAL_API_KEY`
  and `VAL_SECRET` are both present, `fs` otherwise, as before.

### Patch Changes

- Updated dependencies [[`0d5857b`](https://github.com/valbuild/val/commit/0d5857b731e11f7e6a011f79297df6485908c31f)]:
  - @valbuild/server@0.131.0
  - @valbuild/language-server@0.131.0
  - @valbuild/mcp@0.131.0

## 0.130.0

### Minor Changes

- [#684](https://github.com/valbuild/val/pull/684) [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75) Thanks [@freekh](https://github.com/freekh)! - A third ValOps mode, for a host that already holds its own source

  EXPERIMENTAL. `fs` mode assumes a working tree it can watch and write; `http`
  mode assumes Val's content service owns the patch chain and that a commit is a
  git commit. A host that builds and publishes its own output is neither: it holds
  the source already, it has nowhere to watch, and its "commit" is a new build.

  Forcing such a host into `fs` mode cost three things, all now fixed: `/stat`
  long-polled against watchers that could never fire, burning CPU for the whole
  hold to learn nothing;
  `/api/val/enable` 500'd; and every read of a `.val.ts` went through a shimmed
  filesystem when the host could simply hand the source over.

  `ValOpsMemory` takes the source as `sourceFiles`, refuses the local binary
  members by name — this configuration uses Val's remote files — and answers the
  history members with the same closed `not-supported-in-fs-mode` error `ValOpsFS`
  gives, so the History UI degrades the way it already knows how rather than
  inventing a commit list.

  `getStat` still long-polls -- the hold is what paces the client, and an earlier
  version that answered immediately turned a 20-second poll into a request every
  6ms -- but it parks on a SIGNAL rather than a timer. This mode owns its store,
  so it is told when something changes: no timers while parked, and a patch
  written by another tab is seen at once rather than up to 250ms later.

  Two seams come with it. `commitPrepared` lets a host take what a save produced
  instead of a git commit, and `publishOverride` lets a publish be something other
  than a push. Both are opt-in; an app that sets neither behaves exactly as before.

  The in-memory patch store is explicitly **not durable**. It is behind
  `ValPatchStore`, so a durable implementation is a swap rather than a rewrite,
  but as shipped a restart loses unpublished patches.

  **Memory mode authenticates.** `ValOps` gained `requiresAuth` alongside
  `patchesAreLocal`, because one flag was answering two questions: whether a store
  auto-saves or publishes (behaviour, reported as `mode` and keyed off by the UI),
  and whether an unauthenticated request may write (security). With two
  implementations the answers coincided — `fs` is a developer's own machine where
  no credential exists, `http` is remote — so `getAuth` was written against
  `patchesAreLocal` and returned anonymous _success_ for a missing cookie, an
  invalid JWT, an unparseable payload, or no configured secret.

  Memory mode splits them: its store is local, and it runs deployed. It therefore
  requires a verified session, like `http` mode. A host that authorises requests
  before Val sees them can opt out with `unsafelyAllowUnauthenticated`, which is
  spelled that way on purpose and warns at startup. `fs` mode is unchanged.

  Val's own MCP endpoint refuses memory mode outright. It has the same absence fs
  mode has — no credential, no backend, every permission check on the far side of
  one — and unlike fs mode it is meant to run deployed, so the existing
  "development only" and loopback guards refuse nothing. A host in this mode owns
  its own trust boundary and can offer the tools through it.

  Internally, the routes' `instanceof ValOpsFS` checks meant "is this a local
  store" — correct with two implementations and silently wrong with three. They are
  now `ValOps.patchesAreLocal` at all 17 policy sites.

### Patch Changes

- [#684](https://github.com/valbuild/val/pull/684) [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75) Thanks [@freekh](https://github.com/freekh)! - `@valbuild/tanstack` can be bundled for a browser again

  The root entry — the one every client component imports — reached TanStack
  Start's server module from inside `isValEnabled`:

  ```js
  const { getCookie } = await import("@tanstack/react-start/server");
  ```

  At runtime that is already correct anywhere but a server: the import fails, the
  `catch` returns `false`, which is what the function's documentation says it does.
  Under Vite the dynamic form also keeps it out of the client bundle.

  It does not everywhere. A host that bundles this package ahead of time and audits
  what each chunk imports sees a dynamically imported chunk as a chunk like any
  other — and this one reaches Start's SSR path and lands on `node:stream`. The
  package could not be built for a browser or a Cloudflare Worker at all, which
  made every component importing it unusable there.

  The edge is now inverted. The root entry holds a slot, `@valbuild/tanstack/server`
  fills it on import with the implementation that was already there, and the root
  entry no longer names TanStack's server module. Nothing changes for an app that
  imports `/server`, which is every app with a Val API. An `isValEnabled()` call
  before `/server` is first imported returns `false` — the same answer the old
  implementation's `catch` gave in that situation.

- Updated dependencies [[`be1e8be`](https://github.com/valbuild/val/commit/be1e8bee673207596b3eb3d9a9886b8ade9b332f), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`8425378`](https://github.com/valbuild/val/commit/8425378c315ea46b5d822f1130b633e0449ff1b0), [`7d13dbc`](https://github.com/valbuild/val/commit/7d13dbced9ea49d8243b6b6cf9854cd1a259501f), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`07db94c`](https://github.com/valbuild/val/commit/07db94c23b73c8c0b2b50a30a89926823c2da1d6), [`473a185`](https://github.com/valbuild/val/commit/473a185f70351b44388f3bc1852649e2c1dbe001), [`64f0de3`](https://github.com/valbuild/val/commit/64f0de339b8621cb5a6c422dfe55cae5b2bbe2a0), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75)]:
  - @valbuild/ui@0.130.0
  - @valbuild/server@0.130.0
  - @valbuild/mcp@0.130.0
  - @valbuild/core@0.130.0
  - @valbuild/react@0.130.0
  - @valbuild/language-server@0.130.0
  - @valbuild/shared@0.130.0

## 0.129.0

### Patch Changes

- [#655](https://github.com/valbuild/val/pull/655) [`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b) Thanks [@freekh](https://github.com/freekh)! - A project can now make Val Studio look like its own.

  `s.settings()` has a new `theme` section, edited under **Settings → Appearance**
  in the Studio. It is content like everything else: edited as a draft, shown in
  the publish diff, and the same for everyone working on the project.

  ```ts
  export default c.define("/settings.val.ts", s.settings(), {
    theme: {
      accent: "#2563eb",
      radius: "tight",
      mode: "light",
    },
  });
  ```

  **`accent` is one hex, and it restyles the whole chrome** — Publish, the active
  rail item, focus rings, switches, the caret in a rich text field, and the
  outlines the canvas draws around editable elements on your own page. Any colour
  is allowed, not a list of approved ones, because what the accent replaces is a
  ten-step ramp that is _generated_ from it: each step keeps the lightness of the
  step it replaces and changes only the hue. WCAG contrast is almost entirely a
  function of lightness, so every foreground/background pair the chrome renders
  stays at AA — which is asserted across the hue circle, pure black and a
  saturated yellow included, rather than argued for. One value drives both light
  and dark mode, since the semantic tokens pick different steps of the ramp in
  each.

  **`radius`** is `square`, `tight`, `default` or `soft`, and moves every corner
  in the Studio.

  The accent also moves the outlines the canvas draws around editable elements on
  your own page. Those are drawn inside your document, which has none of Val's
  stylesheet, so the colour is sent to the page over the canvas protocol — which
  means a project on an older `@valbuild/next` or `@valbuild/tanstack` than its
  Studio keeps Val's green there until it upgrades, rather than breaking.

  **`mode`** is the mode the Studio opens in for an editor who has never picked
  one. It never overrides an editor who has — that choice stays theirs, per
  person and per browser, behind the account button.

  Every field is optional, and unset means Val's own look, so an existing
  settings module needs no change.

  Two smaller fixes that came with it:

  - **A settings change is its own entry in the publish diff.** Editing the
    assistant's tone used to collapse the entire settings module into one change
    card labelled "Settings", because the patch that writes a settings field is
    an `add`, and `PatchSets` had no case for a settings section — so it gave up
    and grouped the whole module. Two unrelated settings edits now show as two
    changes, each under the name the panel gives it.
  - **The Val mark keeps its green.** It named a step of the brand ramp, so it
    would have recoloured along with a project's accent. It has its own token now.

- Updated dependencies [[`e20f6fb`](https://github.com/valbuild/val/commit/e20f6fbcc215c310eef49a44c1a592c1e2081613), [`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b), [`0c351c4`](https://github.com/valbuild/val/commit/0c351c4f97ae7f09772eab0e856ae69821b803b7), [`41a0d76`](https://github.com/valbuild/val/commit/41a0d76636a2dce3f1e506d93170d97e46041d98), [`9e0ebb0`](https://github.com/valbuild/val/commit/9e0ebb00430f05ef92dff031309f73b8075a7d99)]:
  - @valbuild/ui@0.129.0
  - @valbuild/core@0.129.0
  - @valbuild/shared@0.129.0
  - @valbuild/react@0.129.0
  - @valbuild/server@0.129.0
  - @valbuild/language-server@0.129.0
  - @valbuild/mcp@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [[`8b52b33`](https://github.com/valbuild/val/commit/8b52b33e1f629f14f66cc71dcc7cf415d210c7d4), [`362fb49`](https://github.com/valbuild/val/commit/362fb49f30d2b04c4ff78d54dca2bf5ad978a05c), [`c595799`](https://github.com/valbuild/val/commit/c59579977a436ec530c6c69f2b340ab9829d97ab)]:
  - @valbuild/core@0.128.0
  - @valbuild/language-server@0.128.0
  - @valbuild/mcp@0.128.0
  - @valbuild/react@0.128.0
  - @valbuild/server@0.128.0
  - @valbuild/shared@0.128.0
  - @valbuild/ui@0.127.0

## 0.127.0

### Patch Changes

- Updated dependencies [[`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65), [`600308d`](https://github.com/valbuild/val/commit/600308d0174990ad9f5c417147d160273489c65a), [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63), [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a), [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3), [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea), [`9983116`](https://github.com/valbuild/val/commit/99831164c5151aad7ca69de79e1d0d59878be251)]:
  - @valbuild/core@0.127.0
  - @valbuild/shared@0.127.0
  - @valbuild/ui@0.127.0
  - @valbuild/server@0.127.0
  - @valbuild/react@0.127.0
  - @valbuild/language-server@0.127.0
  - @valbuild/mcp@0.127.0

## 0.126.0

### Patch Changes

- [#652](https://github.com/valbuild/val/pull/652) [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a) Thanks [@freekh](https://github.com/freekh)! - `s.union` is now `s.discriminatedUnion` and `s.enum`.

  `s.union` did two unrelated jobs and worked out which one you meant from its
  first argument: a string key meant a tagged union of objects, literal schemas
  meant a set of allowed strings. Those are now two schemas with two names.

  ```ts
  // A fixed set of strings — presents as a dropdown
  s.enum("primary", "secondary", "ghost"); // Schema<"primary" | "secondary" | "ghost">

  // One of several object shapes, told apart by a tag field
  s.discriminatedUnion(
    "type",
    s.object({ type: s.literal("hero"), heading: s.string() }),
    s.object({ type: s.literal("quote"), text: s.string() }),
  );
  ```

  `s.enum` takes the strings directly, so the `s.literal(...)` wrapper is gone.

  **`s.union` still works** — it is deprecated, and it builds exactly the schema
  above, so nothing has to change today:

  ```ts
  s.union(s.literal("one"), s.literal("two")); // → s.enum("one", "two")
  s.union("type", pageA, pageB); // → s.discriminatedUnion("type", pageA, pageB)
  ```

  The two are different kinds of node, and that is the reason for the split. A
  discriminated union is a container: the selected variant's fields are the fields
  being edited, and everything that walks a schema descends through it. An enum is
  a leaf — a string with a closed domain — so nothing recurses into it. Told apart
  only by the shape of `key`, every consumer had to re-derive which one it was
  holding; each now has its own serialized type (`"discriminated-union"` and
  `"enum"`) and Val Studio has a field per kind rather than one field that
  branches.

  Two behaviour changes fall out of the split, both of them fixes:

  - A value that is not a string at all now fails an enum's validation with a
    type error. `s.union` of literals only ever checked the value against its
    literals when the value WAS a string, so a number or an object where an enum
    was declared validated clean.
  - An enum field now shows its validation errors in Val Studio where the field
    is opened on its own — the module editor and the canvas's fields column — and
    gets the compact error layout inside an inline list row. It is a leaf now, so
    it goes through the same error rendering as every other leaf field; the string
    union bypassed it and showed nothing in those places.

  Several latent crashes in the old `s.union` are fixed on the way past, all of
  them cases where it threw a `TypeError` instead of reporting:

  - A required discriminated union holding `null` now reports a type error rather
    than throwing, and resolving a path underneath a nullable one that is `null`
    gives the error the API promises instead of a crash.
  - `s.literal("")` is a legal discriminator tag, and `s.enum("")` a legal value.
    Both used to be treated as absent by a truthiness check — in path resolution,
    in stega encoding, and in the message that lists a union's valid tags. The
    editor's dropdowns handle them too: an empty value is reserved by the select
    component and had to be mapped around.
  - A variant that omits the discriminator entirely is now reported as the schema
    error it is, instead of throwing while the check looked for it.
  - An enum's value is now indexed for search, like every other string leaf. The
    old string union was never indexed at all, so searching for one of its values
    could not find the field.
  - A nullable discriminated union set to `null` no longer renders a spinner that
    never resolves.

  `s.discriminatedUnion` also requires at least one variant, as `s.enum` requires
  at least one value: a union with nothing to select is not a thing to write, and
  everything downstream reads the first variant where it needs any.

  If you read serialized schemas yourself, that is the breaking part: `type` is no
  longer `"union"`, an enum carries `values: string[]` instead of a `key` plus
  `items` of literal schemas, and `UnionSchema` is no longer a class.
  `SerializedUnionSchema`, `SerializedStringUnionSchema`,
  `SerializedObjectUnionSchema` and `UnionSchema` remain as deprecated type
  aliases.

- [#661](https://github.com/valbuild/val/pull/661) [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f) Thanks [@freekh](https://github.com/freekh)! - Every schema method now has a worked `@example` in its JSDoc, so hovering it in
  your editor shows what to write.

  That covers the whole builder surface — `.describe()`, `.validate()`,
  `.nullable()`, `.readonly()`, `.hidden()`, `.preview()`, `.render()`, and the
  per-type methods such as `.minLength()`, `.regexp()`, `.raw()`, `.multiline()`,
  `.from()` / `.to()`, `.remote()`, `.jsonValues()` and `.external()` — as well as
  `c.define()`, `c.json()`, `c.external()` and the `val` helpers (`val.attrs`,
  `val.raw`, `val.unstable_getPath` and friends).

  One of the examples corrected a real trap: a custom validator returns
  `false | string`, so the natural-looking

  ```ts
  s.string().validate((val) => val.trim() === val || "No surrounding spaces");
  ```

  does not type check — `||` yields `true`, and `true` is not one of the two
  answers. Write it as a ternary instead:

  ```ts
  s.string().validate((val) =>
    val.trim() === val ? false : "No surrounding spaces",
  );
  ```

  The examples are checked in CI, not just written: one test asks the TypeScript
  checker for the doc each method actually resolves to and fails if it has no
  `@example`, and another compiles every example it finds.

- Updated dependencies [[`719ad6b`](https://github.com/valbuild/val/commit/719ad6b607bcf136d0dbde9e90bf4b8a843561a4), [`9830277`](https://github.com/valbuild/val/commit/9830277e9aaca8da3030f629c2656ec58da47e45), [`64bfd0a`](https://github.com/valbuild/val/commit/64bfd0a6c85832ea5169b53e47087f22e193df36), [`7782979`](https://github.com/valbuild/val/commit/7782979e9b52f2015a6e72dc981e630d4f8c78e2), [`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7), [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63), [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`5c18c99`](https://github.com/valbuild/val/commit/5c18c99ecc84651f82123481fc042063db953833), [`755e1a3`](https://github.com/valbuild/val/commit/755e1a3953775cb8d2c2dce87d6810d3dc329640), [`c6b1ec8`](https://github.com/valbuild/val/commit/c6b1ec84f1883750a4cfe5f70470b177621e971f), [`656f680`](https://github.com/valbuild/val/commit/656f680043c640f678625a64e690389ab23a0a69), [`610a041`](https://github.com/valbuild/val/commit/610a0414b120b521f38a2eb1182b3778bf778b2b), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/ui@0.126.0
  - @valbuild/shared@0.126.0
  - @valbuild/server@0.126.0
  - @valbuild/core@0.126.0
  - @valbuild/react@0.126.0
  - @valbuild/language-server@0.126.0
  - @valbuild/mcp@0.126.0

## 0.125.0

### Minor Changes

- [#638](https://github.com/valbuild/val/pull/638) [`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90) Thanks [@freekh](https://github.com/freekh)! - Val now runs on TanStack Start.

  `@valbuild/tanstack` is a new package with everything `@valbuild/next` has: Val
  Studio at `/val`, the on-page overlay and canvas, draft mode, the client hooks,
  server-side content reads, images, and the MCP tools.

  ```sh
  npm install @valbuild/tanstack
  ```

  ```ts
  // val.config.ts
  import { initVal } from "@valbuild/tanstack";
  const { s, c, config, tanstackRouter } = initVal({ project: "org/project" });
  ```

  **Routes are first class.** A Val module for a route is named after the route
  file it sits beside — `src/routes/posts.$postId.tsx` is served content by
  `src/routes/posts.$postId.val.ts` — and its keys are the URLs that route serves:

  ```ts
  export default c.define(
    "/src/routes/posts.$postId.val.ts",
    s.router(tanstackRouter, s.object({ title: s.string() })),
    { "/posts/hello-world": { title: "Hello world" } },
  );
  ```

  `.` and `/` both separate segments, `$param` is a parameter, `$` is a splat, and
  `index`, `route`, `(groups)` and `_pathless` layouts add no URL segment — the
  same rules TanStack Router uses for the route file itself. Val validates every
  key against that pattern, and Val Studio shows these modules as a sitemap under
  **Pages**, where an editor can add a page.

  Point the route generator away from your content files, in `vite.config.ts` and
  `tsr.config.json`:

  ```ts
  tanstackStart({ router: { routeFileIgnorePattern: "\\.val\\.[tj]sx?$" } });
  ```

  See the [README](https://github.com/valbuild/val/blob/main/packages/tanstack/README.md)
  for the full wiring, and `examples/tanstack` for a working app.

  **Also fixed, for everyone:** `Internal.VERSION.core` was `null` in any ESM
  bundle — it was read with `require("../package.json")` inside a `try`, so the
  failure was silent. That version goes into every remote file ref and proxy mode
  refuses to start without it. Every package now reads its version through a
  static JSON import, which is inlined at build time.

  Two smaller fixes that came out of running the whole toolchain against a
  TanStack project:

  - `val versions` reports `@valbuild/tanstack`, and `val debug` writes a snapshot
    that names whichever framework package the captured project actually has.
  - `@valbuild/eslint-plugin` reads a `tsconfig.json` that has comments in it. A
    tsconfig is JSONC, and `JSON.parse` is not — so on any project whose tsconfig
    carries a comment (the TanStack starter's does) the
    `module-in-val-modules` rule threw `Expected double-quoted property name in
JSON` on the first file and took the whole lint run with it.

  Three fixes found by driving the Studio against a real TanStack app:

  - **A draft image now loads on the page.** The source the Studio pushes to the
    host page carries `patch_id` for any file whose bytes are still in a patch, so
    the page asks `/api/val/files/...?patch_id=` rather than a `/public` path that
    nothing has written yet. This was silent — the image just did not appear — and
    it affects any page that reads media through the hooks rather than on the
    server, `@valbuild/next` included.
  - **A splat route no longer logs an error on every render.** TanStack returns
    both `_splat` and `*` for the same parameter; Val reported the second as a
    parameter it could not place in the path.
  - The TanStack example and starter render a 404 page instead of throwing
    `notFound()` from a component, which escaped to the error boundary and logged
    `Error in renderToReadableStream` (and, with no not-found component
    configured, aborted the response) on every miss.

### Patch Changes

- Updated dependencies [[`22f78b4`](https://github.com/valbuild/val/commit/22f78b471fd18e542f518f72b75bd472d7c3dc52), [`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90)]:
  - @valbuild/language-server@0.125.0
  - @valbuild/core@0.125.0
  - @valbuild/shared@0.125.0
  - @valbuild/ui@0.125.0
  - @valbuild/mcp@0.125.0
  - @valbuild/react@0.125.0
  - @valbuild/server@0.125.0
