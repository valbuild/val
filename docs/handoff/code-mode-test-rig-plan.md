# Code mode test rig: plan (proposal, not started)

Written 2026-11-26 by a planning session from the brief below. **Nothing has been built**: no code, no branch, no PR. Some findings come from reading code only and are marked so; none have been run. Four decisions are open (end of this note).

## The brief

Build a thorough test rig for Val Studio's code mode, so that the changes the assistant's tools most likely make to a site's code are known to work end to end, and the kinds of unexpected behaviour we have been hit by are caught by tests rather than by trying things live.

Bugs that were found by hand, never by a test:

1. React error 418 on every page check (quick preview hydrated the last build's HTML with the new code). Fixed in 0.156.0 (`packages/tanstack/src/QuickPreviewRender.tsx`).
2. Build after a coding session reloaded the whole Studio. Now a last resort only (`packages/ui/spa/stores/buildCode.ts`); pinned by `scenarios/src/codeModeBuild.scenario.test.ts` and `e2e/proposal/codeModeBuild.spec.ts`.
3. The page check said "make all button borders red" was not on the page when it was. Fixed in 0.156.1 (val#1111). Checks bar not dismissible on a phone, same release.
4. New Tailwind classes (`border-2! border-red-500!`) may have no CSS in a quick preview or Build when the build reuses the live stylesheet. Fix in progress elsewhere: valbuild/val#1112. The rig should be able to TEST it (expected to fail until it lands), not duplicate it.

Requirements: a catalogue of likely tool changes; invariants checked through the product's own code paths (CLAUDE.md test rule 3); several levels (headless for breadth, browser for the canvas / quick preview / page log, at least one real platform run); scripted assistant turns, never a real model; failing test first for any bug found, and report before fixing anything large.

## What exists, and what it doesn't cover

| Level                         | What's there                                                                                                                                                                                                             | What's missing                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Headless (`scenarios/`)       | T1–T5 cover hero class, eyebrow field, unevaluated `.val.ts`, unimportable build and a new section. B1–B7 cover Build not reloading. They drive the real tools through `proposal.assistant(editor)` and the real server. | Deleting or renaming files, a new dependency, type and lint errors, code that won't bundle, several edits plus a quick preview at the same time. The page check and the checks bar are never driven at this level. |
| jsdom                         | `quickPreviewHydration.test.tsx` covers a class change and a text change with no 418. `usePageCheckSession` and `ChecksBar` are tested, but only as isolated units.                                                      | Markup or structure changes, a new component, style changes outside `className`.                                                                                                                                   |
| Browser (`chromium-proposal`) | `codeModeTasks.spec.ts` (dark hero, a new section, Build), `quickPreviewPageLog.spec.ts`, `codeModeBuild.spec.ts`, `codeModePreview.spec.ts`.                                                                            | The mock's quick preview returns `files: {}` (`e2e/mock-content-host/server.ts` ~line 4318) and the canvas shows `examples/tanstack`'s own page, so **no browser test ever sees a change on the page**.            |
| Real platform                 | valbuild/home `platform/scripts/loop.ts` quick-preview step, run by hand.                                                                                                                                                | Nothing scripted.                                                                                                                                                                                                  |

Two gaps found by reading code (need a test to confirm):

- **G1: the mock gives the page check the chat's next scripted turn.** `ai_prompt` pops the next `aiScripts` entry whether or not the prompt is `hidden: true` (`server.ts` ~line 2493). The page check's hidden session (`usePageCheckSession.ts`) therefore takes the scripted turn meant for the chat. With nothing queued it gets "No script was queued", ends without a `report`, and shows as failed. A browser spec that queues two turns could see its second turn run as the page check. Harness bug, not product bug, but it means no browser test can drive a page check today. (Possibly related: a one-off failure of `quickPreviewPageLog.spec.ts:77` seen in CI.)
- **G2: when a quick preview cannot show a change, nothing in the product says "blocked".** The assistant's system prompt (`packages/ui/spa/proposals/proposalCode.ts` ~line 578) says a quick preview cannot show server code, added/removed/renamed routes, a `.val.ts` schema, or a new dependency. The product now decides `blocked` itself for no preview / failed / off / timed-out quick previews (0.156.1), but for these change kinds the verdict is still left to the model. Same family as bug 3. Write as a failing test first.

## Catalogue

Each case is one scripted turn (or a few) on `e2e/proposal/codeModeSite.ts`, extended with a CSS file, a second route and a `.val.ts`.

| ID  | Change                                                                                | Expected                                                                                         |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| K1  | Change an existing Tailwind class (`bg-white` → `bg-black`)                           | pass                                                                                             |
| K2  | Add a Tailwind class new to the site, with `!` (`border-2! border-red-500!`)          | pass. Expected to fail until val#1112 lands                                                      |
| K3  | Add an inline `style={{…}}`                                                           | pass                                                                                             |
| K4  | Edit an existing `.css` file                                                          | pass                                                                                             |
| K5  | Change text                                                                           | pass                                                                                             |
| K6  | Change markup/structure (wrap in an element, a list item, a conditional)              | pass                                                                                             |
| K7  | New component imported by an existing component                                       | pass                                                                                             |
| K8  | New route file and a link to it                                                       | blocked: needs Build. Pass after Build                                                           |
| K9  | Delete a component and its import (`write_files` with `null`)                         | pass                                                                                             |
| K10 | Rename a file and update its importers (delete + write in one call)                   | pass                                                                                             |
| K11 | Import a new dependency, with `package.json` changed                                  | blocked: needs Build                                                                             |
| K12 | Change a `.val.ts` schema and its content (exists as T2/T3; bring into the catalogue) | blocked until Build; the field is editable in the tab                                            |
| K13 | Register a new module in `val.modules.ts`                                             | blocked until Build; the module appears after Build                                              |
| K14 | Type error                                                                            | Typecheck reports N errors; the page check is told; the checks bar shows Types failing           |
| K15 | Lint error                                                                            | Lint reports problems; the checks bar shows Lint with a count                                    |
| K16 | Code that does not bundle (syntax error, missing import)                              | Quick preview fails; blocked with the reason; no 418; Studio intact                              |
| K17 | Several edits across three files in one turn                                          | One quick preview, of the last inputs                                                            |
| K18 | An edit while a quick preview is in flight                                            | The stale one is dropped (409 `inputs-moved`), the newer one wins, the check reads the newer one |
| K19 | Quick preview fails or times out (bug 3 shape)                                        | blocked, never fail or pass                                                                      |
| K20 | Build after any of the above                                                          | Built, no reload (or exactly one, for the B6 shape)                                              |

## Invariants (each through the product's own code)

- **I1 The tool answers truthfully.** `CodeToolAnswer` and `isError`; `read_file` reads back what was written (`runCodeTool`, `runReadOnlyCodeTool`).
- **I2 What is staged equals what was written.** `/proposals-api/:name/files`.
- **I3 The change is on the page.** `runReadPage` (`pageTools.ts`) contains the new text or selector; for styles, the computed style is on the element in the quick preview's document.
- **I4 No error the change did not cause.** `runReadPageLog` with `levels: ["error"]` is empty, except errors the case expects (K16).
- **I5 No Studio reload.** `watchForReload` in the browser; headless, the existing check from B1–B7.
- **I6 Build builds without reloading.** `serverBuildsMade` grows by one and the "Built" notice shows.
- **I7 The page check's evidence and verdict are right.** With a scripted model the verdict is whatever is scripted, so asserting it proves nothing. Test instead: the check's tools read the current inputs (not a stale build), and the product decides `blocked` itself where it should (no preview, stale preview, failed quick preview, and G2 if agreed).
- **I8 Typecheck and lint report what they should.** `backgroundChecks.ts`, `typecheckStatusOf`, `backgroundLintOf`.
- **I9 The checks bar ends in the right state.** Assert on the props the product builds for `ChecksBarView`, not rendered text; pull that derivation out into a function if it is not one already.

## Harness shape

- **One shared definition per case:** `e2e/proposal/codeModeCases.ts`, next to `codeModeSite.ts` (scenarios already import from there). About ten lines per case:
  ```ts
  case("K2 a new class, important", {
    site: { [HERO_FILE]: heroSection },          // optional overrides
    turn: [edit(HERO_FILE, `className="…"`, `className="… border-2! border-red-500!"`)],
    onPage: { selector: "section", style: { borderTopColor: "rgb(239, 68, 68)" } },
    checks: { typecheck: "ok", lint: "ok", page: "pass" },
    build: "no-reload",
    knownBug: "tailwind-css (valbuild/val#1112)",
  });
  ```
  `knownBug` cases run as `test.failing` (jest) / `test.fail` (Playwright), so they turn red once fixed and get un-marked.
- **Headless runner:** `scenarios/src/codeModeCatalogue.scenario.test.ts` runs every case for I1, I2, I5, I6, I8, I9 and the product-side half of I7.
- **jsdom runner:** extend `quickPreviewHydration.test.tsx` to render each case's changed component through `QuickPreviewRender`, for I3 (text, markup, inline style) and I4.
- **Browser runner:** `e2e/proposal/codeModeCatalogue.spec.ts` runs a subset (K1, K5, K7, K14, K16, K17, K18, K19, K20) for the canvas, the quick preview document, the page log, the checks bar and reloads.
- **Mock changes:**
  1. Scripts for hidden prompts in their own queue, `mock.pageCheckScript(...)` (fixes G1).
  2. A quick preview that can be told to fail or time out: `mock.quickPreviews({ fail: "bundle" | "timeout" })`.
- **Real platform:** cases tagged `real` (K1, K2, K5, K7, K16) for `loop.ts`: the only level where a real build draws the change and its CSS.

## Open decisions (for the user)

1. **Should the mock's quick preview actually build?** `buildUserApp` (`packages/tanstack-build`) already runs under Node (`productionBuild.test.ts`). The mock could build the staged files and return real files, so CI would see K1–K10 drawn (and K2's CSS once val#1112 lands). Cost: a buildable fixture site instead of today's fragment, and seconds per quick preview. Planner's recommendation: not now; jsdom for render correctness and the loop for bundling/CSS; revisit if the loop finds what CI could not.
2. **Can the real platform loop run scripted turns?** In valbuild/home, can the AI be scripted, or does the loop always use a real model? If always a model, a scripted-turn hook is needed in home (other repo; ask first).
3. **G2:** should the product, not the model, mark the page check `blocked` when the change cannot be shown in a quick preview (routes, server code, schema, dependencies)? If yes, write K8 and K11 as failing tests first.
4. **The catalogue:** anything missing that the assistant is often asked to do? The list comes from bug reports and the system prompt, not usage data.

Suggested order once agreed: the mock fix (G1), the shared case file and the headless runner, then jsdom and browser coverage.
