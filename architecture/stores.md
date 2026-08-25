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
snapshot that changes identity every call re-renders forever. Stability is by
**recompute-and-compare**, never an invalidation list: a list of call sites has to
stay complete forever and fails silently when it does not.

> The two worst bugs on this branch were both this rule broken. `substituteJsonEntries`
> is copy-on-write, so one loaded `.jsonValues()` entry made `peek` of the module
> root return a fresh object per call — and the page died with "Maximum update
> depth exceeded" from inside a Radix ref callback that mentions nothing about
> source.

## Waking: per path, and never yourself

Notification is per **path**, not per module — typing one character used to wake
every mounted field in the module. And a field's own writes never wake it, keyed
per field _instance_, because one path can be rendered twice (studio field and
inline overlay). A controlled input re-rendered by its own keystroke loses the
caret.

Corollary worth knowing: **suppression means a field does not see its own edit
land.** Anything read on a render path that moves with the _patch chain_ rather
than with source — "do I have an unsaved edit" — must therefore be read fresh on
each render rather than memoised beside the source read. Memoising it froze an
array field's drag handle permanently.

## Writing: one writer, one linear chain

The server keeps one linear patch chain and checks every `parentRef`; two writers
would 409 on every keystroke. One patch per edit, not per typing burst — merging
is what made the two chains disagree.

`/stat` is polled and is the authority on **order**, not on existence. A response
describes the server as it was when the request was _issued_, so a stat can omit a
patch that exists. A patch that disappears from stat is therefore **verified**
with a fresh `GET /patches` before it is dropped, which is also why no sequence
number is needed anywhere.

A patch that cannot be applied is **deleted** (server included) and logged: it can
never produce a value, and leaving it blocks every later save to its module.

## Where things live

| you want                                   | look at                                           |
| ------------------------------------------ | ------------------------------------------------- |
| the read hooks a field uses                | `packages/ui/spa/components/ValFieldProvider.tsx` |
| source, patch application, `.jsonValues()` | `stores/SourceStore.ts`                           |
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
