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

> The worst bug of the stores' rewrite was this rule broken. A copy-on-write
> substitution of `.jsonValues()` entries (since deleted) made one loaded entry
> turn `peek` of the module root into a fresh object per call — and the page died
> with "Maximum update depth exceeded" from inside a Radix ref callback that
> mentions nothing about source. The engine is copy-on-write too, which is why a
> view is made in one place and handed out by key.

## What a field reads: the engine, at a version

How content is versioned and loaded for every reader, the Studio included,
is [content-versions.md](./content-versions.md); this section is the
Studio's side of it. The source store holds each module's **base**, the base content of the
`.jsonValues()` entries it has read, the module at the version the **server**
names for it (the manifest's: see "The Studio reads the server's version"
below), and the **chain**, and everything a field reads is the Studio's VIEW
of those (`stores/studioView.ts`): `withLocalEdits` -- this Studio's own edits
the server's version does not have yet -- over the server's module, through
THE engine -- `applyPatchRecord` in `@valbuild/shared`, the one Val's server
applies patches with. So where a file's `patch_id` lands, what an edit inside an entry does and
what a whole entry added does are the server's rules, and the Studio's source
carries `patch_id` where the server's does.

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

## `.jsonValues()` entries load in batches

A read (`get`, a record's window) asks for its entry at once, and the reads of
one tick go out as ONE `GET /json` with `keys` (`chunkJsonEntryKeys`: 25 keys,
inside the URL budget). `loadAllEntries` -- search, "used by", a rename guard
-- is the bulk path: batches of as many keys as the URL allows, at most three
requests in flight across the store, behind every read, and what has landed is
applied after a `yieldToMain`, so a load of 10,000 entries is a few hundred
short tasks and the Studio stays usable. Either way what landed is applied as
one batch (`receiveJsonEntries`): one view, one revision, one wake -- the view
used to be rebuilt per entry, which made a full load quadratic. A caller that
stops waiting passes an `AbortSignal` and the unsent batches are dropped;
`retryEntries` is Try again. Budgeted in `scale.scenario.test.ts`
(`source:fetch-json-entries`, `source:apply-json-entries`).

An entry is read on a BASE, and the answer is for that base: every request
carries the base it was asked on (`SourceStore.entryBases`, a counter of the
tab's own, moved wherever the base moves -- a manifest's new base, a publish
baked in, a re-intake, a module gone). An answer that lands on a base the
module has moved off since is asked for again, under the promise its readers
already wait on, rather than applied: applied, the old base's content was the
new base's for good, because nothing asks for an entry that is already here
(`jsonValuesBaseMove.test.ts`).

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
patch that exists. A patch that disappears from stat is kept until the
**manifest** decides it (`PatchStore.decidedGone`): it is gone when the
server's version of its module does not have it AND that manifest was asked
for after this Studio held it (its record arrived, or its save was
confirmed) -- counted by `PatchStore.nextManifestEpoch`, a counter of this
tab's own, so no sequence number crosses the wire for it. It used to be
verified with a `GET /patches` per vanished patch; the version in hand
answers the same question.

A patch that cannot be applied is **deleted** (server included) and logged: it can
never produce a value, and leaving it blocks every later save to its module.

**Unless the code moved under it.** A patch that applied under its module's
previous schema and does not under the new one -- a field renamed or removed
under a pending edit -- is **held** (`StatusStore.held`, `HeldEditsBanner`),
not deleted: it is somebody's work. It stays in the chain, applies nowhere,
and refuses a publish (`held-edits`, since the save would remove it) until
the editor discards it or makes the change again where the field is now; an
edit that applies again (the code moved back) is released. The banner shows
what each held edit WROTE, to copy, and discards each on its own; a publish
refused for them offers "Show the edits" beside its message. "Applied under
which schema" is per patch, by `SchemaStore.version`, recorded when it applies
(`fittedUnder` in `createSystem`), so a Studio that never saw a patch fit -- one
opened after the change -- cannot tell, and deletes it as before: a patch
carries no schema version on the wire.

## New code comes in through one door

`HostStore.reloadCode(registry)` is how a `val.modules` registry reaches the
Studio, whatever brought it: the first one, HMR (`val-modules-updated`), code
the tab evaluated after a staging (`proposals/stagedCode.ts`), and a new
build's own registry (below). It reads the registry before it touches
anything -- one that cannot be read leaves the Studio on the code it had and
answers `kept` -- and answers which modules' schemas moved and which went. Replaced, not merged: a module no longer in the
registry goes. Downstream only the modules that moved are touched, because
`SchemaStore` and `SourceStore` compare by identity and an unchanged module
hands over the objects it did last time -- by instance for HMR, by content
(serialized schema and written source) for an imported bundle, whose
instances are all new.

## A new build's code, while the Studio is open

There is no "A new version has been deployed" dialog any more
(`SchemaFreshnessWatch` went in phase 9). Every manifest the Studio reads is
shown to `BuildCode` (`stores/buildCode.ts`) BEFORE it is adopted: where it
names a schema the Studio does not run -- for a module the Studio is not
ahead on -- the code moves first, so the content is never read into the old
fields.

- **A build the platform made names its registry** (`registry` on
  `GET /manifest`: the entry `@valbuild/tanstack-build` emits beside the
  build's client chunks, `/_app/val-modules-<build>.js`). The Studio imports
  it and hands it to `reloadCode` with what the manifest expects: another
  Val is not imported at all (`other-val-version`), and a registry whose
  schema versions are not the manifest's is not adopted
  (`not-the-manifest's`). Once per build. Only from the page's own origin
  (`registryEntryUrl`), and only for `REGISTRY_IMPORT_DEADLINE_MS`: an
  import that hangs is a registry that did not load, so the manifest is
  adopted without it rather than held up for good. A registry refused or
  not loaded does not supersede an earlier one still importing; only an
  adopted one does.
- **Local development (`fs` mode)**: HMR brings the code. Nothing happens
  here.
- **Anything else** (Next.js, a self-hosted TanStack Start, another Val, a
  registry that did not load): the page reloads itself, without asking, once
  the schemas have stayed apart for `STUDIO_RELOAD_GRACE_MS` and no edit is
  on its way to the server, an image's bytes included
  (`PatchStore.uploadsInFlight`: they go up before the patch exists, so
  "in sync" alone is true while they do) -- and only if this Studio's code and the
  server's have agreed once, so a page that loads on a build the server does
  not run never reloads into the same page.

## The Studio reads the server's version

What the Studio shows is the server's module at the version the server names
for it, with this Studio's own edits on top. After each `/stat` whose `seq`
moved, `ManifestSource` (`stores/manifestSource.ts`) reads `GET /manifest`
"since `seq` N" (a 304 while nothing moved), reads every module at the
version it names from the cheapest place that has it, and the source store
moves to them in ONE turn (`SourceStore.adoptServer`):

1. **What this Studio computed itself** -- its own edit, now confirmed. The
   version the server names for it is the one the Studio computed (same
   schema, base and patches), so it is found by its content in the
   `VersionRing`, or, when the editor typed on past it, by its patches alone
   (`SourceStore.knownChain`): what is shown extends it, and its content is
   made only if a discard needs it.
2. **The bundle's own module** -- a version with the empty chain on the
   bundle's base: nothing to read.
3. **Its server** (`originTier.ts`, `GET /modules/~<path>?v=<moduleKey>`):
   with the version held of the same schema and base as `have`, the answer
   is the patches from it, so another editor's keystroke costs one patch.

A base the bundle was not built with -- a content version, a publish, a
proposal's saves -- is one read of one module by its version (a base is a
version with the empty chain), and the server's module at its version is on
its own base by construction. So there is no base and chain from two builds
to keep apart any more: `BaseAlignment`, its whole-tree
`PUT /sources/~?apply_patches=false` and the page's `window.__VAL_BASE__`
went in phase 7.

- **Another editor's patch is shown once the server's version has it**, never
  replayed here on whatever base this Studio holds. Its record still arrives
  (`GET /patches`, for the review, the head and the publish), and is not
  applied: the manifest read after the same stat already brought its content.
- **Where nothing has been decided, every patch of the chain is on top**, as
  before phase 7: before the first manifest, after a re-intake moved the base
  under a module, on a module new code put this Studio ahead on, or with no
  server to ask (a test's system without `fetchManifest`).
- **A re-intake (HMR) puts the server's base back in the same turn** where
  the server is on another base (`ManifestSource.restoreBases`), so the
  bundle's is never on screen under the server's version.
- **The page is handed nothing until the store is in step** (`onInStep`, the
  first manifest adopted, and `chainSettled`): until then it holds the
  bundle's source, which after a publish, or on a site serving a content
  version, is not what the server has.

**A base is only put under a module when it fits the Studio's schema, where
the Studio is ahead.** When new code moved a module's schema in the Studio
(HMR, or staged code the tab evaluated: `schema:init` after the first intake)
and the server has not got that code yet, its version of that module was
made with the old schema -- it has no field the new code added. So the
manifest's version for that module is not moved to (`ManifestSource.ahead`)
and the module keeps the base the Studio's own code wrote, with every patch
of its chain on top, until the manifest names the Studio's schema (S10b,
C11). Where the SERVER is ahead (a deploy while the Studio was open) its
version is the one taken.

**A previous build still answering does not move the Studio.** In fs and
memory mode the chain is the store's, relative to what the newest build
evaluated, and `GET /manifest` and `GET /modules` are answered by the newest
build's head (`ValOps.newestOps`) -- a long poll parked on the old build
across a hot reload included. In http mode a previous build knows from the
content service that a newer one is live and says so (`superseded` on the
manifest); the Studio does not move to its versions and asks again (S26).

## Where things live

| you want                                   | look at                                            |
| ------------------------------------------ | -------------------------------------------------- |
| the read hooks a field uses                | `packages/ui/spa/components/ValFieldProvider.tsx`  |
| how a patch gets INTO source               | `SourceStore.intake` and `PatchIntake`             |
| source, versions, `.jsonValues()`          | `stores/SourceStore.ts`                            |
| the view: the engine over base and chain   | `stores/studioView.ts`                             |
| the chain, `/stat` reconciliation, uploads | `stores/PatchStore.ts`, `stores/PatchSync.ts`      |
| the server's versions: manifest, modules   | `stores/manifestSource.ts`, `stores/originTier.ts` |
| wiring, publish, discard, held edits       | `stores/createSystem.ts`                           |
| new code: `reloadCode(registry)`           | `stores/HostStore.ts`                              |
| a new build's code: import, or reload      | `stores/buildCode.ts`                              |
| a fake server to test against              | `stores/testSystem.ts`                             |
| what a store _did_, not what it announced  | the activity channel, `stores/activity.ts`         |

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
