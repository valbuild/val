# Val demo

**Northbeam Coffee**: a small site and the real Val Studio beside it, for
trying Val with no account and no backend. Open `/val`, and the Studio starts
with a guided tour. Edits show up in the page as you type, and none of them
leave the browser tab.

How it works, and why it is built this way: [`docs/plans/demo-mode.md`](../../docs/plans/demo-mode.md).
In short:

- `<ValApp demo>` (at `/val`) starts Val's own server **in the tab**, in memory
  mode, and the Studio talks to it there instead of to `/api/val`. Edits are
  kept in `sessionStorage`: they survive a reload, and a new tab is a new demo.
- `<ValProvider demo>` (on the site) puts the page in the Studio's canvas into
  draft mode without a cookie, and stays out of the way everywhere else.
- The API route serves the Studio's own files and nothing else
  (`initValDemoServer` from `@valbuild/tanstack/demo`).
- Content is read with the client hooks (`useVal`, `useValRoute`) only. A
  loader on the server would never see the tab's edits.
- Publishing and uploads are off. Publish explains what it would do; picking
  an image from the gallery works.

## Run it

From the repository root, with the Studio's dev server alongside:

```bash
pnpm install
pnpm --filter @valbuild/ui run dev   # the Studio, on :5173
cd examples/demo && pnpm run dev     # the demo, on :3460
```

Then open http://localhost:3460/val.

## Edit the demo's own content

The demo is an ordinary Val project when demo mode is off:

```bash
VITE_VAL_DEMO=false pnpm run dev
```

Edits made in that Studio are written to the `.val.ts` files, ready to commit.

## The tour

The tour's stops and words are in
[`packages/ui/spa/demo/demoTour.ts`](../../packages/ui/spa/demo/demoTour.ts).
It opens on a visitor's first load of the Studio in a tab.

## Deploy (Vercel)

Create a Vercel project from this repository with **Root Directory** set to
`examples/demo`. `vercel.json` sets the build command, `pnpm run build:deploy`,
which builds Val's packages (the Studio's files are embedded in them) and then
the app. Nitro detects Vercel and writes Vercel's output format, so no
framework preset is needed. Every branch gets a preview deployment.

The Node server works the same way anywhere else:

```bash
pnpm run build:deploy && pnpm start
```

## Tests

`e2e/demo/demo.spec.ts`, the `demo` Playwright project, which runs in CI's
blocking smoke job. Every test fails a request to `/api/val` that is not one of
the Studio's own files.
