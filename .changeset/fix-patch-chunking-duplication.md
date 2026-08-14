---
"@valbuild/server": patch
---

Fix publishing being impossible once a project has more than 100 pending patches.

`ValOpsHttp.fetchPatches` splits the requested patch ids into chunks of 100 to keep the query string short, and concatenates the responses. But the content api's `/applicable/patches` returns **every** applicable patch per request and ignores the `patch_id` filter, so the concatenation repeated the whole chain once per chunk: 217 pending patches came back as 651. `prepare` then applied every patch three times, which is destructive for array ops — three `remove` patches became nine removes — and the commit failed with `Array index out of bounds` or `Cannot replace object element which does not exist`.

Only `/save` and `/commit-summary` pass explicit patch ids, so this never showed up in the studio: the compare view applies each patch exactly once, client-side. And with 100 or fewer pending patches there is a single chunk, so nothing repeats. That combination is why it stayed invisible until a project accumulated a few hundred unpublished changes, and why the compare view looked clean while publishing kept failing.

The chunk responses are now deduplicated by patch id and filtered to the ids that were actually requested, preserving the api's ordering. Correct whether or not the api filters on its side.

Also fixed, same class of bug: `analyzePatches` pushed each patch id into `patchesByModule` once per non-file op, and `prepare` re-looks-up the patch by id and applies the whole patch for every entry — so a patch with two source ops was applied twice. Idempotent for `replace`, destructive for array `add`/`remove`/`move`. It now pushes once per patch, which also corrects the applied-patch ids reported by `/sources/~` and sent to the content service on commit.
