# Code mode: status of fixes and tests (2026-11-27)

Handoff note. Session ids below are for reference only; another account cannot open them. The test-rig plan is in `docs/handoff/code-mode-test-rig-plan.md`.

## What was reported, and where it stands

| #   | Report                                                                                   | Status                                                                             | Where                                                                               |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | Build after a coding session reloads the whole Studio                                    | Fixed: reload only as a last resort (the build's code cannot be imported in place) | `packages/ui/spa/stores/buildCode.ts`; val#1104                                     |
| 2   | Page check always reports React error 418 (hydration)                                    | Fixed, released in 0.156.0. Confirmed gone by the user live                        | `packages/tanstack/src/QuickPreviewRender.tsx`, `ValTanStackProvider.tsx`; val#1104 |
| 3   | Checks bar not dismissible; fills the screen on a phone                                  | Fixed, released in 0.156.1                                                         | `packages/ui/spa/components/ChecksBar.tsx`; val#1111                                |
| 4   | Page check says a fixed change (red button borders) is not on the page                   | Page-check half fixed, released in 0.156.1                                         | `packages/ui/spa/hooks/usePageCheckSession.ts`, `proposals/pageCheck.ts`; val#1111  |
| 4b  | New Tailwind classes may have no CSS in a quick preview / Build (live stylesheet reused) | **Open**: valbuild/val#1112, not merged                                            | being done separately                                                               |

Releases: **0.156.0** (#418 fix), **0.156.1** (checks bar, page check; plus #1082 discard and #1109 Publish button from other sessions). Both on npm.
Templates: bumped to 0.156.0 and reseeded (valbuild/templates#66). **Not yet bumped to 0.156.1.**

## Tests, by level

All green on `main` after val#1113 (78ab571), unless marked.

### Headless (jest, `pnpm test`)

- `packages/tanstack/src/quickPreviewHydration.test.tsx`: 7 tests. Quick preview renders the new code without hydrating it; no 418; a real hydration bug on a normal page is still logged.
- `packages/shared/src/internal/quickPreview.test.ts`: the worker leaves the page as the server sent it.
- `packages/ui/spa/hooks/usePageCheckSession.test.tsx`: includes the describe "a page check of a change the preview does not show" (7 tests): waits through a 75 s quick preview; tells the model the page is the change; failed / off / no quick preview / timeout → `blocked`, no model, with the reason.
- `packages/ui/spa/components/ChecksBar.test.tsx`: hide, stays hidden for the same checks, comes back on something new; findings folded; no Try again where it would repeat itself.

### Scenarios (`pnpm test scenarios`)

- `scenarios/src/codeModeBuild.scenario.test.ts` (B1–B7): Build without reload; B6 = one reload as the last resort.
- `scenarios/src/codeModeTasks.scenario.test.ts` (T1–T5): search / read / edit / quick preview / Build, scripted, no model.

### Browser (Playwright `chromium-proposal`, non-blocking in CI)

`pnpm exec playwright test --project=chromium-proposal`: 9 passed locally and in CI on val#1113.

- `e2e/proposal/codeModeBuild.spec.ts`, `codeModeTasks.spec.ts`, `codeModePreview.spec.ts`, `quickPreviewPageLog.spec.ts`
- Helpers: `e2e/proposal/codeModeStudio.ts`, `codeModeSite.ts`; mock content host `e2e/mock-content-host/server.ts` (`mock.aiScript`, `quickPreviews`, `serverBuilds`, `projectSource`).

### Real platform (valbuild/home)

- `platform/scripts/loop.ts --content real --server-build --val <val>`: step 5e'' "quick preview in Studio" (5/5 checks passed on 0.156.0). The rest of the loop had 42 failures that predate this work (loop drift: code mode off, Studio save/publish steps). **Not re-run for 0.156.1.**

## Known failing / intermittent tests (not caused by this work)

| Test                                                                                                  | Project           | Seen                                                        | Notes                                                                              |
| ----------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `e2e/http/loginDialog.spec.ts` › "no request is repeated while the login dialog is up"                | chromium-http     | Fails ~2 in 6 locally **on main's code**                    | Real bug: signed-out Studio sometimes repeats `/api/val/remote/settings`. Unowned. |
| `e2e/http/remoteImages.spec.ts:241` (gallery Upload / image field picker)                             | chromium-http 3/3 | Failed on main's run and on PR runs                         | "the new image did not decode". Unowned.                                           |
| `e2e/inlineEditingSuite.ts:319` "…dropped, typed nowhere, when the field opens in the column instead" | chromium 2/6      | Once, on a PR run (passed on rerun at head)                 | Intermittent. Unowned.                                                             |
| `e2e/proposal/quickPreviewPageLog.spec.ts:77`                                                         | chromium-proposal | Once ("The page did not answer"), then 3/3 local + CI green | Watch it. Asks the page right as it comes to the front.                            |

None of these block CI (the e2e matrix is non-blocking; the blocking `smoke` job is green).

## What is left

1. **CSS in quick previews / builds** (report 4b): valbuild/val#1112 open, done separately. When it lands, add a test that a new Tailwind class's style is on the page after a quick preview and after a Build.
2. **Test rig for tool-made changes**: planned, not started. The plan, its catalogue (K1–K20), invariants (I1–I9), harness shape and **4 open decisions** are in `docs/handoff/code-mode-test-rig-plan.md`.
3. **Templates → 0.156.1** (bump all six, `minimumReleaseAgeExclude`, `node scripts/release-age.mjs`, install-check, reseed mirrors). Not started.
4. **Loop re-run on 0.156.1** (home `loop.ts`, quick-preview step), and fixing the old loop drift. Optional.
5. **Intermittent tests above**: the `loginDialog` repeat is a real product bug worth its own session.
6. Not confirmed: whether the page check's "Open Val Studio" finding came from checking a link not rendered by the changed Button component. The page check now says which page it reads, so this should be visible in its report next time.

## Files kept with this note

- `docs/handoff/templateLive.cjs`: checks a template's Studio comes up and an edit saves (`node templateLive.cjs <template dir> <port> <tanstack|nextjs>`; needs Playwright, set `executablePath` for your Chromium). Used for the 0.156.0 template bump.

This note lives on branch `claude/dazzling-davinci-klgak0` of valbuild/val only; it is not on `main`. Fetch it with
`git fetch origin claude/dazzling-davinci-klgak0 && git show FETCH_HEAD:docs/handoff/code-mode-status.md`.
