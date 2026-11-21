# An assistant turn in code mode: the baseline

What a person waits through between sending the assistant a message and (a)
seeing the change in the preview, (b) the turn ending. Written on 2026-11-21
from `main` at `c71a92c`, as the numbers later changes are compared against.
The rules are `README.md`'s: counts are asserted in CI, times are printed and
never asserted.

## How a turn is measured

| What                                  | Where                                                                                      | Run                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Where a turn's time went, in the tab  | `packages/ui/spa/hooks/aiTurnTrace.ts`, fed from the assistant's socket (`useAIWebSocket`) | In any Studio: see "Capturing a trace" below                                               |
| Requests a code tool makes            | `packages/ui/spa/proposals/codeToolRequests.test.ts`                                       | `pnpm test packages/ui/spa/proposals/codeToolRequests.test.ts`                             |
| Requests that follow one staging      | `packages/ui/spa/proposals/afterStagingRequests.test.tsx`                                  | `pnpm test packages/ui/spa/proposals/afterStagingRequests.test.tsx`                        |
| A real turn in a browser, printed     | `e2e/http/turnTrace.spec.ts` (scripted model, on the site)                                 | `pnpm exec playwright test --project=chromium-http e2e/http/turnTrace.spec.ts --trace off` |
| Bundling and evaluating `val.modules` | `evaluateValModules.ts` (native rolldown: a floor for the tab)                             | `node --import tsx measure/evaluateValModules.ts ../examples/tanstack`, from `scenarios/`  |

The trace splits a turn into **model** (no tool call outstanding: the tab
waits on the content service), **tools** (a call arrived, its result has not
gone out) and **person** (every outstanding call waits on the person). The
three add up to the turn. It also holds each tool's calls and time by name,
the number of model round trips, and when a quick preview showed the turn's
last write.

## Counted work (asserted in CI)

Requests from the tab to the app's `/api/val`, each of which the app relays
to content: two hops per request. A call after the turn's first; the first
is the same requests with the site's source sent whole.

| Tool                    | Requests | Which                                                                                                   |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `read_file`             | 2        | site source (by version, answered 304), proposal files                                                  |
| `search_code`           | 2        | the same                                                                                                |
| `list_files`            | 2        | the same                                                                                                |
| `lint`                  | 2        | the same                                                                                                |
| `lint` with `fix: true` | 4        | proposal (code mode), site source, proposal files, stage                                                |
| `format_files`          | 4        | proposal (code mode), site source, proposal files, stage                                                |
| `write_files`           | 5        | proposal (code mode), stage, then for the evaluation: proposal files, site source (whole), build target |
| `edit_file`             | 7        | proposal (code mode), site source, proposal files, stage, then the evaluation's three                   |

After one staging, once the tool has answered:

| Reader                                 | Requests | Which                                                                   |
| -------------------------------------- | -------- | ----------------------------------------------------------------------- |
| The proposals bar                      | 2        | proposals list, proposal                                                |
| The quick preview by itself            | 3        | proposal, then a second later proposal again and the build on Val Build |
| The Code changes pane, when it is open | 2        | proposal files, site source (whole)                                     |

So one `edit_file`, from the call arriving to its files being handed to the
page, is **12 requests** with the Code changes pane closed (7 before the
answer, 5 after), 14 with it open. `write_files` is 10.

Waits that are not requests, and are in the code as constants:

- The tool's answer waits for the tab to evaluate the staged code, up to
  20 s (`STAGED_CODE_WAIT_SECONDS`).
- The quick preview starts 1 s after the staged files stop changing
  (`AUTO_QUICK_PREVIEW_DELAY_MS`).
- Tools that change code run one at a time per proposal (`codeWrites`), so
  three edits in one model reply are three times one edit, each with its
  own evaluation.
- When the background typecheck has errors the assistant has not heard, the
  answer waits up to 3 s for one more read of the proposal.

