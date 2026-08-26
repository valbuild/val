# Commit history & safe rollback — high-level plan

> **Status: draft v1, for iteration.** Nothing here is decided. The point of this
> version is to write down _how the machinery actually works today_ so we can argue
> about the design on top of a shared, accurate model. Sections 1–2 are the
> mechanisms; sections 3–7 are the proposal; section 8 is what we still have to
> decide.

---

## 0. The ask, restated

Today the Studio only has history for **staged** (uncommitted) changes: the patch
log, grouped into patch sets, shown in `DraftChanges`. Once you publish, that
history is gone from the UI and the content is just… the content.

We want:

1. **History for commits** — see what each published commit changed.
2. **Rollback to a commit** — restore content as it was.
3. **Safely** — a user must never be able to roll back into something that does
   not build, does not validate, or silently loses a developer's work. When we
   cross a boundary where the repo has changed by means other than Val, we should
   degrade to a narrower unit (a module, or a single source path) rather than
   refuse or, worse, do something unsafe.

---

## 1. Mechanisms today

### 1.1 Two modes, two owners of the truth

|                             | `ValOpsFS` (dev)                                                                                                           | `ValOpsHttp` (prod)                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Source of truth for content | the working tree                                                                                                           | the git repo, via the **content service** (`contentUrl`, a separate service — _not in this repo_)         |
| Where patches live          | `.val/patches/<parentPatchId>/patch.json` (+ `files/`, `base.json`) — `ValOpsFS.ts:1278`                                   | the content service                                                                                       |
| What a "save" does          | writes patched files to the working tree, then **deletes all patches** (`ValServer.ts:1942` → `ValOpsFS.deleteAllPatches`) | POSTs to `/v1/{project}/commit`, which creates a **real git commit** on the branch (`ValOpsHttp.ts:1334`) |
| Commit history available    | **none** — FS mode never returns `use-websocket`, so `commits` is always empty                                             | `ValCommit[]`, pushed over the WebSocket and returned with the patch list                                 |

This split is the first thing any design has to survive: **there is no commit
concept in fs mode at all today**, and in http mode the storage we would extend
lives in a repo we are not editing here.

### 1.2 The patch log is the only history that exists

A patch is `{ patchId, moduleFilePath, patch: Operation[], parentRef, authorId, createdAt, baseSha }`.

`parentRef` (`packages/core/src/patch/patch.ts:9`) is either
`{ type: "head", headBaseSha }` or `{ type: "patch", patchId }` — so patches form
a **linear chain** rooted at a base sha. That chain is the staged history, and
`PatchSets` (`packages/ui/spa/utils/PatchSets.ts`) is what turns it into the rows
you see: patches are merged into a "patch set" when their paths nest, keyed by
`<moduleFilePath>?<patch/path>`.

Two properties of this log matter enormously for rollback:

- **Patch ops are not invertible.** `{ op: "replace", path, value }` carries the
  _new_ value only. There is no `oldValue` anywhere. Given the patch log alone you
  can say _which paths_ a commit touched and _who_ touched them — you cannot say
  what they used to be. **This is the single hardest constraint in the whole
  feature, and the main argument for storing snapshots.**
- **Committed patches are still fetched by the Studio.** The content service's
  `applicable/patches` endpoint returns patches with `applied: { commitSha }`
  (`ValOpsHttp.ts:694`), and `analyzePatches` simply _skips_ them when computing
  what to apply (`ValOps.ts:531`). So the client already receives
  "patch X belongs to commit Y", with ops, for free.

### 1.3 What publish actually does

```
Studio                          Next.js host (ValServer)                content service / disk
------                          ------------------------                ----------------------
publish(patchIds)
  ├─ runCustomValidationForPatches
  ├─ GATE: refuse if ANY validation error   ← ValSyncEngine.ts:4972
  └─ POST /save ───────────────▶ fetchPatches(patchIds)
                                 analyzePatches()          ← drops already-applied
                                 prepare()                 ← ValOps.ts:1216
                                   • read CURRENT source file per module
                                   • apply the patch chain to the TS AST / *.val.json
                                   • produce PreparedCommit
                                 GATE: refuse if hasErrors
                                 ├─ fs:   write files, delete all patches
                                 └─ http: POST /v1/{project}/commit ────▶ git commit
```

