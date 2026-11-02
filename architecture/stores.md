# The stores: the Studio's client state

An orientation, not the reference. The full design — every invariant, every
rejected alternative — is in
[`packages/ui/spa/stores/architecture.md`](../packages/ui/spa/stores/architecture.md)
(~850 lines), with the still-undecided parts in `openquestions.md` beside it.
Read this page first; go there when you need to change something.

## The one rule

**A change _marks_; demand _computes_.**

Nothing recomputes because something changed. A render happens because a listener
exists at that path; a search happens because there is a query. So a 40-keystroke
burst costs no renders and no validations — then exactly one of each on the next
read. This is what replaced a 5,500-line god object that invalidated the whole
project on every edit.

## Ten stores, two realms

The line between them is drawn by one constraint: `Schema` instances carry the
user's `select` / `render` / `validate` closures, and **closures cannot be
structured-cloned**. So anything that executes one sits next to one.

- **Host** — source, schema, patches, render, validation, stat, status
- **Worker** — search, patch sets, references

## Reading: `peek` to render, `get` to demand

Every read hook `peek`s synchronously, so a mounting field paints once rather
than painting `loading` and then the value. It then `get`s from an effect, which
is what asks for work.

`peek` is **reference-stable** — the same object back for an unchanged answer —
in the source, validation and render stores. It has to be: a `useSyncExternalStore`
snapshot that changes identity every call re-renders forever. Never by an
invalidation list: a list of call sites has to stay complete forever and fails
silently when it does not.

- **The source store's `peek` is stable by key**: the module's view, its schema,
  its revision and its entry fetches. The answer is worked out once per key and
  handed back while the key holds, and each part of the key is replaced in ONE
  place -- the view where a module is computed (`SourceStore.refresh`), the
  revision in `bump`, the fetches in `fetchMoved`, the schema in `SchemaStore`
  -- so a new way for source to change has to go through one of them.
- The validation and render stores, and `entriesStatus`, are stable by
  **recompute-and-compare**: the answer is computed again and the old object
  kept when it is the same answer.

> The two worst bugs on this branch were both this rule broken. `substituteJsonEntries`
> was copy-on-write, so one loaded `.jsonValues()` entry made `peek` of the module
> root return a fresh object per call — and the page died with "Maximum update
> depth exceeded" from inside a Radix ref callback that mentions nothing about
> source.

## What a field reads: the engine, at a version

Since phase 5 of [`docs/plans/one-content-model.md`](../docs/plans/one-content-model.md)
the source store holds each module's **base**, the base content of the
`.jsonValues()` entries it has read, and the **chain**, and everything a field
reads is the Studio's VIEW of those (`stores/studioView.ts`): `withLocalEdits`
(what this Studio wrote that the server has not confirmed) over `chainSource`
(the base with the part of the chain the server has), through THE engine --
`applyPatchRecord` in `@valbuild/shared`, the one Val's server applies patches
with. So where a file's `patch_id` lands, what an edit inside an entry does and
what a whole entry added does are the server's rules, and the Studio's source
carries `patch_id` where the server's does (the relay stamped it with
`withFilePatchIds` before).

- **A version per module, computed by the Studio** (`SourceStore.versionOf`):
  the schema it holds, the base its chain is applied to, and the chain of the
  patches that applied, unconfirmed ones included. Hashed when content changes
  (a schema or base arriving, a patch applied), never on a read. Once the server
  has the chain, it is the server's version for it: confirming is not a change.
