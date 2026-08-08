# `.jsonValues()` manual walkthrough (V1–V20)

The verification checklist for `s.record(...).jsonValues()` / `s.router(...).jsonValues()`. The
implementation tracker is [jsonValues.md](./jsonValues.md); this file is the part a person has to run.

The Studio SPA has no component tests — `packages/ui` lacks `jest-environment-jsdom` — so every Studio
behaviour below is covered by this walkthrough and by nothing else. (`packages/next` and `packages/react`
DO have jsdom, which is why the client-hook behaviour in V19/V20's neighbourhood is partly covered by
`useValKey.draft.test.tsx`.)

Everything it needs is checked in: fixtures in `examples/next`, and a helper script for the states that
cannot be checked in (a corrupt entry, a deliberately invalid module) and for getting back to a clean
slate after a step has renamed, deleted or published something.

---

## Setup

```bash
# from the repo root, once
pnpm install
pnpm --filter @valbuild/ui build     # the Studio SPA is a BUILT bundle (~6 min).
                                     # Re-run after ANY packages/ui change, or you
                                     # will be testing the previous build.

# then
cd examples/next
pnpm fixtures status                 # what state the fixtures are in
pnpm dev                             # http://localhost:3456 — Studio at /val
```

`pnpm --filter @valbuild/ui build` does not need `pnpm preconstruct dev` afterwards (only the ROOT
`pnpm run build` does, since that one runs `preconstruct build`).

Open the Studio at **http://localhost:3456/val**.

### The fixture helper

```bash
pnpm fixtures status            # entry counts, corrupted entries, pending drafts, dirty files
pnpm fixtures generate [count]  # (re)generate the big kb record — default 120, try 1000 to stress it
pnpm fixtures corrupt [count]   # make N kb entries invalid JSON (default 3)
pnpm fixtures restore           # un-corrupt them
pnpm fixtures nested on|off     # add/remove a NESTED jsonValues module (V9 only)
pnpm fixtures reset             # discard every walkthrough edit AND all pending drafts
```

`reset` touches only the fixture paths, so it cannot throw away unrelated work. Run it whenever a step
says so, or whenever you lose track of what you have changed. **It deletes `.val/patches`, so restart the
dev server afterwards.**

### Counting `/json` requests

Most steps below assert something about requests. Two ways to see them:

**The Network tab** — filter on `api/val/json`. Good for watching what happens live; the request count is
in the status bar at the bottom. Turn OFF "Preserve log" so a reload clears it.