`PreparedCommit` (`ValOps.ts:2025`) is the interesting object:

```ts
patchedSourceFiles:   Record<string, string | null>          // new file text ("" path → null = delete)
previousSourceFiles:  Record<ModuleFilePath, string>         // OLD file text  ← computed, then thrown away
patchedBinaryFilesDescriptors, appliedPatches, …errors
```

`previousSourceFiles` is already computed on every publish. It is sent to the
**commit-summary** endpoint so the AI can describe the change
(`ValOpsHttp.ts:1300`), but it is **not** sent to `/commit`. Nobody persists it.
That is a large part of what we need, already in hand at exactly the right moment
— and the commit-summary call proves the payload size is acceptable in practice.

### 1.4 What Val knows about a commit

```ts
ValCommit = {
  commitSha,
  clientCommitSha,
  parentCommitSha,
  branch,
  creator,
  createdAt,
  commitMessage,
};
```

`commit()` sends `commit: this.commitSha` — the sha of the **deployed app** the
Studio is running against — and the service commits on top of the branch head.
So `clientCommitSha` (what the editor saw) and `parentCommitSha` (what git
actually parented to) are the raw material for detecting drift. The service
already refuses non-fast-forward commits and the Studio already surfaces that as
`409 isNotFastForward` (`ValServer.ts:1968`) — that is the _live_ version of the
same boundary problem we are trying to solve for the _historical_ case.

> ❓ **To verify with the content service team:** are these three shas enough to
> conclude "only Val committed between A and B", or do we need the service to tell
> us explicitly? See §8.

### 1.5 Primitives that already exist and that we should build on

- **Read any file at any commit.** `getHttpFiles([{ filePath, location: "repo", root, commitSha }])`
  (`ValOpsHttp.ts:937`) already fetches arbitrary repo files at arbitrary shas.
- **Statically evaluate a `.val.ts` source without running it.**
  `evaluateExpression` (`packages/server/src/patch/ts/syntax.ts:258`) turns the
  literal source expression — including `c.file` / `c.image` / `c.remote` calls —
  into JSON. It fails if a developer wrote a non-literal (`c.define(..., someVar)`).
- **Root-level replace is a legal patch op.** `replaceAtPath` handles the empty
  path in both the JSON ops (`packages/core/src/patch/json.ts:72`) and the TS ops
  (`packages/server/src/patch/ts/ops.ts`), and `toExpression` knows how to print a
  `FileSource`/`RemoteSource` back as `c.image(...)` etc. **So "restore this whole
  module" is expressible as one ordinary patch.**
- **Publish is already gated on zero validation errors** (`ValSyncEngine.ts:4972`),
  and `prepare()` refuses the commit if any patch fails to apply.
- **Remote-ref repair already exists**: `checkRemoteRef.ts` + `createFixPatch.ts`.

### 1.6 What the Studio shows today

`DraftChanges` renders pending patch sets, plus a Deployments strip built from
`mergeCommitsAndDeployments(commits, deployments)`. So there is already a commit
_list_ in the UI — it just has no content behind it.

---

## 2. Why rollback is hard: five kinds of drift

Restoring "what it looked like at commit C" is only well-defined if nothing that
gives that value meaning has changed since. Five things can change:

1. **Patch drift** — patches are not invertible (§1.2). Without stored state, "undo
   commit C" is not computable at all.
2. **Schema drift** — a field was renamed, its type changed, a validator was added,
   a union variant was removed. The old value may be structurally valid JSON and
   still be wrong. `schemaSha` (schema + config, `ValOps.initSources`) is the coarse
   detector; the module's `SerializedSchema` is the per-module one.
3. **Repo drift** — a developer committed by hand between C and now. This is the
   boundary the ask names. It does not automatically make a restore unsafe (they may
   have touched unrelated files), but it invalidates "everything in between was Val,
   therefore I understand it".
4. **Binary / remote drift** — a restored `ImageSource` points at
   `/public/val/photo_a1b2c.jpg`. Local files are not deleted on commit, but they can
   be reaped (`val list-unused-files`). Remote refs embed a `validationHash` derived
   from the schema + core version, so an old remote ref can be _fix-required_ even
   when the bytes are fine.
