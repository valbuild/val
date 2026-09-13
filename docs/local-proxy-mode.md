# Running the Studio in proxy mode locally

```bash
pnpm run dev:example-next:http
```

Then open the URL it prints: `http://localhost:4567/__test__/login`.

That boots `examples/next` in **proxy mode** — the mode a deployed app runs —
against a local content service, logs you in, and seeds a handful of published
commits so there is a history to look at. The ordinary
`pnpm run dev:example-next` stack on 3456 is untouched and can run at the same
time.

## Why this exists

`fs` mode is most of the product, but not all of it. These have no filesystem
equivalent and are therefore invisible in the normal dev loop:

| in proxy mode                            | in `fs` mode                   |
| ---------------------------------------- | ------------------------------ |
| a publish is a git commit                | a publish writes files to disk |
| published patches are marked applied     | published patches are deleted  |
| deployments and commits arrive over a WS | `/stat` long-polls             |
| **history and restore**                  | `not-supported-in-fs-mode`     |

History is the reason this page exists. `ValOpsFS` has no commit records of its
own — git has the files but cannot say which of a commit's changes were one
editor's patch set — so it answers `not-supported-in-fs-mode`, and `ValShell`
hides the History button entirely (`historySlot` is `undefined` in `fs` mode).
There is no amount of clicking in `pnpm run dev:example-next` that reaches the
history UI.

## What is actually running

Four processes, three of which the e2e suite already started for itself:

| process                           | port | what it is                                 |
| --------------------------------- | ---- | ------------------------------------------ |
| `e2e/mock-content-host/server.ts` | 4567 | a fake `content.val.build`                 |
| `packages/ui` (Vite)              | 5173 | the Studio SPA                             |
| `examples/next` with `VAL_*` set  | 3457 | the app, in proxy mode                     |
| `scripts/seedHistory.ts`          | —    | publishes a few commits once the app is up |

`scripts/devProxyMode.ts` imports its ports and secrets from
`e2e/http/config.ts` rather than repeating them, so the dev stack and the
`chromium-http` Playwright project cannot drift apart. Proxy mode is selected by
the environment alone — an api key and a secret mean "talk to a content
service" — so none of this needs product code or a second config file.

## The login

Proxy mode refuses every request without a signed `val_session` cookie, and the
real login round-trips through admin.val.build — the one part of the product a
content-host mock cannot stand in for. The e2e suite sidesteps this by minting a
cookie straight into a browser context, which a person cannot do.

So the mock is started with the signing secret and serves
`GET /__test__/login`, which sets the cookie and redirects to `/val`. It mints
one only when `MOCK_CONTENT_SESSION_SECRET` is set, which only this dev script
does — under Playwright the route answers 400.

A cookie's scope ignores the port, so one set by the content host on 4567 is
sent to the app on 3457. That is what makes a one-URL login possible.

```
http://localhost:4567/__test__/login                # as Ada Lovelace
http://localhost:4567/__test__/login?user=linus     # as Linus Pauling
```

Two editors, because a history where every commit has the same author does not
show what the pane has to show. Switching is just opening the other URL.

## The seeded history

The mock keeps its commits in memory and comes up empty, and an empty History
pane says nothing about the design. `scripts/seedHistory.ts` publishes:

1. **Lighten the brand colour** — one scalar field. The simplest restore.
2. **Reword the keyword list** — an array, whose items splice. This is the case
   directed restore was built for.
3. **Rename an author and retint the accent** (as Linus) — two modules in one
   commit, so whole-module restore can be exercised without the rest of it.
4. **Tighten the onboarding summary** — a nested field inside an array item.
5. **A commit pushed from CI** — no archive, so the pane has one commit it
   cannot open and has to say why.

Every one of the first four is made through `PUT /api/val/patches` +
`POST /api/val/save`, which is the path the Publish button takes. Writing
archives straight into the mock would be faster and would seed a shape the
product never produces — the UX would then be designed against fiction.

Re-seed without restarting anything:

```bash
pnpm run seed:history
```

Start with an empty list instead:

```bash
pnpm run dev:example-next:http --no-seed
```

## Things that will look like bugs and are not

- **The page does not show the new value after publishing.** The app's own
  sources come from the modules the Next process imported at startup, so
  between a commit and a redeploy a page renders the pre-publish value. That
  divergence is real in production too, which is why the mock reproduces it
  rather than papering over it.
- **The commit list is empty after restarting the content host.** It is in
  memory. Run `pnpm run seed:history`.
- **A seeded scenario is skipped with a warning.** Its patch names a path that
  has moved in `examples/next`. The warning says which scenario and what the
  server answered; fix the path in `SCENARIOS`. The rest of the history still
  publishes.

## What this is not

It is not a second implementation of history. The mock content host is a test
double for `home`, pinned by the wire-contract tests in
`packages/server/src/homeWireContract.test.ts` and driven by
`e2e/http/history.spec.ts` — so it is exercised by CI on every push and cannot
quietly drift from the service it stands in for. Nothing here is a second
source of truth about what a commit archive contains.
