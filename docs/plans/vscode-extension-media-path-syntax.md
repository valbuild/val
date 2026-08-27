# Prompt: update `vscode-val-build` for path-based media

> **How to use this document.** Open a Claude Code session in the
> `vscode-val-build` repo and paste everything below the line. It is written to
> be self-contained — that session will not have any context from the Val
> monorepo work that produced it.
>
> **This file is scaffolding, not documentation.** It lives in the Val repo only
> until the PR for the media change exists; move it into that PR's description
> and delete the file. It is a companion to
> [vscode-extension-language-server-prep.md](./vscode-extension-language-server-prep.md),
> which covers the larger migration this extension is heading for. Read that one
> first if you have not.

---

## What changed in Val

`c.image(...)`, `c.file(...)` and `c.remote(...)` are gone. Media is now a plain
object literal with a `path`:

```ts
// before
image: c.image("/public/val/hero_a1b2c.png", {
  width: 944,
  height: 944,
  mimeType: "image/png",
});

// after
image: {
  path: "/public/val/hero_a1b2c.png",
  width: 944,
  height: 944,
  mimeType: "image/png",
  alt: "A hero",
  hotspot: { x: 0.5, y: 0.3 },
};
```

Three consequences that matter to an editor extension:

1. **There is no marker on the value.** `_ref`, `_type: "file"`, `_tag: "image"`
   and the whole `metadata` sub-object are removed, along with `FILE_REF_PROP`,
   `FILE_REF_SUBTYPE_TAG`, `RemoteSource`, `Internal.isFile`,
   `Internal.convertFileSource` and `Internal.convertRemoteSource`. Whether
   something is media can only be answered by the **schema**
   (`type === "image" | "file"`).
2. **Remote is a path, not a kind.** Anything outside `/public` is remote;
   `Internal.mediaUrl({ path, patch_id? })` replaces both convert functions.
3. **Validation error paths changed.** A media field's sub-paths are
   `"image"."path"`, `"image"."width"`, `"image"."alt"` — not `"image"."_ref"`
   and `"image"."metadata"`.

A gallery-backed field (`s.image(galleryVal)`) carries only `path` (plus `alt`
and `hotspot`). Writing `width` / `height` / `mimeType` there is now a validation
error: the gallery module holds them.

## What breaks in this extension

Verified against the files named in the companion document; re-check line numbers
against the current tree.

| Where                                                                                                | What it does today                                                                                          | What it needs                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/completionFieldSchema.ts`                                                                | Hand-rolled schema traversal that offers file paths inside a `c.image(` / `c.file(` call                    | The trigger is now "the cursor is in the value of a `path:` property", and the schema at the **containing object** decides whether it is media. See below.  |
| `server/src/valModules.ts` + `tsRuntime.ts`                                                          | Generates source that calls `Internal.getSchema(m)['executeSerialize']()`; evaluates `.val.ts` in `node:vm` | Unchanged in principle, but any generated snippet or fixture using `c.image` / `c.file` is now a syntax-level lie and will not typecheck in a user project. |
| Its own pinned `@valbuild/core`                                                                      | Re-interprets the user core's output; reads `_ref` / `metadata` by `in`-check                               | Those keys no longer exist. Silent feature loss — no diagnostic — which is the failure mode the companion document warns about.                             |
| `{client,server}/src/metadataUtils.ts`                                                               | Builds the metadata **object** to insert as a second call argument                                          | Metadata is now sibling properties of `path`. Insert them into the same object literal, and insert **nothing** for a gallery-backed field.                  |
| `client/src/commands/addToMediaGallery.ts`, `moveFileToGalleryDirectory.ts`, `removeGalleryEntry.ts` | Gallery record edits                                                                                        | **Unaffected.** Galleries always stored `{"<path>": {width, height, mimeType, alt}}` — that shape is what media converged on, not away from.                |
| `client/src/commands/{upload,download}RemoteFile.ts`                                                 | Rewrites a value between local and remote                                                                   | The value shape no longer changes, only `path`. The remote ref format is unchanged.                                                                         |
| `server/src/routeValidation.ts`, `client/src/evalValConfigFile.ts`, `mimeType/all.ts`                | Copies of Val code                                                                                          | Unaffected by this change.                                                                                                                                  |

## The completion trigger, concretely

This is the part worth copying rather than reinventing: Val's own language server
made exactly this move, and the implementation is in
`packages/language-server/src/{completionContext,completions}.ts`.

**Before:** find the innermost `ts.CallExpression` whose callee is `c.image` or
`c.file` and whose first argument (a string literal) contains the cursor. The
callee name gave you the subtype for free.

**After:** the cursor is in a string literal that is the value of a property
named `path`. Then:

- map the cursor position to a Val module path (`"image"."path"`),
- resolve the schema at the **parent** path (`"image"`) — resolving the cursor's
  own path would try to descend _into_ the image schema,
- if that schema's `type` is `"image"` or `"file"`, offer files; otherwise offer
  nothing.

Two things fall out of this that the old trigger could not do, and they are worth
implementing rather than skipping:

- **The field's own `directory` is honoured.** `s.image({ directory })` and a
  gallery-backed field should offer only the files that may actually go there.
  The callee name could never say this, so the old completion offered every image
  in the project.
- **`s.file({ accept: "image/*" })` filters correctly**, because the filter comes
  from the schema rather than from which constructor was called.

The cost: media-path completion now needs the project snapshot, which it did not
before. A file whose module is not registered in `val.modules` therefore gets no
media completions at all — that is correct (there is no schema), but it is a
behaviour change worth a log line.

**Do not trigger on the property name alone.** `path` is an ordinary property
name; a plain `s.object({ path: s.string() })` must not be handed a list of the
project's files.

## The metadata insertion

`completionItem/resolve` used to insert `, { width, height, mimeType }` after the
reference argument. It now inserts `, width: 944, height: 944, mimeType: "…"`
after the `path` property, and **replaces** any of those properties that are
already present rather than rewriting the whole object.

Keep two invariants:

- **Re-derive the offsets at resolve time.** The user types to filter the list
  after it was computed, so every offset captured then has moved. Val re-finds
  the object literal by the start offset of its `path` value
  (`findMediaPathObject`); applying stale offsets inserts text inside the string
  literal and corrupts the file. This was a real bug, and it has a test.
- **Keep the edits disjoint.** A client applies `additionalTextEdits` verbatim,
  and two overlapping ranges corrupt the file. One replacement per existing
  property, plus at most one insertion for all the missing ones.

## Versions

The change lands in the same release as the language server this extension is
being prepared for. Substitute the real number; nothing here depends on the
digits.

- A project on the new Val has no `c.image` / `c.file` / `c.remote` at all.
- A project on an older Val still does, and its content still uses them.

**The extension's bundled server must therefore keep working against both**, for
as long as `valBuild.useProjectLanguageServer` defaults to `false`. Gate on the
resolved `@valbuild/core` version rather than trying to detect the shape: a
project mid-migration can legitimately have both syntaxes in the tree while
`validate --fix` has not been run.

## Explicitly out of scope

- Migrating a user's content. `c.image(P, M)` → `{ path: P, ...M }` is mechanical
  and `val validate --fix` recovers any metadata lost in the process, but it is
  not this extension's job.
- Deleting the extension's own `server/` — see the companion document.