5. **Module identity drift** — the module file was renamed or deleted; a
   `.jsonValues()` entry file was moved. Path-keyed history silently misses.

---

## 3. Proposal — five pillars

**P1. A rollback is a forward patch, never a pointer move.**
We never rewrite git history and never write old file text back verbatim.
A restore produces ordinary `Operation[]` against the _current_ head of the patch
chain, and rides the existing pipeline: client-side validation → the
zero-validation-errors publish gate → `prepare()` → a new commit. This is the
whole safety argument: a rollback we classified wrongly degrades to **"you cannot
publish this"**, not to a broken site. It is also automatically undoable, because
it is just another commit.

**P2. Snapshot content at commit time.**
Because ops are not invertible, and because reconstructing old state from git later
is fragile (needs a per-commit round trip, a TS parse, and breaks on non-literal
sources) and impossible in fs mode. We already hold both sides in `PreparedCommit`.

**P3. Diff at restore time, not at commit time.**
Do not store an inverse patch. Store the _value_, and compute the operations when
the user clicks restore, against whatever the content is at that moment. This is
what lets us show a real three-way view — _value at C_ / _value now_ / _what will
change_ — and what makes concurrent editing safe.

**P4. A trust ladder, not a yes/no.**
Classify each candidate restore and let the classification pick the **granularity**
that is still safe, rather than refusing outright (§5).

**P5. Everything is per-module and per-path.**
There is no "reset the site to Tuesday" button in v1. The unit is a source path or
a module. A whole-commit revert is just the fan-out of per-module restores, and
inherits the strictest classification among them.

---

## 4. What to store, and where

### Option A — snapshot at commit time _(recommended primary)_

Extend the `/commit` payload with a snapshot block, and add a read endpoint. Per
module touched by the commit:

```ts
{
  moduleFilePath,
  before: Json | null,        // Source JSON before this commit (null = did not exist)
  after:  Json | null,        // Source JSON after  (null = deleted)
  schemaSha,                  // global, per commit
  moduleSchema: SerializedSchema,  // per module — the per-module drift detector
}
```

Note we store **Source JSON, not file text**. File text is TS and cannot be turned
into a patch value; the JSON is exactly what a `replace` op wants. We can derive it
in `prepare()` — we already have the patched AST there.

- ➕ Works identically in fs and http mode. Cheap at write time. Exact.
- ➖ Storage grows with content size; requires a content-service change (see §8).
- ➖ Only covers commits made **after** we ship.

### Option B — derive from git on demand

Use `getHttpFiles({ location: "repo", commitSha })` + `evaluateExpression` to read
the module at commit C on demand.

- ➕ No storage, and works for **developer** commits too, not just Val's.
- ➖ Breaks on non-literal sources; needs a TS parse per module per commit;
  needs the service to tell us which commits touched a file; **nothing in fs mode**.

### Recommendation

**A as the primary, B as a back-fill** for history that predates the feature and as
the escape hatch for "show me what this developer commit did". They produce the same
shape (`Json` per module per commit), so the UI and the restore logic do not care
which one answered.

**Open sub-decision: granularity.** Whole-module snapshots are simplest and make
restore trivially correct, but a `.jsonValues()` record with thousands of entries
makes that expensive. The natural refinement is to snapshot **per `.val.json` entry**
for jsonValues modules (they are already separate files) and whole-module otherwise,
with a size cap above which we store nothing and fall back to Option B. → §8.

---

## 5. The trust ladder

For a candidate restore of `(commit C, module M, source path P)`, compute:

| Signal                                  | Source                                           |
| --------------------------------------- | ------------------------------------------------ |
| `schemaSha` at C == now?                | stored with the snapshot                         |
| `M`'s `SerializedSchema` at C == now?   | stored with the snapshot                         |
| The sub-schema **at P** unchanged?      | structural compare of the two serialized schemas |
| Does `M` still exist?                   | current schemas                                  |
| Val-only commit chain C→HEAD?           | `parentCommitSha` / `clientCommitSha` continuity |
| Every referenced file still resolvable? | local: file exists; remote: `checkRemoteRef`     |