## Times measured here

All on one machine (the cloud container this was written in): the app, the
mock content service and Chromium on localhost, and a scripted model that
answers at once. So each is a FLOOR: it has no network, no provider and no
real content service in it.

| What                                                                   | Time                                    |
| ---------------------------------------------------------------------- | --------------------------------------- |
| A 6-tool turn on the site, prompt to end (4 runs)                      | 0.27 to 0.36 s                          |
| One model round trip over the socket, with nothing to think about      | about 25 to 30 ms (7 in 0.17 to 0.23 s) |
| A reading code tool on the site (one request)                          | 10 to 20 ms                             |
| `create_patch` (validate, write to the store, answer)                  | 40 to 50 ms                             |
| Bundle `examples/tanstack`'s `val.modules` + evaluate, native rolldown | 48 + 16 ms cold, 22 + 8 ms warm         |

One printed trace, from `e2e/http/turnTrace.spec.ts`:

```
assistant turn a94b5f86-...: response, 0.36s (code tools), gpt-5.1
  first message 0.05s, first text 0.05s
  model 0.22s over 7 round trips (0.16s of it silent)
  tools 0.13s over 6 calls
    create_patch: 1 call, 0.05s (max 0.05s)
    edit_file: 1 call, 0.03s (max 0.03s), 1 failed
    list_files: 1 call, 0.02s (max 0.02s)
    search_code: 1 call, 0.02s (max 0.02s)
    read_file: 1 call, 0.01s (max 0.01s), 1 failed
    get_all_schema: 1 call, 0.00s (max 0.00s)
  no code written
```

## What could not be measured here, and how to get it

