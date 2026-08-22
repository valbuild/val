---
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/ui": patch
---

Show editors which change is blocking a publish, and let them remove it.

A patch that cannot be applied was invisible in the studio: `getPatchedSource` skipped it with a `console.debug` and kept applying later patches on top, so the compare view looked healthy, while `/save` refused the whole commit and `publish` reduced the 400 to a transient "Failed to publish changes". A single stale change could block a whole team with nothing to act on.

`/save` now returns `unappliablePatches` — the same failures as `sourceFilePatchErrors`, but keyed by patch id, which is what is needed to name a change and offer to remove it — and the studio records failures from both sides:

- **Client-side, before publish:** a patch skipped while applying the chain is recorded, so a conflict shows up as soon as it happens rather than at publish time.
- **Server-side, on publish:** the 400's details are merged in. This is the only way source-file-AST failures ever reach the studio, since the client applies patches to the evaluated json and cannot see them.

Entries are tagged with which side found them: a patch can apply client-side and still be rejected by `/save`, so the client must never conclude that a server-reported failure has resolved. Entries are dropped when their patch leaves the chain, immediately when an editor removes it.

This feeds `PatchErrorsDisplay`, which already rendered a "Remove change and fix issue" banner but was never populated, plus a new dialog listing each conflicting change with its field, author and age, a **Remove change** action, a link to review it in compare, and a copyable diagnosis to send to Val developers. The publish button is now disabled while any exist, with a tooltip saying how many — previously it stayed enabled and failed server-side.

Also: `ImageField` and `ModuleGallery` now always use `add` (never `replace`) for `metadata.alt` and `metadata.hotspot`. On an object key the two mean the same thing, but choosing between them by inspecting the client's optimistic source decides against a view a concurrent image upload can invalidate before the patch is applied — the `replace` then fails at publish with "Cannot replace object element which does not exist". `add` is create-or-set in both the json and source-file ops, so it is strictly more robust.
