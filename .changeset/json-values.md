---
"@valbuild/core": minor
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/next": minor
"@valbuild/react": minor
---

Add `.jsonValues()` — lazily-loaded content for large records and routers.

`s.record(...).jsonValues()` and `s.router(...).jsonValues()` move each entry's value into its own `*.val.json`, referenced from the `.val.ts` by a lazy thunk:

```ts
export default c.define(
  "/app/support/[slug]/page.val.ts",
  s.router(nextAppRouter, supportPageSchema).jsonValues(),
  {
    "/support/faq": c.json(() => import("./content/faq.val.json")),
  },
);
```

The `.val.ts` stays small at thousands of entries, and nothing — runtime, Studio or validation — has to hold every entry in memory to work with one of them. When Val is disabled the thunks are plain dynamic imports, so there is no overhead at all.

**Reading one entry.** `fetchValKey` / `useValKey` load a single entry by key, and `fetchValRoute` / `useValRoute` map route params to the matching entry and load only that one. `fetchVal` / `useVal` stay eager and resolve every entry, as before.

**In the Studio**, entry content is fetched on demand through a new batched `GET /api/val/json` endpoint: opening a record loads only the rows on screen (lists above 50 keys are virtualized), and un-loaded rows render skeletons rather than empty previews. Editing an entry writes only its `*.val.json` — the `.val.ts` is not touched — while adding, renaming and deleting an entry maintain both the file and the thunk.

**Reference integrity is preserved.** A scan for references cannot see inside an entry that is not loaded, so "no references" from such a scan is not an answer. Delete and rename now gate on a complete scan instead of on a bare count: the Studio decides from the SCHEMAS which modules must be loaded first (usually none, so the common case still costs nothing), shows progress while it loads them, and refuses to act — with a retry — if it cannot. Search loads entry content on the first query, shows results as they are found, and reports how far the index has filled.

Hand-authored and generated entries can coexist: Val writes new entries to a conventional path but keeps editing existing ones where they already live.

`.jsonValues()` is supported on a module's ROOT record or router only. A nested one is rejected at startup, because entry content there would silently go unvalidated.

Also exported from `@valbuild/core`: the `JsonSource` / `JsonOf` types and `Internal.isJson`, `Internal.getJsonImport`, `Internal.resolveJsonValues`.