**A turn in code mode that stages code**, which is the one this is about:
the tool's seven requests against real content, the tab's evaluation
(rolldown's WebAssembly in a worker), the quick preview built by Val Build,
and the page loading again with it. Three things are missing here:

- No app the e2e suite starts is served as a proposal (`VAL_PROPOSAL`,
  `VAL_OVERLAY`): `examples/tanstack` does not hand `initValServer` a
  proposal, so the Studio there is always on the site, where `edit_file` is
  refused.
- `e2e/mock-content-host` answers the assistant's socket and a proposal's
  files, but answers the quick preview as "Val Build is off".
- The model is scripted. Its share of a real turn is not in any number above.

### Capturing a trace on a deployed project

1. Open the Studio of a proposal with code mode on, in Chrome.
2. In DevTools' console: `localStorage.setItem("val:debug", "1")`, then
   reload. (Without it the turn is still recorded; it is only not printed.)
3. Send the assistant a prompt that changes code, for example "make the
   heading on this page red". Wait for the turn to end AND for the preview
   to show the change.
4. In the console: `copy(__VAL_AI_TURNS__.text())` and paste. For the
   timeline as well, `copy(__VAL_AI_TURNS__.json())`. `__VAL_AI_TURNS__.turns`
   holds the last ten turns; `text(1)` is the one before the last.

Read it as: `model` is the provider and the content service; `tools` is the
Studio and its requests; "change visible at" is prompt sent to the quick
preview showing the last write, and the number in brackets is how long after
that write's answer. Run the same prompt three times: the model's share
varies more than anything else.

For the requests behind a slow tool, the Network panel filtered to
`/api/val/proposals-api` and `/api/val/publish-api` shows them, in the order
the tables above name.

## What the trace covers, and where it misreports

| Flow                                                                     | Covered?                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A content-only turn                                                      | Yes. "No code written": when a content edit shows in the preview is not traced.                                                                                                                                                                              |
| A turn on the site (no proposal)                                         | Yes. `codeTools` says the code tools were offered, which is not code mode being on.                                                                                                                                                                          |
| `ask_user_question`, `request_code_mode`, `request_web_search`           | Yes: person time, by tool name.                                                                                                                                                                                                                              |
| A call held after a web search, or before `interact_page` submits a form | Yes, marked where it is held (`reportWaitingOnPerson`). The whole call counts as the person's from the moment it is held, including the part that runs after they allow it.                                                                                  |
| `request_code_mode` on the site                                          | The page reloads into the proposal, so the socket closes: the turn ends `disconnected` and the next page starts with no turns.                                                                                                                               |
| A cancelled turn                                                         | Ends `cancelled` when the server says so. Tools still running then are dropped from the trace, unfinished.                                                                                                                                                   |
| The socket closing mid-turn                                              | Ends `disconnected` at the close. The turn does not continue on the new socket, so nothing more is traced.                                                                                                                                                   |
| The commit summary (`useCommitSummary`)                                  | Traced as its own turn, `hidden`. It never takes a quick preview from a chat turn.                                                                                                                                                                           |
| Someone else's turn in a shared chat (`ai_watched`)                      | Not traced: no tool of it runs here.                                                                                                                                                                                                                         |
| Demo mode                                                                | Not checked. The assistant's socket is opened only when the server's config names a project, and nothing in this repository gives the in-tab server one; the demo site's own config is in valbuild/home. If it runs there, it is traced like any other turn. |
| fs mode                                                                  | Traced when the assistant is on (a project and a login). No code tools are offered there.                                                                                                                                                                    |
| The quick preview is off (Val Build does not build the project)          | "Change visible" stays empty: the change shows when a build is served, which is not traced.                                                                                                                                                                  |
| A quick preview nobody's turn caused                                     | MISREPORTS: one shown within two minutes of a turn that wrote code is counted as that turn's, whether it came from the button, another person's staging or the next build's files. A later turn takes over as soon as its prompt is sent.                    |
| A quick preview that read the proposal just before a staging landed      | MISREPORTS for a moment: it counts as showing the write until the next one, which the staging starts, replaces it. If that next one fails (quietly, since it started by itself), the trace still says the change is visible.                                 |
| `quick_preview`, the tool                                                | Its time is tool time, and the preview it shows is recorded as "asked for".                                                                                                                                                                                  |

## Other slow things seen while reading

Not fixed here; each is someone's to decide.

1. **The evaluation reads the project a second time.** `edit_file` reads
   the site's source and the proposal's files, stages, and then
   `studioStagedCodeDeps` reads both again plus the build target, with a
   publish client made for that one call, so the site's source comes whole
   (no `If-None-Match`). Three of an edit's seven requests.
2. **The site's source is asked for on every tool call.** A 304 is small,
   but it is a round trip through the app to content, in front of every
   read.
3. **Code mode is read before every write** (one GET of the proposal).
4. **Reading tools of one model reply share nothing.** They run at once,
   and each makes its own two requests for the same project.
5. **The quick preview reads the proposal twice** a second apart, for the
   same `staged.inputs`, and may read it a third time: `useCodeModeQuickPreview`
   reads again when the project's `seq` moves, which a staging also does.
   The third was not counted (the test's `seq` does not move).
6. **The Code changes pane reads the site's source whole on every change**
   (a publish client per read).
7. **The proposals bar reads the whole list of proposals** on every staging.
8. **Writes are one at a time, and each waits for its own evaluation**: N
   edits in one reply cost N evaluations, where one after the last would say
   the same.
9. **The background typecheck does not start after an edit.**
   `scheduleTypecheck`'s comment says "after each edit, and on Build", and
   its only caller is the build's `start` in `useAI.ts`. Not slow, but the
   opposite of what is written.
10. **On the server, staging saves pending content first**
    (`beforeProposalCodeWrite`). Inside the `POST files` request, so it is in
    the tool's time in a trace; not measured on its own.
11. **A socket that drops mid-turn leaves the chat streaming.** Nothing in
    `useAI.ts` settles a running turn when the socket closes; the person
    has to press Stop. Read from the code, not reproduced in a browser.
