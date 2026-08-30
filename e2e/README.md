# What the e2e suite asserts on

One rule:

> **An e2e assertion reads a boundary: the DOM, an HTTP response, or an outgoing
> request. Never this client's own internals.**

Reaching into the store to _arrange_ a state is fine and stays. `patchThroughStore`
makes a `move` op that no Playwright drag can produce; `discardAll` is teardown.
The ban is on **assertions**, because that is where the flakes were.

It is enforced: `eslint.config.js` bans `chainLength`, `peekThroughStore`,
`probe`, `uploadedRefs` and `moduleSource` inside `expect(...)` and `.poll(...)`
for `e2e/**`. Six specs are grandfathered in a list that only shrinks, and the
two helper modules are permanently exempt — they _are_ the arrange and teardown.

## Why, with the receipts

Two flakes survived into CI after a week of fixing this suite. Both were the same
shape, and **both were already pinned deterministically in jest**:

| e2e flake                                   | already covered by                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `media.spec.ts` ×7 — the stale-stat phantom | `announcedNotDelivered.test.ts` → `it("waits for a second stat before saying anything")` |
| `studio-ui.spec.ts` — the debounce margin   | `useDebouncedFieldWrite.test.tsx` → `test("a burst of keystrokes is one write…")`        |

Neither was a coverage trade. Both were the same property, asserted a second time
in a browser where the clock is real and the margin is luck. The debounce one
typed five keys 60ms apart against a 250ms window — 190ms of slack per keystroke,
each a CDP round trip on a box also running `next dev`, Vite and Chromium.

The general form: **a property about time, ordering or reconciliation is a
property of a unit, and it belongs where the clock can be faked.** Put it in a
browser and you are not testing it, you are sampling it.

## The boundary is not "the DOM"

The tempting version of this rule is "assert only what a user can see". That
version would have missed the most valuable bug this suite ever caught.

Four AI write paths applied edits locally and reported success, persisting
nothing. **In the DOM that bug is invisible** — the optimistic update renders
perfectly. `studio.spec.ts:155` catches it by reading the patch back out of the
server in a separate request, and says so:

> asserting the client's own state would pass for a client that never sent
> anything, which is the bug this replaces

So HTTP counts. A response, or `page.waitForRequest` on the way out, is a
boundary: another process observes it, and it survives both UI redesigns and
store refactors. The wire format is the most stable surface in the system.

## What this rule does not fix

Worth being honest about, so nobody expects more of it than it gives:

- **It does not stop timing flakes on its own.** `canvas.spec.ts:45` was 100% DOM
  and still flaked, because `next dev` was compiling `/blogs/blog1` inside the
  assertion. That is what `warmup.setup.ts` is for.
- **It makes failures harder to read.** `Expected: 0, Received: 1` from a store
  assertion is diagnosable in minutes. `element(s) not found` — which is how
  every DOM failure arrives — is not, and twice cost a wrong diagnosis. Prefer a
  locator that names something semantic, and put the state in the failure message
  when a poll can afford it.
- **It binds the suite to churn.** `studio.spec.ts`'s own header: _"The Studio's
  markup is the least stable thing in this repository, and a test that breaks
  when a class name changes is a test people delete."_ `list-diff.spec.ts` rotted
  exactly that way when `s.array(s.string())` stopped inlining. Prefer roles and
  accessible names over structure.

## Where to put a property instead

| the property is about…                            | it belongs in                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| debounce, retry, ordering, reconciliation         | `packages/ui/spa/stores/*.test.ts`, on `testSystem`'s clock         |
| a field using a hook (the _wiring_, not the hook) | a jsdom test beside the field — see `StringField.test.tsx`          |
| a hook's own contract                             | `useDebouncedFieldWrite.test.tsx` and neighbours                    |
| a React lifecycle hazard (StrictMode remount)     | jsdom with `wrapper: StrictMode` — see `usePickingDefault.test.tsx` |
| "the browser renders it"                          | here                                                                |
| "it left the browser" / "the server has it"       | here, against `/api/val/...`                                        |

The middle two rows are the ones people skip. A hook test proves the hook
coalesces; it does **not** prove the field calls it. That seam is where three of
the four worst bugs of the store migration lived, so when a property moves out of
e2e, check that the _wiring_ moved with it and did not just evaporate —
`StringField.test.tsx`'s "a burst of keystrokes is one write" exists for exactly
that reason.