- **The last two versions per module are kept** (`VersionRing`), by the ids
  they were computed for: a keystroke extends the newest by its one patch (one
  engine apply, its path copied, whatever the module's size), and discarding the
  newest patch is the version before it, applied again by nothing.
- **A patch that does not apply is passed over** and the rest still apply; the
  version names what applied. The server stops at the first failing patch
  instead -- the two agree once the Studio's discard of it lands, which is what
  happens to every patch that does not apply (`discardUnapplicable`).
- **The engine reads only where `.jsonValues()` records are in the schema**
  (`engineSchemaKey`), so a code change that does not move them changes a
  module's version and not one object of its content: nothing repaints, and
  nothing is relayed.
- **Waking after a recompute is by `===`**: a drop, an intake, an entry read and
  a publish wake the listeners whose read moved, compared with the view before
  -- the engine shares what it did not touch. A patch applied still wakes by its
  paths, so a field's own edit can leave it asleep.

## Waking: per path, and never yourself

Notification is per **path**, not per module — typing one character used to wake
every mounted field in the module. And a field's own writes never wake it, keyed
per field _instance_, because one path can be rendered twice (studio field and
inline overlay). A controlled input re-rendered by its own keystroke loses the
caret.

An editable field gets its identity from **`useValField`**, which mints the id
and never hands it out. That is not sugar: a field registers more than one
source listener — resolving its schema needs source too — and every one of them
has to carry the same id or the field is a second instance to itself.

> The other half of this rule lives one layer up, and it is easy to undo:
> nothing mounted per field may subscribe to a whole-project hook.
> `perFieldSubscriptions.test.ts` is the guard, and it covers every file under
> `components/fields/` plus the per-field components outside it.

Corollary worth knowing: **suppression means a field does not see its own edit
land.** Anything read on a render path that moves with the _patch chain_ rather
than with source — "do I have an unsaved edit" — must therefore be read fresh on
each render rather than memoised beside the source read. Memoising it froze an
array field's drag handle permanently.

## Writing: one writer, one linear chain

The server keeps one linear patch chain and checks every `parentRef`; two writers
would 409 on every keystroke. One patch per edit, not per typing burst — merging
is what made the two chains disagree.

The parent is the chain's **head** as the server reports it (`headPatchId` on
`/stat`), never the last id `/stat` listed. The list leaves out what the running
deployment already contains, and a published patch can come after a pending
one (a publish that held changes back) — so "the last patch I was shown" can be
behind the head for good. The head is a fact about the whole chain and only the server has it; see
`PatchSync`'s docblock and the entry in `quirks.md`.

`/stat` is polled and is the authority on **order**, not on existence. A response
describes the server as it was when the request was _issued_, so a stat can omit a
patch that exists. A patch that disappears from stat is therefore **verified**
with a fresh `GET /patches` before it is dropped, which is also why no sequence
number is needed anywhere.

A patch that cannot be applied is **deleted** (server included) and logged: it can
never produce a value, and leaving it blocks every later save to its module.

## Base and chain come from ONE build

What the Studio shows is base + chain. The base is the source in the bundle it
loaded; the chain is what `/stat` lists, and `/stat` lists the patches THE
BUILD THAT ANSWERED does not contain. After a publish those can be two builds
for a while (a tab opened before it, a managed project's pointer lagging per
location), and one build's chain on another's source drops edits or applies
them twice — invisible for a `replace`, a reordered list for a `move`.

`BaseAlignment` holds the line. `/stat` carries the answering build's
`sourcesSha`; `HostStore` folds the bundle's source with the same
`computeSourcesSha` the server uses. On a mismatch the stat is not adopted until
that build's base (`PUT /sources/~?apply_patches=false`) and the records its
chain names are here; then, in one turn, shipped patches leave the chain,
`SourceStore.rebase` replaces base AND chain in the server's order, and the stat
is adopted. Order matters in the backward direction: an older base needs patches
that come BEFORE the ones already held, so appending them (what `receive` + a
plain `patch:receive` would do) is wrong. `baseAndChain.test.ts` is every
combination, over time, sampled at the end of each turn.

## Where things live

| you want                                   | look at                                           |
| ------------------------------------------ | ------------------------------------------------- |
| the read hooks a field uses                | `packages/ui/spa/components/ValFieldProvider.tsx` |
| how a patch gets INTO source               | `SourceStore.intake` and `PatchIntake`            |
| source, versions, `.jsonValues()`          | `stores/SourceStore.ts`                           |
| the view: the engine over base and chain   | `stores/studioView.ts`                            |
| the chain, `/stat` reconciliation, uploads | `stores/PatchStore.ts`, `stores/PatchSync.ts`     |
| wiring, publish, discard                   | `stores/createSystem.ts`                          |
| a fake server to test against              | `stores/testSystem.ts`                            |
| what a store _did_, not what it announced  | the activity channel, `stores/activity.ts`        |

## Debugging in a browser

`window.__VAL_STORES__.system` is the live system: `sourceStore.peek(path)`,
`patchStore.allRecords()`, `patchStore.filePatchIds()`,
`validationStore.validate(module)`. `__VAL_STORES__.received` flips when intake is
done — wait on that rather than on a timeout.

For a render loop, the fastest route is a fiber census: install a minimal
`__REACT_DEVTOOLS_GLOBAL_HOOK__` before load and record the component tree on
every commit. A tree that is _identical_ across commits says the loop is a pure
re-render, which sends you to the snapshot the fields are reading rather than to
whichever component React blamed.