**The console helpers** — for the exact numbers the steps quote. Open the Studio
(http://localhost:3456/val), open DevTools (⌥⌘J on macOS, Ctrl+Shift+J elsewhere), and paste this into the
**console of the Studio page** — that is the page making the requests:

```js
// Paste once per page load. Safe to paste again: it reassigns rather than redeclares.
performance.setResourceTimingBufferSize(5000); // default is ~250: a fling test overflows it and undercounts
globalThis.jsonReqs = () =>
  performance
    .getEntriesByType("resource")
    .filter((r) => r.name.includes("/api/val/json"));
globalThis.jsonCount = () => jsonReqs().length;
globalThis.jsonKeys = () =>
  jsonReqs().map((r) => (r.name.match(/[?&]keys=/g) || []).length);
globalThis.valReset = () => performance.clearResourceTimings();
valReset();
```

Then, at any point:

| Type this     | Answers                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `jsonCount()` | how many `/json` requests since the last `valReset()`                      |
| `jsonKeys()`  | how many keys each of those asked for, e.g. `[50, 50, 20]`                 |
| `valReset()`  | zero the counter — do this immediately before the action you are measuring |
| `jsonReqs()`  | the raw entries, if you want to inspect a URL                              |

Notes:

- **A page reload clears the definitions**, so re-paste after every reload. Many steps start with "reload
  the Studio".
- A `0` in `jsonKeys()` means that request used the single-entry `?key=` shape. The Studio only uses the
  batch shape, so a `0` there is worth a raised eyebrow — the RSC runtime is the only thing that should
  use `?key=`.
- The pattern for every "zero requests" check is: **let the page settle, `valReset()`, then do the thing,
  then `jsonCount()`.** Opening a record list legitimately loads its visible rows (that is V16), so
  counting from page load instead of from a cleared counter will mislead you.

---

## What the fixtures are for

| Module                             | Kind                                                                             | Steps            |
| ---------------------------------- | -------------------------------------------------------------------------------- | ---------------- |
| `/app/support/[slug]/page.val.ts`  | jsonValues **router**, 2 hand-authored entries; RECORD-level custom validator    | V1–V7, V20       |
| `/content/kb.val.ts`               | jsonValues **record**, 120 generated entries; `keyOf` + `route` + item validator | V8, V10, V13–V19 |
| `/content/featuredContent.val.ts`  | **ordinary** module: `keyOf(kb)`, `keyOf(support)`, `route`, `keyOf(tags)`       | V10, V12         |
| `/content/tags.val.ts`             | **ordinary** record no jsonValues schema references                              | V12              |
| `/content/authors.val.ts`          | **ordinary** record that `kb`'s item schema references via `keyOf`               | V11, V13, V17    |
| `/content/nestedJsonValues.val.ts` | invalid on purpose — added by `pnpm fixtures nested on`                          | V9               |

Four facts about `kb` matter:

- Its item schema has `author: s.keyOf(authorsVal)`, so renaming an **author** is the case where the guard
  MUST load every entry first (an un-loaded entry could be the referrer).
- Its item schema has `related: s.route()`, and a route schema records no target module, so renaming ANY
  route key over-approximates to "load `kb`".
- Its `title` declares a custom validator (it rejects "forbidden"), which can only ever run from the real
  schema instance — so it is how V19 checks that path works. Every checked-in entry passes it.
- Entry **`kb-113`** is the only referrer of author `kimmid` and of route `/support/faq`, and it is far
  enough down the list that you have to scroll to it. Every other entry points `related` at `/generic`
  deliberately: if all 120 referenced a support page, deleting that page would report 120 references and no
  step could clear them.

---

## The checklist

Copy the table at the bottom into your notes and fill it in as you go.

### V1 — open the router module (SUPERSEDED)

Navigate to `/app/support/[slug]/page.val.ts`.

- [x] Both keys are listed (`/support/getting-started`, `/support/faq`).
- [ ] `jsonCount()` is **1** and `jsonKeys()` is `[2]` — one batch for both rows.

> The original V1 asked for **zero** requests on open. That is superseded: the list renders a preview per
> row, so the rows it renders are loaded. The invariant that replaced it is V16.

### V2 — open an entry, then revisit it

- [ ] `valReset()`, then open `/support/faq` → the fields render immediately, and `jsonCount()` is **0**: the
      list already loaded it.
- [ ] Navigate away and back → still **0**. Nothing refetches an entry it already has.

### V3 — edit and publish

- [ ] Change `title` on `/support/faq`, publish.
- [ ] `git status examples/next` shows **only** `app/support/[slug]/content/faq.val.json` modified —
      `page.val.ts` is untouched.
- [ ] The new title is still there **without reloading the page** (this is what the post-publish entry
      refresh exists for).
- [ ] `pnpm fixtures reset` + restart the dev server.

### V4 — add an entry

- [ ] Add `/support/new-page`.
- [ ] A new `app/support/[slug]/page/support/new-page.val.json` appears containing
      `{"title":"","body":"","order":0}` (from `emptyOf`).
- [ ] `page.val.ts` gained a `c.json(() => import("./page/support/new-page.val.json"))` thunk.
- [ ] Keep this entry for V5, then `pnpm fixtures reset`.

### V5 — hand-authored and generated entries coexist

- [ ] With V4's entry still present: `content/` (hand-placed) and `page/support/` (generated) both exist
      and both render.
- [ ] Edit `/support/faq` again → the write still goes to its ORIGINAL path,
      `content/faq.val.json` — not to the generated convention path.
- [ ] `pnpm fixtures reset` + restart.

### V6 — rename an entry

- [ ] Rename `/support/faq` → `/support/faq2`.
- [ ] `page/support/faq2.val.json` is created with the same content, `content/faq.val.json` is deleted, and
      the thunk's key AND import path both changed. (A rename always relocates to the generated path —
      locked decision #8 — so a hand-authored directory empties out. That is expected.)
- [ ] **The referrer was rewritten too:** `kb-113`'s `related` field now reads `/support/faq2`. (Its
      content had to be loaded for the guard to find it — see V11.)
