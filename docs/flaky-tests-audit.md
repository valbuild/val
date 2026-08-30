# Flaky tests audit

An audit of every test in the repo — jest suites, language-server suites and the
Playwright e2e suite — for the two things that make a test lie: **wall-clock
timing** and **non-deterministic order/state**. Prompted by the recurring
"pre-existing e2e failures" baseline that PRs #507, #527 and #533 each had to
re-establish by hand.

The verdicts use three severities:

- **broken** — fails deterministically for a reason that is not the code under test
- **flaky** — can pass or fail on the same code, depending on timing or leftover state
- **timing-based** — currently green, but asserts through real elapsed time, so a
  loaded box can flip it

**Empirical basis**: the reportedly-failing fs-mode specs were re-run in this
container on a fresh clone of `main` (clean `examples/next/.val`): 8 failed, 2
passed (`long-record` and the gallery upload test), in 8.3 minutes. Every
failure was then diagnosed from its trace — none of the 8 is mysterious, and
none of the 8 is a _flake_ in the strict sense: on a clean tree they fail
deterministically, each for one of three findable reasons (§1a, §1f). The
timing-suspect jest suites were run 5×: 54/54 green every time.

**Update — every finding below has been fixed and reverified.** All ten items
in §4's priority list are done, each verified in isolation (patchLock and
pendingValidation 5× each, the language-server suite 3× full-run under
`--detectOpenHandles`), and then together: a full run of the fs-mode
(`chromium`) Playwright project — the same 24-minute-scale run that originally
produced the 9-failure baseline — came back **84 passed, 1 skipped
(`uncommitted-routes.spec.ts`'s pre-existing, unrelated `test.fixme`), 0
failed**, in 19.9 minutes. The full jest suite (2660 tests, 213 suites),
`typecheck` across all 16 packages, `lint`, and `format` are all clean on the
same tree. The sections below are kept as the record of what was wrong and
why; each now ends with what changed.

---

## 1. The e2e suite is the problem, and mostly for one reason: shared disk state

Every fs-mode spec drives the same `examples/next` app against the same
`examples/next/.val/patches` directory, serially (`playwright.config.ts:52`).
That directory **persists between runs**. Cleanup is opt-in per spec, and six
specs never opt in:

| spec                     | cleans state first?                                    |
| ------------------------ | ------------------------------------------------------ |
| `account.spec.ts`        | **no**                                                 |
| `canvas-history.spec.ts` | **no**                                                 |
| `long-record.spec.ts`    | **no**                                                 |
| `mobile-canvas.spec.ts`  | **no**                                                 |
| `module-header.spec.ts`  | **no**                                                 |
| `smoke.spec.ts`          | **no**                                                 |
| everything else          | `clearPatchChain` / `discardAll`, per test or per file |

So part of the suite's failure baseline is a property of the _working tree_,
not of the commit: one aborted or failing run leaves patches behind, and every
later run — on any commit, including the parent commit used to "baseline" —
inherits them. (The clean-tree re-run shows this is not the whole story — most
of the failing 9 fail for concrete reasons of their own, see §1f — but it is
the mechanism behind `long-record`, which passes on a clean tree and failed
only in the 24-minute full run.)

### 1a. `large-patch-chain.spec.ts` — **broken**, and it poisons the tree

The spec fabricates its 650-patch chain by writing directories straight into
`.val/patches` in the **pre-#502 layout**: the first directory is `head`, each
directory is named after the patch's _parent_, and `patch.json` carries a
`parentRef` (`e2e/large-patch-chain.spec.ts:38-68`).

PR #502 replaced that store. The current layout names a directory after the
patch it holds and orders the chain with an append-only log; `parentRef` is
ignored in fs mode, and there is deliberately no old-layout detection
(`architecture/patch-store.md`). A fabricated chain is therefore never in the
ordering log: the server either ignores it as crash debris or sweeps it as
repair, the assertion "the store never loaded the chain" fails — deterministically
— and the spec's own cleanup (`rmSync` on the whole patches directory,
`large-patch-chain.spec.ts:71-73`) deletes the live server's ordering log and
lock out from under it, without holding the lock. Whatever the server had
memoised now disagrees with disk for the rest of the run.

Reproduced here on a clean tree: test 1 fails with its own message, "the store
never loaded the chain". Test 2 in the file ("a patch fetch the server refuses",
`:169-207`) fails for the same root cause — its one fabricated patch is never in
the ordering log, so `/stat` never announces it, no fetch is ever attempted, and
the failure banner it blocks the fetch to provoke never appears.

