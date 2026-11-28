# Code mode test rig: status (2026-11-28)

What was built from `code-mode-test-rig-plan.md` (on branch
`claude/dazzling-davinci-klgak0`), and what it found. Branches:
valbuild/val and valbuild/home `claude/loving-lovelace-j5qc91`. Nothing is
merged or released.

## The rig

| Level         | Where                                                                                  | What it holds                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue     | `e2e/proposal/codeModeCases.ts`                                                        | K1–K11, K14–K17, K21–K25: each change once, as tool calls, with what should follow and the levels it runs at. Known bugs run as `test.failing` / `test.fail`.                               |
| Real build    | `packages/cli/src/publish/codeModeCatalogue.test.ts` (+ `__fixtures__/studioBuild.ts`) | The site published by `val publish`; each change built by the Studio's own `buildQuickPreview` and `runStudioDeploy` with the real builder. The page would get the new text and CSS. ~15 s. |
| Headless      | `scenarios/src/codeModeCatalogue.scenario.test.ts`                                     | The tools against Val's real server: answers, staging read back, Val lint, a Build lands without a reload.                                                                                  |
| Browser       | `e2e/proposal/*.spec.ts`, `e2e/http/renderIds.spec.ts`                                 | Render ids end to end; the page check's own script queue; site → code mode → proposal, one conversation, carried on once.                                                                   |
| Real platform | valbuild/home `platform/scripts/loop.ts` 5e', 5e'', 5e'''                              | Val Build's build and the quick preview with a new Tailwind class; 5e''' a scripted assistant turn in the Studio: DOM, CSS, and a before/after picture of the canvas.                       |

Not built, by decision: a mock that builds quick previews. The canvas in the
browser suite shows the example app, not the case site; real drawing is the
loop's.

## Built along the way

- **Render ids.** A tool that changes the page answers with `renderId`; the
  page writes it on itself once it shows the change (`renderMark.ts`,
  `proposals/renders.ts`, `takeRenders`); `read_page` with `at` and
  `timeout_ms` (60 s) waits for it, across reloads. Content edits included.
  Next writes it when its refresh is sent, not when it is back.
- **Scripted turns.** val's mock: `mock.hiddenScript` (G1), `{{renderId}}` in
  scripts, `mock.proposalAddress`. home: `content/src/ai/providers/scripted.ts`
  behind `VAL_AI_SCRIPT_URL`; `real-content.ts` serves it (`aiScript`,
  `aiResults`) and seeds a key; the host proxy tunnels CONNECT.
- **Carrying a conversation to code mode.** `?panel=ai` with the session,
  the assistant not closed while connecting, no empty-chat flash, and
  `continueHandoff.ts`: `?val_continue=<id>`, the Studio's own message, sent
  only while the conversation ends on the request (at most once).

## Bugs found

|     | Bug                                                                                                                                                                                                                                       | State                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | A class a change adds has no style in a quick preview or Build: the stored source has no stylesheets (`withoutStylesheets`), so the build ships the live CSS. valbuild/val#1112 does not fix it. K2, K7, K17, K22; loop 5e', 5e'', 5e'''. | Open, failing tests in place. #1112's area.                    |
| 2   | A site importing its stylesheet bare cannot be built in the tab (K21).                                                                                                                                                                    | Open, failing test. Same cause.                                |
| 3   | An SVG the tools write is built as code (K23).                                                                                                                                                                                            | Fixed: `withTextAssets` in `buildUserApp`.                     |
| 4   | G2: a route added/removed or a dependency added was judged by the model.                                                                                                                                                                  | Fixed: `quickPreviewCannotShow`.                               |
| 5   | G1: the page check took the chat's scripted turn.                                                                                                                                                                                         | Fixed in the mock.                                             |
| 6   | Code mode from the site: conversation closed, then closed on load, then an empty chat flashed, then the person had to ask again.                                                                                                          | Fixed, `codeModeFromSite.spec.ts`.                             |
| 7   | The http Studio's canvas reloads ~3 times in the 7 s after it is live; a `read_page` then gets no answer (on main too).                                                                                                                   | Open, not root-caused. `read_page` with `at` rides through it. |
| 8   | `e2e/http/manifest.spec.ts:67` fails ~4 in 12 on main ("Response has been disposed").                                                                                                                                                     | Open, intermittent.                                            |

## Left

- Templates to 0.156.1, the loop on the npm release, and the loginDialog
  repeat (items C, D, E of the brief) are not started.
- The catalogue's browser runner for DOM/CSS is the loop's (5e'''); K12, K13,
  K18, K19 are not in the catalogue yet.