- [ ] `pnpm fixtures reset` + restart.

### V7 — delete an entry

- [ ] Delete `/support/getting-started` → the popover must say **"Cannot delete: 2 references"**
      (`featuredContent.supportPage` via `keyOf`, and `featuredContent.supportRoute` by route value). Point
      both at `/support/faq`, then delete.
- [ ] Note that the guard still loaded `kb` before answering, even though no kb entry references this page:
      `kb`'s item schema contains a `route` field and a route schema names no target module, so the
      predicate has to over-approximate. That cost is expected — it is the one case the scoping rule cannot
      narrow.
- [ ] The `*.val.json` is deleted and the thunk is gone. Empty directories are left behind — `deleteFile`
      does not prune them, which is expected.
- [ ] `pnpm fixtures reset` + restart.

### V8 — a corrupt entry file

```bash
pnpm fixtures corrupt 1     # corrupts kb-000
```

- [ ] Reload the Studio and open `/content/kb.val.ts`. The `kb-000` row shows an **error with a
      `Try again` button** — not a spinner that never resolves, and not a skeleton that pulses forever.
- [ ] `jsonCount()` does not climb while you sit there: the failure is memoized, so it is requested ONCE.
- [ ] Navigate into the entry → the field shows an error, not a forever-spinner. Navigate away and back →
      still no refetch.
- [ ] `pnpm fixtures restore`, then click `Try again` → the row loads and renders its preview.

### V9 — a nested `.jsonValues()` module is rejected

```bash
pnpm fixtures nested on     # then restart the dev server
```

- [ ] The Studio refuses to load and the error **names `/content/nestedJsonValues.val.ts`**
      ("Val is not correctly setup").

```bash
pnpm fixtures nested off    # then restart the dev server
```

- [ ] The Studio loads again.

### V10 — incoming refs cost NOTHING (the common case)

`kb` is a record, not a router, and no jsonValues item schema points at it — so the guard's answer needs
only its key set, which the markers already carry.

- [ ] Open `/content/kb.val.ts`, let it settle, then `valReset()`.
- [ ] Open the delete popover on `kb-000` → it says **"Cannot delete: 1 reference"**, the references
      popover lists `featuredContent.kbEntry`, and `jsonCount()` is **0**.
- [ ] Rename `kb-000` → `kb-000-renamed` → `featuredContent.kbEntry` now reads `kb-000-renamed`, and
      `jsonCount()` is still **0**.
- [ ] `pnpm fixtures reset` + restart.

### V11 — an outgoing ref forces a load, with progress

