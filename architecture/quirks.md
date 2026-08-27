# Quirks

Things that are true, surprising, and have each cost someone an afternoon. Add to
this file when you lose time to something a comment could not have told you.

## Authoring

**`export default c.define(...)` must be written inline.** Assigning to a const
and exporting that loads and validates fine, then fails at _publish_ — the server
rewrites the `.val.ts` through its AST and refuses with `Expected default
expression to be a call expression`, having written nothing. So this is broken:

```ts
const gallery = c.define(...);
export default gallery;   // publishes never land
```

**A referenced module must be in `val.modules.ts`.** `s.image(galleryVal)` with the
gallery unregistered renders a field that refuses uploads, with the reason in the
UI. Easy to miss when adding a new module.

## Arrays

**An array item's path is positional** — `?p="0"`, `?p="1"`. A reorder does not move
paths; it moves _content between fixed paths_. Two consequences:

- The list of paths for an array is **unchanged** by a reorder, so "did the array
  reorder" cannot be answered by comparing paths.
- An "uncontrolled" list that holds its own order is **wrong**: the local
  permutation plus the patch's permutation cancel out, and the drag silently does
  nothing. Measured. `SortableList.tsx` carries the note.

## Media

The `/public` URL rule and the `appliedAt` gate — see [media.md](./media.md). The
short version: an uncommitted `/public` path returns **200** in `next dev` (the
app's HTML), so only decoding an image tells you whether it really loaded.

## React in the Studio

**`useValConfig()` returns a ref, filled by an effect.** So the render where config
arrives still sees `undefined`; only the render _after_ that sees it. This makes
config-dependent early returns a hook-order trap, and makes reproducing one in a
test need three renders rather than two.

**Hooks below a guard are a crash waiting for a null value.** Both media field
components did this: an early return for `loading` / `not-found` / `config
=== undefined`, then a `useMemo`. A field whose value is `null` takes the return
on one render and runs more hooks on the next — "Rendered more hooks than during
the previous render", from inside `useMemo`, with nothing in the message about
media. Compute hooks unconditionally and defensively; guard after.

**A context value built inline is a fresh object every render.** Harmless until
something downstream takes it as a `useMemo`/effect dependency — then it is the
whole subtree recomputing per keystroke. `FieldSourceOverrideContext` in the
compare view was exactly this.

**React blames the wrong component for a render loop.** The error surfaces
wherever the update budget ran out — typically a Radix ref callback, whose JS
stack is pure Radix. Do not start there; census the fiber tree instead
(see [stores.md](./stores.md#debugging-in-a-browser)).

## Remote files and proxy mode

**"Does this project use remote files" is `hasRemoteFileSchema` in
`@valbuild/core`, and only that.** There used to be two — the server's, gating
whether `/save` demands remote credentials, and the Studio's
`findRequiredRemoteFiles`, gating the `/remote/settings` fetch — and they
disagreed about `s.images({ remote: true })`. A media collection serializes as a
`record` of metadata with the file named by the KEY, so a walk that only recurses
into `item` finds no image schema and says no; that was the server's answer. If
you add a schema type, teach that one function about it: the `never` assignment in
its default branch is what makes forgetting a compile error.

**A `false` there is silent, not safe.** `saveOrUploadFiles` in `skip-remote` mode
does not merely skip the upload — its loop over remote descriptors is inside the
`upload-remote` branch, so every remote file is dropped with no error. The commit
then lands a remote ref with no bytes behind it. That is why the function throws on
an unknown schema type rather than returning `false`, and why the Studio catches it
at its one call site instead.

**One remote image, file or gallery anywhere makes EVERY publish need remote
credentials.** `/save` in `fs` mode calls `getIsRemoteRequired` over all schemas,
and a single `true` switches the whole save into `upload-remote`, which needs an
api key or a `.val/pat.json`. A local checkout has neither, so adding one
`s.image().remote()` stops a project from publishing plain text. This is why the
example app's remote gallery is opt-in (see `examples/next/val.modules.ts`).

**Every commit failure reads "Unknown error".** `ValOpsHttp.commit` parses the
error body with zod and then passes the _safeParse result_ — not the payload — to
`getErrorMessageFromUnknownJson`, so the service's own message never survives.
When a publish fails in proxy mode, read the content service's log, not the
Studio's.

**A remote upload and the commit that ships it key the same file differently.**
The browser uploads bytes under the file path (the store splits the ref first),
while `prepare` describes the file by its full remote ref. The content service is
what reconciles them.

**The `val_session` cookie is percent-encoded on the wire.** `initValServer`
writes `encodeURIComponent(value)` into `Set-Cookie` and the read side decodes, so
a hand-made session cookie has to be encoded too — an HMAC signature is base64 and
routinely contains `+` and `/`. Sending it raw decodes to something else and reads
as "you will need to login again".

**The deployment UI is not mounted.** `DraftChanges` is the only component that
renders `useDeployments()`, and nothing imports it as a component. Deployments and
commits still arrive over the WebSocket and still land in provider state; there is
just nothing on screen.

## Patches

**`GET /patches` with no `patch_id` returns every patch.** The filter is applied
to a table the endpoint already holds, so an absent filter is not "none" — it is
"all". Two ways to trip on it:

- Building the query from a list that happens to be empty sends an unfiltered
  request and pulls the whole project's pending changes.
- "I asked for 5 and got 400 back" is not a bug in the server.

The ids go on the query string as repeated `patch_id` params, and there is no
paging. At ~46 characters each, a few hundred pending changes overruns the 16KB
of request head Node accepts, so the studio chunks them
(`packages/ui/spa/stores/react/patchIdChunks.ts`). Dropping the filter instead
would return the same set today, but then "did I get what I asked for" has no
answer — which is the question that catches a server sending back less than it
announced.

**An id that comes back in neither `patches` nor `errors` means "the server does
not hold it".** That silence is how a deleted patch is observed, so it is not an
error in itself. Whether it is a _fault_ depends on something outside the
response: if `/stat` announced the id, the server has contradicted itself and the
studio reports it; if stat has stopped naming it, it is simply gone. Get those
two backwards and you either resurrect deleted edits as permanent failures, or
wait forever on changes that will never arrive — the second of which is a real
bug that shipped. See `architecture/patch-store.md`.

## Testing

**`packages/ui` has no jsdom by default**, and importing a field component pulls in
`createValSystem` → the validation worker → `new Worker(new URL(..., import.meta.url))`,
which jest cannot parse. Mock `../validation/schemaValidationBridge` at that seam.

**A render error in jsdom is console noise, not a failed test.** The DOM committed
before the throw still asserts fine, so a test can pass against a crash. Wrap the
subject in an error boundary that records the message and assert on that.

**`rerender()` with the same element reference lets React skip the subtree.** Build
a fresh element each time or the probe never runs again.

**The e2e file input picker is ambiguous.** The AI chat has its own
`input[type="file"]`, and it is `multiple`. Select the field's with
`input[type="file"]:not([multiple])`.

## Dev environment

**After `pnpm run build`, run `pnpm preconstruct dev`** or downstream packages keep
resolving `dist/`. Also delete `examples/next/.next` — a production build left
there makes the dev server 500 with `MODULE_NOT_FOUND` on Studio routes.