and pick the widest rung that holds:

| Rung                  | Condition                                                                     | Offered                                                    |
| --------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **1. Revert commit**  | schemaSha unchanged, all touched modules exist, Val-only chain, files resolve | "Revert this commit" — one patch per module                |
| **2. Restore module** | that module's serialized schema unchanged                                     | "Restore this module to C"                                 |
| **3. Restore path**   | the sub-schema at P unchanged                                                 | "Restore this field to C" ← the fallback across a boundary |
| **4. Read-only**      | anything else                                                                 | show the old value + a diff, with copy — no button         |

A broken commit chain (repo drift) is deliberately **not** fatal on its own: it
drops rung 1 but rungs 2–3 still stand if the schema at that scope is identical.
That is the "cross a boundary, restore a module path or a source path" behaviour
from the ask, made precise.

And under all four rungs, the publish gate is still the last word.

---

## 6. UX shape (sketch)

The history panel is the existing `DraftChanges` timeline extended downward past
"pending": a list of commits (message, author, time, deploy state — we already merge
these), each expanding into the **same patch-set rows** the user already reads,
because committed patches with their ops are already on the client (§1.2). Each row
gets a "Restore" affordance whose label and enabled-ness come from the trust ladder;
clicking opens the three-way view from P3 and, on confirm, stages an ordinary patch
that shows up in Draft changes like any other edit — reviewable, undoable, and
publishable only if it validates.

---

## 7. Phasing

| Phase                                 | Content                                                                                                                                                                                                                 | Needs content-service change? |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **0. Read-only commit timeline**      | Group already-fetched committed patches by `appliedAt.commitSha`, join with `ValCommit` + deployments, reuse `PatchSets`. Shows _what paths_ changed and _by whom_ — honestly, no old values. De-risks the UI for free. | no                            |
| **1. Snapshots**                      | `prepare()` emits Source JSON before/after; extend `/commit`; new read endpoint; client cache.                                                                                                                          | **yes**                       |
| **2. Restore one source path**        | Trust ladder rungs 3–4, diff-at-restore-time, three-way view. Narrowest, safest unit first.                                                                                                                             | no (given 1)                  |
| **3. Module restore + commit revert** | Rungs 1–2, fan-out, binary/remote resolvability checks.                                                                                                                                                                 | no                            |
| **4. fs mode + back-fill**            | `.val/history/` for dev mode; Option B back-fill for pre-feature and developer commits.                                                                                                                                 | partly                        |

Phase 0 is worth shipping on its own even if the rest slips.

---

## 8. Open questions — this is what to iterate on

1. **Is the commit chain enough to detect the boundary?** Does
   `parentCommitSha`/`clientCommitSha` continuity really prove "only Val committed
   in between", or do we need the service to answer that directly (and to tell us
   whether an intervening commit touched the module at all)? _Biggest unknown._
2. **Snapshot granularity & cap.** Whole module vs per-`.val.json`-entry vs
   touched-subtree-only. What is the size ceiling and what happens above it?
3. **Retention.** Forever? Last N commits? 90 days? Does it differ by plan?
4. **fs mode: in scope?** A `.val/history/` (gitignored) store is easy but is
   local-only and does not survive a fresh clone. Or do we say dev mode uses git?
5. **Back-fill: worth it?** Option B gives us history for developer commits too,
   which may be more valuable than back-filling Val's own.
6. **Who may revert?** Same permission as publish, or narrower?
7. **One commit or many?** Should a whole-commit revert be a single commit
   ("Revert 'Update pricing page'") or one per module?
8. **Site-wide point-in-time rollback** — explicitly out of scope for v1?
9. **`.jsonValues()` interaction.** A root `replace` on a jsonValues module would
   have to preserve the `c.json(() => import(...))` thunks — the content is not in
   the `.val.ts`. Restore for those modules almost certainly has to target entry
   files, not the module root.
10. **Deleted binaries.** If a restored image ref no longer resolves, do we block the
    restore, restore with a broken ref and let validation catch it, or offer to
    re-upload from the old commit's blob?
