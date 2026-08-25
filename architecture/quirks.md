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

**Two different functions answer "does this project use remote files", and they
disagree.** `hasRemoteFileSchema` (server, gates whether `/save` demands remote
credentials) only looks at `type: "file" | "image"` schemas, so it returns FALSE
for `s.images({ remote: true })` — a record of metadata, not an image schema.
`findRequiredRemoteFiles` (Studio, gates the `/remote/settings` fetch) has a
`record` branch that checks `mediaType && remote`, so it returns TRUE for the same
schema. A remote gallery therefore makes the Studio ask for remote settings while
leaving publishing unguarded, and a remote _field_ guards publishing too.

**One remote image or file field anywhere makes EVERY publish need remote
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