The referrer lives INSIDE a jsonValues entry (`kb`'s `author` field), so the guard cannot answer until
every entry is loaded.

- [ ] Reload the Studio (a cold cache is the point) and go to `/content/authors.val.ts` **without opening
      `kb` first**.
- [ ] `valReset()`, then open the delete popover on author `kimmid`:
      → it shows **"Checking references"** with a percentage that climbs,
      → then settles on **"Cannot delete: 1 reference"** — `kb-113`'s `author`.
- [ ] `jsonCount()` is **3** and `jsonKeys()` is `[50, 50, 20]`: 120 entries in batches of 50, never one
      request per entry.
- [ ] Rename `kimmid` → `kimmid2` → it is allowed once the check completes, and `kb-113`'s `author` field
      is rewritten to `kimmid2`.
- [ ] `pnpm fixtures reset` + restart.

### V12 — an unrelated record: instant, and no requests

- [ ] Open `/content/tags.val.ts`, then `valReset()`.
- [ ] Delete `changelog` (referenced by nothing) → allowed immediately, no progress UI, `jsonCount()` is
      **0**.
- [ ] Open the delete popover on `guides` (referenced by `featuredContent.tag`) → blocked with 1 reference,
      also **0** requests.
- [ ] `pnpm fixtures reset` + restart.

### V13 — a failing load leaves the guard BLOCKED, never "no refs"

```bash
pnpm fixtures corrupt 3     # spread across the record; then reload the Studio
```

- [ ] Open the delete popover on author `kimmid` (cold cache) → after the load attempt it shows
      **"References to this record could not be checked"** plus a `Try again` button, and the delete button
      is NOT offered. It must never fall through to "are you sure?".
- [ ] `pnpm fixtures restore`, click `Try again` → the check completes and the popover switches to the real
      answer ("Cannot delete: 1 reference").
- [ ] `pnpm fixtures reset` + restart.

### V14 — search is lazy, then fills in

- [ ] Reload the Studio. Open search (⌘K / Ctrl+K) but type NOTHING → `jsonCount()` is **0**. Opening the
      dialog must not load anything.
- [ ] Type `kbtoken117` (only entry `kb-117`'s body contains it, and it is below the fold so it was never
      loaded):
      → the dropdown shows **"Searching… N% indexed"** with N climbing,
      → the indicator disappears when the load finishes,
      → `kb-117` appears in the results.
- [ ] While it fills, results already found stay listed — the dropdown never sits empty saying
      "No results found" while the percentage is still climbing.
- [ ] Type `article` (matches many entries) → results grow in a handful of steps as batches land, and the
      dropdown stays responsive. (The strict version of "the index is not rebuilt once per batch" is not
      observable from the UI; responsiveness is the proxy.)

### V15 — publish refreshes cached entries in batches

- [ ] Open `/content/kb.val.ts` and scroll a few screens (warming the cache), edit one visible entry's
      title, then `valReset()` and publish.
- [ ] `jsonCount()` is roughly `ceil(cached entries / 50)` — a couple of batched requests, NOT one per
      cached entry — and `jsonKeys()` shows up to 50 keys each.
- [ ] The published edit is visible without a reload.
- [ ] While the refresh is in flight, a delete popover on author `kimmid` shows "Checking references" rather
      than answering from the pre-publish content.
- [ ] `pnpm fixtures reset` + restart.

### V16 — the list loads only what it renders

- [ ] Reload, re-paste the helpers, `valReset()`, then open `/content/kb.val.ts`.
- [ ] `jsonCount()` is **1**, and `jsonKeys()[0]` is roughly the visible rows + 8 overscan — a couple of
      dozen at most, never 120.
- [ ] Rows below the fold show **skeletons** (a fixed-height pulse), not spinners or broken/empty previews,
      and have not been requested.
- [ ] Scroll slowly → about one batch per new window; the row heights do not visibly jump as content lands.
- [ ] Fling to the bottom → the number of requests is bounded by the windows that actually rendered. With
      `pnpm fixtures generate 1000` this is the real test: the count must not scale with 1000.
- [ ] Check how the nested scroll container feels: the inner scroller should not trap the page, and its
      800px cap should not be taller than your viewport. (An open question in the tracker — record what you
      see.)

### V17 — a warm cache makes the guard instant

- [ ] With `/content/kb.val.ts` open, scroll all the way to the bottom so every entry (including `kb-113`)
      has been rendered and loaded.
- [ ] `valReset()`, then rename author `kimmid` → `kimmid2`:
      → the guard reports complete **with no progress UI**,
      → `jsonCount()` is **0** (or only the few keys never rendered),
      → `kb-113`'s `author` is rewritten even though you never opened that entry.
- [ ] `pnpm fixtures reset` + restart.

### V18 — `.render({ as: "list" })` on a jsonValues record

`kb` declares a list render, and as of **Phase 7 stage 1** renders are computed client-side from the
user's own schema instances against the PATCHED source. This step should now PASS. (Before that, renders
were null Studio-wide and every list layout fell back to the default card.)

- [ ] Open `/content/kb.val.ts` → visible rows show the schema's own `title`/`subtitle` (from `select`),
      not the generic card.
- [ ] Rows below the fold are skeletons of the same height — no measurement jump as they fill in, and no
      marker ever reaches a preview component.
- [ ] Scroll → the rows fill in with real titles as their batches land.
- [ ] Edit a visible row's title WITHOUT publishing → **the row's title updates as you type.** This is the
      part the server render path could never do: the render is computed from the patched source.
