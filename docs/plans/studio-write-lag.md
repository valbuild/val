# One field write re-renders the Studio

Status: measured, not fixed.

Typing in the Studio feels laggy, and more so when the value being changed is
shown in several places. This is what one field write costs, how it was
measured, and where a fix would start.

## What was measured

`e2e/measure/studioWriteLag.measure.ts` (how to run it is in the file): the
TanStack showcase's `/landing` in the canvas, Edit on, the hero title picked
on the page so the cursor is in its field in "On this page", then 15
characters typed 120 ms apart, with a CPU profile of the Studio's tab. The
canvas is a same-origin frame, so the page's work is in the same profile.

Development build. React's development build renders several times slower
than production, so the milliseconds are high; the shape is what matters.

## What it found

| When                                                  | Busy        | What                                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| While typing                                          | < 10 ms/¼ s | Cheap. A keystroke updates the field's own state only.                                                                                                                                                        |
| 250 ms after the last key (`FIELD_WRITE_DEBOUNCE_MS`) | ~200 ms     | The write: `useDebouncedFieldWrite` → `writePatch` → `createPatch`, then a render of the whole shell (`ValShellBody`, `Shell`), every `Field` and `CanvasFieldRow`, `SortableItemRow`s, the union's `select`. |
| Right after                                           | ~130 ms     | The page in the canvas re-reads the module (`routeRead`, `autoTagJSX`, the route's components), and the Studio renders again.                                                                                 |
| ~2 s later                                            | ~120 ms     | The server confirms the patch, and the same Studio tree renders again.                                                                                                                                        |

- The page is sent ONE content update for the whole burst of typing, so the
  canvas is not what makes typing lag.
- `FIELD_WRITE_MAX_WAIT_MS` is 2 s, so typing without a pause still writes
  every 2 s, and freezes for the ~200 ms in the middle of a word.
- "Shown in several places" fits: every open editor of a value re-renders on
  each write, and so does every element tagged with it on the page.

## Where a fix starts

Do it on its own branch, and re-run the measurement before and after.

1. **One patch must not re-render the shell.** Something `ValShellBody` /
   `Shell` / `useShellData` reads changes on every write (a chain version, a
   patch count, the save state). Find it, and narrow it to the component that
   shows it.
2. **A field whose value did not change must not render.** `Field` is the
   biggest single item in every burst, for every field on screen, not only the
   one typed in. Find what it subscribes to that changes on any write.
3. **The confirm (~2 s later) must not render what the write already did.**
   If the server's copy equals the local one, nothing on screen changed.
4. Then the lists (`SortableItemRow`, `ArrayAndRecordTools`) and the union's
   select, which re-render with their parents.

Read `architecture/stores.md` first: marks vs demand, `peek` / `get`, and why
reference stability is load-bearing are exactly what decides which of these
re-render.