**Fix**: build the chain through the store's own write path — either 650
`PUT /patches` requests through the API, or (faster) import the real
`appendPatch` from `packages/server/src/patchStore.ts` in `beforeAll` (specs run
in Node, so they can) — and clean up through `DELETE /patches`
(`clearPatchChain`), never `rmSync` while the server runs. The 431-URL-length
regression this spec pins is real and only reproducible at scale, so the spec
should stay e2e; it just has to speak the current store format, and it should
fail loudly if the format drifts again (assert the server _lists_ the chain
before opening the studio).

### 1b. `long-record.spec.ts` — **flaky by order**: the victim next door

No cleanup at all, and it runs alphabetically right after `large-patch-chain`
(`la` < `li` < `lo`). It just opens the studio and measures layout
(`e2e/long-record.spec.ts:13-45`) — on top of whatever chain the previous spec
left. That is the observed symptom exactly: fails in the full 24-minute run,
passes in isolation.

**Fix**: `test.beforeEach(({ request }) => clearPatchChain(request))`. Two lines.

### 1c. `studio.spec.ts` — **flaky by design**: tests that "compose"

The file clears the chain once in `beforeAll` and then deliberately writes each
test _relative to whatever it finds_ (`e2e/studio.spec.ts:123-126`). But writes
are debounced and saved asynchronously, so a previous test's save can land in
the middle of the next test's assertion — which is why `studio.spec.ts:219`
passes 10/10 in isolation and fails only inside the full run (documented in
PRs #507 and #527 as "cross-test residue within that file"). The `discardAll`
helper's own comment describes the mechanism: a debounced write can land between
reading the ids and the discard returning (`e2e/studio.ts:92-99`).

**Fix**: `clearPatchChain` per test, and end every test that wrote something by
flushing (`patchSync.flush()`) before returning, so nothing bleeds into the next
test. The "operations compose" property is better pinned where it already is
deterministic — the store suites (`patchSync.test.ts`, `systemFlow.test.ts`).

### 1d. Make clean state impossible to forget

Rather than auditing specs forever: export a wrapped `test` from `e2e/studio.ts`
(a Playwright fixture) that runs `clearPatchChain` before each test, and use it
in every fs-mode spec. A spec that genuinely wants dirty state (there is none
today) can opt out explicitly.

### 1e. `screens.spec.ts` — not a test; should not be able to fail a run

It says so itself: "Not a test — nothing here asserts anything about
correctness" (`e2e/screens.spec.ts:15`). It is also the single largest source of
hard sleeps in the repo: 24 × `page.waitForTimeout` totalling ~40s
(`screens.spec.ts:71-235`). It was in the failing-9 list; per PR #507 the
failure was the Next dev overlay intercepting a click — noise.

**Fix**: move it out of the default run (`testIgnore: "screens.spec.ts"` in the
`chromium` project, run it via an explicit `--project=screens` or
`npx playwright test screens` with its own project entry). The sleeps are fine
_for a screenshot script_; they are only a problem while it can fail a suite.

### 1f. The rest of the failing-9, diagnosed from a clean-tree run

These specs are well built — event-driven waits, `expect.poll`, per-test cleanup
in gallery/validation. Their failures are not flakes and not residue; each has
one concrete cause:

- **`account.spec.ts:25` and `:81` — broken by the Next dev overlay.** The
  trace is unambiguous: the Settings button resolves, and 136 click retries all
  end with "`<nextjs-portal>` … intercepts pointer events". Next's dev-tools
  badge floats at the bottom-left corner — exactly over the Settings cog at the
  foot of the rail — and it is showing because the dev app currently reports
  2–3 issues. `screens.spec.ts:68` fails the same way (PR #507 spotted the
  overlay there). Two fixes, both worth doing: hide the overlay under test
  (`devIndicators: false` in the e2e app's next config, or a
  `nextjs-portal { display: none }` style injected in `openStudio`), and
  separately look at the issues the overlay is counting — they are real dev-mode
  errors in the example app.
- **`validation.spec.ts` ×3 — test rot against a deliberate UI change.** All
  three failures are `getByLabel("1 validation error")` finding nothing
  (`validation.spec.ts:52,59,116`). PR #509 (merged 2026-08-28) _removed_ the
  validation-error pill from the top bar; no component renders that label any
  more. The spec asserts the old UI. It must be rewritten against the current
  affordance (the Fix count / errors view) — this is a legitimate case of
  updating the test, because the product changed on purpose. The underlying
  behaviour it pins (validation shows in the canvas and gates the publish) is
  still worth pinning.
- **`gallery-backed-image.spec.ts:82` — test rot, not a product bug (corrected;
  see below).** Originally flagged here as a regression: the poll for
  `metadata.hotspot` stayed `null`. Verified with an instrumented run that
  printed the raw peeked value — the toggle writes correctly,
  `{"path":"...","hotspot":{"x":0.5,"y":0.5}}`. `hotspot` lives at the **top
  level** of a gallery-backed field's source (`packages/core/src/source/media.ts`),
  not nested under `metadata`; `metadata` is an unrelated display-only object
  `ModuleGallery.tsx:202` builds for its own row rendering. The test's assertion
  path was simply wrong, and its watched-for console warning
  (`/Expected metadata width and height/`) matches no string anywhere in the
  codebase — the real warning for a malformed hotspot reads "Expected hotspot to
  have x and y as numbers…". Fixed in this PR: `value?.hotspot`, and the regex
  corrected to match the real warning text. Both tests in the file now pass.

`account.spec.ts` should still get the `clearPatchChain` fixture once unblocked:
it asserts on UI that leftover invalid patches can restyle.

### 1g. Known-flaky http-mode publishes — a real race, maybe in the product

PR #527 calls `http/publish.spec.ts:67` / `deployments.spec.ts:163` "a flaky
publish-'refused'". The shape: `writePatch` flushes the save
(`e2e/http/httpMode.ts:440-455`), then `publishAll` publishes immediately.
`PublishSeam` refuses with `validation-errors` when the gate sees stale
validation and with `chain-moved` when an edit lands mid-gate
(`packages/ui/spa/stores/PublishSeam.ts:82-108`) — and pending-module validation
runs on a hard-coded 300ms debounce (`createSystem.ts:66`, `:600-615`). A
publish that arrives inside that window races the gate.

**This one deserves a product decision, not a test tweak**: either `publish()`
awaits/forces the pending validation itself (an editor clicking Publish 200ms
after typing is the same race), or it is genuinely a `refused` the UI should
surface — in which case the _test_ should retry on `refused`, and say why.
Diagnose by logging the `reason` the seam returns when it flakes.

### 1h. Remaining hard waits in e2e, each with a verdict

| site                           | wait                                                                       | verdict                                                                                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas-history.spec.ts:67,81` | 1000ms for the shell's own `replaceState` before counting `history.length` | replace with `expect.poll` on the URL carrying the canvas position — the write being waited for is observable                                                                                                                                                 |
| `studio-ui.spec.ts:195-201`    | 60ms between keystrokes to prove the debounce collapses a burst            | **timing-based**: a stall longer than the write debounce splits the burst into two patches. The collapse property is already pinned deterministically with fake timers in `useDebouncedFieldWrite.test.tsx`; relax the e2e to "typed value arrived, ≥1 patch" |
| `http/deployments.spec.ts:427` | 50ms so two mock deployments get distinguishable `updatedAt`               | let `mock.deployment()` accept an explicit `updatedAt` — trivial determinization                                                                                                                                                                              |
| `smoke.spec.ts:231`            | 3s settle to catch a React render loop                                     | a negative watch-window; genuinely hard to make event-driven. Acceptable — it can only false-_pass_, never flake red                                                                                                                                          |
| `canvas.spec.ts:139-152`       | `settled()` polls the divider position to a fixed point                    | fine — it waits for rest rather than assuming a duration                                                                                                                                                                                                      |
| `account.spec.ts:56-62`        | 6s poll asserting the retry counter stopped                                | negative watch-window over real backoff (1s→2s→4s→8s in `ValProvider.tsx:836-838`); acceptable, but note the whole test is ~15s of scheduled retries                                                                                                          |

---

## 2. Jest suites: three suites are wall-clock-based; the debounce tests are not

Empirical note: `patchLock`, `ValOpsFS.patchStore` and `pendingValidation` were
run 5× in this container — 54/54 green each time. None of these are _observed_
flaky today; they are flagged because they assert through real elapsed time.

### 2a. `packages/ui/spa/stores/pendingValidation.test.ts` — **timing-based**, fix by injection

`afterDebounce()` really sleeps 500ms to outwait the hard-coded 300ms validation
debounce (`pendingValidation.test.ts:24-25`, `createSystem.ts:66`). Four tests ×
500ms+ (the scaling test three times over), and the margin is 200ms of real work
on a possibly loaded box — the "one validation per burst" count reads _early_ if
validation is slow, and the whole suite pays ~3s of sleep every run.

**Fix**: `PENDING_VALIDATION_DEBOUNCE_MS` becomes a `createSystem` option, the
way `saveFlushTimeoutMs` already is (`autoSavePublish.test.ts:82` injects 20ms
and then waits deterministically via `flush()`). `initTestSystem` passes 0–1ms,
and/or the system exposes a test-visible "validation pass completed" event the
Ledger can wait on. No real sleep remains.

### 2b. `packages/server/src/patchLock.test.ts` — **timing-based**, and the fix is already half-built

Four tests sleep 10–40ms to expire a 20–50ms TTL
(`patchLock.test.ts:93-100,116-128,130-142,144-154`). `acquirePatchLock` already
accepts an injectable clock — `options.now` (`patchLock.ts:225`) — the tests just
don't use it. Drive expiry with a mutable fake `now` and the sleeps go away; the
outcome stops depending on how fast the box got from acquire to re-acquire.

The 12-caller serialization test (`patchLock.test.ts:183-204`) is fine: its 1ms
sleep exists to force interleaving, and the assertion holds under any
interleaving — that is order-independence done right.

### 2c. `packages/server/src/ValOpsFS.patchStore.test.ts:563,589` — borderline

Two long-poll tests sleep 50ms to let `getStat` get past its initial read before
the test deletes a patch. The sleep is direction-safe (a slow box makes the wait
longer than needed, not shorter) and the poll interval is injected at 25ms
(`:86`), so risk is low — but it is still wall-clock coordination with a
comment where a synchronization point should be. If the store ever exposes a
"poll is waiting" hook for tests, use it; otherwise this is in the
"ABSOLUTELY necessary" bucket: a long poll is time, and these two tests pin a
bug that only exists across its wait.

### 2d. The debounce tests the prompt remembered — already deterministic

`useDebouncedFieldWrite.test.tsx` runs entirely on `jest.useFakeTimers()` /
`advanceTimersByTime` (`:41-46`), as do `MediaThumbnail.test.tsx` and
`pendingChangesGate.test.tsx`. No real time, no flake surface. These are the
model for 2a.

### 2e. The store-suite `settle()` idiom — deterministic, but fragile

Most store suites flush the event pipeline with one or two
`setTimeout(resolve, 0)` turns (`testSystem.ts:117-120`, `patchSync.test.ts:42`,
etc.). On a single-threaded loop this is deterministic — same result every run —
but it is _hop-count-coupled_: the helper's own comment notes that one turn too
few makes every `noMessages()` assertion pass vacuously. Adding an `await`
inside a store silently converts real assertions into vacuous ones. Not flaky;
listed so nobody "fixes" a failure by adding a third `settle()` without
understanding why. Prefer the Ledger's event-driven `has()` waits where
possible.

### 2f. `testSystem.ts` waiter deadline — 50ms is one GC pause from a flake

`Ledger.has()` and `didReceive()` are event-driven (the right pattern) but
reject after `DEFAULT_TIMEOUT_MS = 50` (`testSystem.ts:106,222,962`). The file
documents that 5ms flaked at a measured 6ms peak and 50ms was chosen as margin.
The deadline only makes _failures_ slower, never passes — so it can be generous.
Raise it to 2–5s: a green test still resolves in microseconds, and the flake
surface on a loaded CI box disappears.

### 2g. `packages/language-server` — one real flake, one negative timer

- **The LSP teardown EPIPE race — the one diagnosed, recurring unit-test flake**
  (PR #497: failed/passed/failed across commits that never touched the package).
  `lspClient.ts` `dispose()` is `client.dispose(); child.kill()`
  (`__testHelpers__/lspClient.ts:203-207`): disposing can leave a write queued on
  the connection, `kill()` closes the pipe under it, and the EPIPE surfaces as an
  unhandled rejection that Jest pins on _whichever test happens to be running_ —
  usually in a different suite. **Fix** (proposed in #497, never landed): make
  `dispose()` async — send `shutdown`/`exit` over the protocol, wait for the
  child to exit with a deadline, and only then `kill()` as the fallback; swallow
  `EPIPE` on the writer during teardown.
- `diagnostics.test.ts:232-242` asserts "no diagnostics for a non-Val file" by
  racing a 2s timer. It cannot flake red, but it false-passes if the server is
  slower than 2s, and it costs 2s every run. Deterministic version: open the
  non-Val file, then open a Val file and wait for _its_ diagnostics (an ordering
  guarantee the server provides), then assert the non-Val file received none.
- The rest of the package's suites drive a real child process over JSON-RPC and
  wait on responses/notifications — event-driven, correct. The 30–90s
  `jest.setTimeout`s are spawn/compile budget, not polling.

### 2h. `workerBridge.test.ts` — fine

Spawns a real worker thread and waits on `message`/`error` events
(`workerBridge.test.ts:100-105,150`); the 30s budget is spawn cost. Event-driven,
deterministic.

---

## 3. The structural finding: e2e is not in CI at all

`.github/workflows/check.yml` runs lint, format, typecheck, jest and two builds —
no Playwright job. Jest explicitly ignores `e2e/` (`jest.config.js`). PR #505
already tripped over this ("that spec is not in check.yml, which is why nothing
caught it"), and §1a is the direct consequence: `large-patch-chain` silently
rotted when #502 changed the disk format underneath it.

An e2e suite that only runs ad hoc in sandboxes _will_ accumulate broken specs,
and every future PR pays the "baseline the failures by hand" tax that #507,
#527 and #533 each paid. Either:

1. add a CI job for the fs-mode project (`workers: 1` already; budget ~25min,
   or a tagged smoke subset per PR and the full suite nightly), or
2. accept the suite as a manual tool — in which case delete the specs whose
   coverage exists in the store suites, and keep only what genuinely needs a
   browser (StrictMode lifecycle, layout like `long-record`, URL/history,
   upload round-trips).

Half-maintained is the one option that keeps costing.

---

## 4. Priority order

Items 1–10 are done and reverified (see the update note at the top). 11–13 are
left for a deliberate follow-up decision rather than a mechanical fix.

1. ~~`gallery-backed-image` hotspot~~ — fixed: it was the test asserting the
   wrong path, not a product bug. (§1f)
2. ~~`large-patch-chain.spec.ts`~~ — rewritten to build its chain through
   `appendPatch` (the current store format) and clean up with an atomic
   rename-away under the lock, instead of the pre-#502 layout and an unordered
   `rmSync`. (§1a — was broken, and was poisoning the tree)
3. ~~Dev overlay under test~~ — `openStudio` now hides `<nextjs-portal>`;
   unbroke `account` ×2 and `screens`. (§1f)
4. ~~`validation.spec.ts`~~ — rewritten against the post-#509 UI (the `Fix N`
   publish button, not the removed pill). (§1f)
5. ~~Clean-state fixture~~ — `test` exported from `e2e/studio.ts` now clears the
   patch chain (`auto: true`) before every test; applied to the six specs that
   had no cleanup (`account`, `canvas-history`, `long-record`, `mobile-canvas`,
   `module-header`, `smoke`). (§1b, §1d)
6. ~~LSP `dispose()` teardown~~ — now sends `shutdown`/`exit` over the protocol
   and waits for the child to exit before tearing down the client, falling
   back to `kill()` only past a deadline; verified 3× full-run under
   `--detectOpenHandles` with no leaked timers and no EPIPE. (§2g — was the one
   recurring jest flake)
7. ~~`pendingValidation`~~ — waits on the store's own `validation:result` event
   instead of a fixed 500ms sleep; the real debounce stays real only where the
   test's OWN property needs it (the burst-collapse test). (§2a)
8. ~~`patchLock`~~ — the four expiry tests now drive a fake clock through the
   `now` option the implementation already supported, instead of sleeping past
   the TTL. (§2b)
9. ~~`studio.spec.ts`~~ — kept its intentional cross-test composition (per its
   own `beforeAll` comment) rather than adding per-test resets, which would
   have defeated the "surviving chain" test; the actual gap was one test
   ("shows the written value through the hooks") that never flushed its write
   before its page closed. Added the same flush + pending-count check the
   other writing tests already had. (§1c)
10. ~~Exclude `screens.spec.ts`~~ — moved to its own Playwright project
    (`testIgnore` in `chromium`); reachable by name or `--project=screens`,
    never by a default run. (§1e)
11. Small determinizations: `canvas-history` poll, `deployments` explicit
    `updatedAt`, `studio-ui` keystroke assertion, `testSystem` waiter deadline
    to seconds, `diagnostics` ordering-based negative. (§1h, §2f, §2g) — not
    done; low-risk, low-value cleanups left for whoever next touches those
    files.
12. Decide the publish-`refused` race at the product level. (§1g) — not done;
    needs a product decision (does `publish()` await pending validation
    itself, or is `refused` here correct and the test should retry on it).
13. Decide e2e-in-CI. (§3) — an `E2E` job (chromium + chromium-http, matrixed)
    was written and verified locally, but this session's GitHub token lacks
    the `workflow` OAuth scope, so pushing a change to
    `.github/workflows/check.yml` is rejected outright. The job's YAML is in
    this branch's history (before the revert commit that follows it) for
    someone with the right permissions to apply.