- [ ] `pnpm fixtures reset` + restart.

### V19 — a custom validator runs client-side (Phase 7 stage 2)

`schema.validate(fn)` never ran in the Studio before Phase 7: client validation happens in a worker
holding a deserialized schema, and a function cannot survive serialization. `kb`'s `title` declares one
(it rejects the word "forbidden"), and every checked-in entry passes it.

- [ ] Open any `kb` entry and type `forbidden` into `title` → the error
      **"the word 'forbidden' is not allowed in a title"** appears as you type, next to the field.
- [ ] Shorten the title to one character as well → BOTH errors show (the structural `minLength(2)` and the
      custom one). The custom result must not replace the structural one, or vice versa.
- [ ] Try to publish → publish is blocked while the error stands.
- [ ] Fix the title → both errors clear.
- [ ] Open a module with no custom validators (e.g. `/content/tags.val.ts`) and edit it → nothing about the
      behaviour changes; the gate means those modules pay nothing.
- [ ] `pnpm fixtures reset` + restart.

### V20 — a record-level validator loads the entries it needs (needs-keys)

The support router declares a RECORD-level validator (a key-count rule). A record-level validator is a
statement about ALL entries, so the client cannot run it against un-loaded markers — it loads them first.
That cost is inherent, and it is why validators belong on the ITEM schema where possible.

- [ ] Reload the Studio, re-paste the helpers, open `/app/support/[slug]/page.val.ts`, then `valReset()`.
- [ ] Edit one entry's `title` → the entries get loaded (`jsonCount()` >= 1) before validation settles, and
      no error appears (2 entries is under the limit of 50).
- [ ] Nothing loops: `jsonCount()` stops climbing once the entries are in. A repeated needs-keys round
      would show up as requests that never stop.
- [ ] Break one support entry by hand (edit `app/support/[slug]/content/faq.val.json` to invalid JSON, then
      reload) and edit the OTHER entry → the console logs _"skipping custom validation — could not load the
      json entries it needs"_ ONCE and does not spin. Restore the file afterwards.
- [ ] `pnpm fixtures reset` + restart.

### C1 — `val validate` and jsonValues (KNOWN GAP, expected to fail)

Not one of the original V-steps; added because building this walkthrough turned it up. `val validate` is a
third entry point next to the Studio and the commit flow, and it has never known about `.jsonValues()`.

```bash
# make one entry schema-invalid while keeping it valid JSON
node -e 'const f="content/kb/entry-005.val.json",j=require("./"+f);j.order="not a number";j.author="does-not-exist";require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
npx val validate
```

- [ ] **Today it reports `content/kb.val.ts valid (0ms)`** — the 0ms is the tell: it validates the record's
      markers and never loads an entry. A broken `*.val.json` therefore passes CI in any project gating on
      `val validate`.
- [ ] Open the Studio on the same state → the error IS reported there (`order` must be a number, `author`
      is not a key of authors). That contrast is the gap.
- [ ] Same with `pnpm fixtures nested on` + `npx val validate` → reported valid, while the Studio refuses
      to load the project.
- [ ] `pnpm fixtures restore` (and `nested off`) when done.

Both are recorded in [jsonValues.md](./jsonValues.md) under "Known gaps found while building the
walkthrough" — re-run this step once they are fixed.

---

## Results

| Step | Result | Notes |
| ---- | ------ | ----- |
| V1   |        |       |
| V2   |        |       |
| V3   |        |       |
| V4   |        |       |
| V5   |        |       |
| V6   |        |       |
| V7   |        |       |
| V8   |        |       |
| V9   |        |       |
| V10  |        |       |
| V11  |        |       |
| V12  |        |       |
| V13  |        |       |
| V14  |        |       |
| V15  |        |       |
| V16  |        |       |
| V17  |        |       |
| V18  |        |       |
| V19  |        |       |
| V20  |        |       |
| C1   |        |       |

When you are done: `pnpm fixtures reset`, restart the dev server, and record the outcome in
[jsonValues.md](./jsonValues.md) — the Phase 6 "Verify" items and the two open questions V16 asks about
(the nested scroll container, and the row-height estimates).
