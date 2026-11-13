# One field write re-renders the Studio

Status: fixed for the three things below; what is left is listed at the end.

Typing in the Studio felt laggy, and more so when the value being changed is
shown in several places. This is what one field write cost, how it was
measured, what was changed, and what it costs now.

## How it is measured

Two scripts, the same typing: the TanStack showcase's `/landing` in the
canvas, Edit on, the hero title picked on the page so the cursor is in its
field in "On this page", then characters typed 120 ms apart. How to run them
is at the top of each file. Neither is a test: they type into real content
and discard every unsaved patch, so no Playwright project picks them up.

- `e2e/measure/studioWriteLag.measure.ts` takes a CPU profile of the
  Studio's tab and prints the busy time per quarter second. The canvas is a
  same-origin frame, so the page's work is in the same profile. It says how
  LONG.
- `e2e/measure/studioWriteRenders.measure.ts` counts, for each React commit,
  the components that rendered, and names the ones that woke with what moved
  for them (a store snapshot, a state, a context, a `memo`'s props). It says
  WHO, and it is the one to compare before and after a change: milliseconds
  move with the machine and the build, a count of renders does not. It types
  twice, because the first write to a page is also when the page gets its
  draft marker and Publish becomes possible; the second is what every write
  after it costs.

Development build. React's development build renders several times slower
than production, so the milliseconds are high; the shape is what matters.

## What it found

Keystrokes are cheap: a keystroke updates the field's own state, two
components. The cost is the WRITE, 250 ms after the last key
(`FIELD_WRITE_DEBOUNCE_MS`) or every 2 s while typing continues
(`FIELD_WRITE_MAX_WAIT_MS`), so typing without a pause froze in the middle
of a word.

One write was nine commits of the Studio's React root, each of about 1,500
components: the whole shell (`ValShellBody`, `Shell`), every `Field` and
"On this page" row, the sortable lists, the union's select. Each commit had
its own cause, and none of them was the value that was typed:

| What woke                                                                 | Why it was a render of everything                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ValProvider`: the chain's version, the count of unsaved patches          | Its context value was an object literal, so every render of it rendered every reader of the mode, the config or the client.    |
| `ValShell` / `useShellData`: the patch ids, every module's source         | A new `ShellData` is a new prop of the whole shell.                                                                            |
| `ValShellBody`: a dozen hooks on the chain's version, the sync state      | It builds the shell's props; its callbacks are new on each render, so nothing below it can hold.                               |
| The patch sets, grouped again in a worker a moment later                  | A new list in `useShellData`, though only Recent activity and the draft markers read it.                                       |
| The save going through: unsaved 1 → 0, sync state saving → in sync        | Read in `ValShellBody`, for the status bar.                                                                                    |
| `/stat` answering: a new config object, a new time on the content's holds | The context again, and `ValShellBody` through it.                                                                              |
| The project's `seq` moving, and again when it had settled                 | Two hooks in the shell follow it, to re-read a proposal. Outside a proposal there is nothing to re-read.                       |
| The page reporting its fields again after showing the edit                | Held in `ValShellBody` as the elements with their places on the page, which move when a title grows; only the paths were read. |
| "Saving…" going back to "All changes saved"                               | A state in `ValShellBody`.                                                                                                     |

Below the shell, every field of the module rendered twice more for each
write on its own account: its validation hook kept a counter that every
result and every invalidation of the module bumped, and `ArrayAndRecordTools`,
which every field mounts, read every module's source and the write queue for
a scan only a record's entry needs.

- The page is sent ONE content update for the whole burst of typing, so the
  canvas is not what made typing lag.
- "Shown in several places" fits: every open editor of a value rendered on
  each write, and so did every element tagged with it on the page.

## What changed

**1. A write does not render the shell.**

- `ValProvider`'s context value is one object per change to what it holds,
  and each field of it is kept while it says the same (the config by
  content: every `/stat` answer parses a new one). The provider itself no
  longer hears the chain. What content holds is a store in a context of its
  own, since it is heard again after every write.
- The hooks that derive something from the chain or the sources hand their
  reader a new answer only when the answer moved (`useStoreValue` in
  `stores/react/useStoreValue.ts`): which patches are committed, whether
  anything nets out to a change, the settings module, a list of modules'
  sources. They used to subscribe to a version number, which cannot bail out.
- What a write does move in the shell -- whether it is saved yet, the
  pending and review counts, Recent activity, what Discard all would discard
  -- is read in `ValShellLive`, below `ValShellBody`, and shown from a store
  (`components/shell/ShellLive.tsx`) by the component that shows it: the
  status bar for the save state, the top bar for the count. `Shell`'s props
  are what they were; the rest of it is `ShellFrame`, a `memo`.
- `useShellData` reads nothing that moves per write, and its answer is kept
  while it says the same all the way down. The draft markers are read off
  the chain rather than off the patch sets.
- Hooks the shell needs only some of the time take `watch`: the count of
  changes to review (in a proposal, under a refusal), the project's `seq` (in
  a proposal).

**2. A field whose value did not change does not render.**

- A container lists its fields as `LabeledField`, a `memo` of the label and
  tools around the input, whose props are a path, strings, booleans and the
  item's schema. Typing in a section's title used to render its tagline, its
  list of bullets and every row of that list.
- A field looks its own path up in a validation result and renders when its
  own errors are different (`useValidationErrorsAtPath`).
- `useKeysOf`, `useEagerRouteReferences` and `useJsonValuesLoad` subscribe to
  every module's source only where there is something to scan or load.
- "On this page" asks which fields are changed after a write, in a task of
  its own, and renders when that set moved; its rows are a `memo`. A sortable
  list keeps the rows it has when it is handed the same ones.

**3. The server's confirmation renders the status bar and the Publish
button.** With the above, what the confirmation moves is the unsaved count
and the sync state, both read in `ValShellLive`, and the content's holds,
which nothing renders for unless a publish is running.

Three guards keep it so: `shellLive.test.tsx` renders `Shell` and moves the
live props, `shellWriteSubscriptions.test.ts` forbids the per-write hooks in
`ValShellBody` and `useShellData`, and `perFieldSubscriptions.test.ts` now
covers `ArrayAndRecordTools` and `useKeysOf`.

## Before and after

Component renders after the last key, from
`studioWriteRenders.measure.ts`:

|                               | Commits | Components rendered |
| ----------------------------- | ------- | ------------------- |
| Before                        | 9       | 13,365              |
| After, the first write        | 8       | 1,037               |
| After, the next write         | 8       | 310                 |
| While typing (before = after) | 1 a key | 2 a key             |

The next write is 158 for the write itself (the field typed in, the section
it is in, the Publish button), 61 for the top bar's count and the status
bar's "Saving…", 49 for the save going through, and 42 for "All changes
saved". The first write is that plus the shell once (710): the page gets its
draft marker in the navigation and under the heading, which are the shell's
data. Neither `ValShellBody` nor `ShellFrame` renders in a later write.

Busy time, from `studioWriteLag.measure.ts`, three runs each, in the cloud
container the fix was made in. It is about four times slower than the laptop
the problem was first measured on, where the write was about 200 ms, the
page about 130 ms and the confirmation about 120 ms.

| When                             | Before (ms)       | After (ms)    |
| -------------------------------- | ----------------- | ------------- |
| The write, and the page after it | 740, 827, 791     | 188, 152, 169 |
| The server's confirmation        | 303, 269, 292     | 10, 8, 9      |
| Long tasks in the run            | 6 or 7, 63 to 200 | 1, about 95   |
| While typing, per quarter second | under 50          | under 50      |

About 100 ms of what is left of the write is the page in the canvas reading
the module again (`routeRead`, `autoTagJSX`, the route's components): the
one long task. That is the page's work, not the Studio's.

(Both before and after, the first quarter second after the profiler starts
is about 700 ms busy with no application frames in it. It is the profiler,
and is not counted above.)

## What is left

1. **The first write to a module renders the shell once.** The draft marker
   on its row and under its heading is part of `ShellData`. Reading it where
   it is shown (`PagesPanel`, `DataPanel`, the editor's heading) would take
   it out.
2. **In a proposal the shell still renders per write.** Save's count is an
   input of `useProposalsBar`, which builds most of what the shell shows
   there, and the project's `seq` is followed. Not measured: the measurement
   runs in `fs` mode, where there are no proposals.
3. **A field's tools render when a sibling is written.**
   `ArrayAndRecordTools` reads its parent (`useParent`) to know whether it is
   an entry of a record or an array, and the parent's value is a new object.
   Two per write here; it grows with the fields of the object. The fix is
   for `useSchemaAtPath` to hand back the schema it resolved only when that
   moved, which is a change to the read every field makes.
4. **A list renders its rows when an item in it is written.** The sortable
   list's context (`DndContext`) does not hold.
5. **The page in the canvas** re-reads the module and re-tags its elements:
   about 100 ms of a development build, once per burst of typing.
6. **`http` mode is not measured.** The confirmation there arrives over a
   socket and with a manifest; the same readers are involved, and the mock
   content host would let the two scripts run against it.

Read `architecture/stores.md` first, "A reader renders when its answer
moves": it is the rule the above is an application of.
