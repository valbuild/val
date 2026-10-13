# Remove patch groups; publish a selection through a proposal

> Plan of record for taking patch groups out of Val (this repository) and the
> content service (valbuild/home). Keep the "Current state" block up to date
> after every work chunk.

---

## Current state / resume here

> **2026-10-13: planned, nothing built.** Decided:
>
> 1. Patch groups go, in both repositories. The site's Publish ships every
>    pending change.
> 2. A project that publishes through `/commit` (a connected project hosted
>    outside the platform, e.g. Next.js on Vercel in proxy mode) loses partial
>    publish and gets nothing in its place. Accepted.
> 3. **Publish selected** is part of the first version: pick changes in Review,
>    Val moves them into a throwaway proposal and merges it. Managed projects
>    only, because proposals are.

---

## Why

A patch group is the set of patch ids an author intends to publish, kept on the
server, one open group per author per branch. Its job was one thing: publish a
few changes while other people's pending work stays behind. Keeping that safe
on one shared, linear chain costs:

- **A standing invariant** (the prefix invariant) that every write, stage,
  unstage, discard, coalesce and publish has to preserve, and that a third
  party's insert can still break, leaving a hole nobody repairs.
- **A view per author.** `SourceStore` scopes every module to the viewer's
  group and rebuilds when the scope moves; held is not applied is not settled;
  `null`, `[]` and `[...]` must never be confused. Draft reads
  (`own_patch_groups_only`) are therefore per caller and cannot be shared.
- **A non-prefix applied set.** A published patch can come after a pending one,
  so the chain head is not the last listed patch (`chainHead.ts`), `/stat`
  sends the applied set, and the Studio tracks a publish head.
- **Client-computed closures the server trusts** (`withPatchIds`, stage
  `patchIds` + `withPatchIds`, `unstagePatchIds`) and the races between them
  (`holdGroupChangesFor`, `reconcileScope`, widening toasts) — seven numbered
  invariants in `docs/independent-publish/DESIGN.md`, most of them about races.

Proposals (valbuild/home `docs/proposals.md`) already keep work apart in a way
that does not share the chain: a proposal is its own branch with its own chain
and its own base. That doc already sketches this removal under "Later":
"proposals are the way to keep work apart, publish jobs already publish
everything pending, and Val's Studio already has a path for a content service
with no groups."

Size: about 10.6k lines of Val files exist only for groups, plus large parts of
`createSystem.ts`, `PatchStore.ts`, `SourceStore.ts`, `ValServer.ts`,
`ValOpsHttp.ts`, the mock content host and the review UI. About 2.5k lines of
home files, plus edits across the content handlers.

---

## The model after

**The site is one shared draft.** What every editor sees is the bundle's Source
plus the whole pending chain. Publish ships all of it. To keep something out of
a publish, it goes to a proposal.

Four rules replace the patch-group design:

1. **Applied is a prefix.** On the site's chain, the patches a publish has
   shipped always come before the ones it has not. Every publish path enforces
   it (see Phase 3). This is what lets the applied set become one cursor and the
   chain head become the last patch again.
2. **The unit of selection is the patch set.** Wherever changes are split off
   the site's chain — Publish selected, "New proposal with my changes", and
   later Flow A — whole patch sets move, never part of one. (Patch sets are the
   schema-derived groups of patches that can shift each other's paths;
   `utils/PatchSets.ts`.)

   Why whole sets, not a prefix: a move takes patches OUT of the site's chain
   before the merge lands. Move a prefix and the suffix left on the site is
   replayed without the patches it was written against — `items/3` lands on a
   different item, or fails to apply, and a patch that fails to apply is
   deleted. Move a suffix and the same happens inside the proposal. Only whole
   sets are safe on both sides, and patches in different sets commute, so
   whatever is left in the same module is fine. This is computed once, when
   someone clicks, and never has to be maintained.

3. **Discard takes what was written on top.** Unchanged:
   `computeDiscardClosure`'s forward closure stays, but it only decides what is
   deleted. There is no membership to repair, so `unstagePatchIds` goes.
4. **Every editor's draft is the same draft.** Draft reads (`fetchVal`,
   `useVal`, `initValContent`) no longer depend on who asks, beyond being
   allowed to ask.

### What is lost

- Two editors on the site can no longer publish independently. Whoever
  publishes ships everyone's pending changes — how Val worked before groups.
  The Review screen says whose changes are in it (author shown, not filtered).
- Projects that publish through `/commit` (not hosted on the platform) have no
  partial publish at all. Decided, above.
- Flow A (milestone 2 in `proposals.md`, not built) loses "Unstage these and
  keep working". Its remaining choices are "Continue in a proposal" and
  "Discard". Because nothing can be held back on the site, an affected change
  blocks the site's Publish until someone moves or discards it — anyone may,
  since everyone can act on every proposal.

---

## Publish selected (option B)

### What the editor sees

Review already has a selection checkbox on each row (`ReviewView.tsx`, "a
checkbox that is not either of them"). With groups gone it is the only
selection there is.

- Select rows → **Publish selected (N)** beside Publish.
- If the selection pulls in more (rule 2), the dialog lists what it adds and
  whose it is before anything moves: "These 2 changes come with it: they move
  the same list." Nothing moves until the editor confirms.
- On confirm: "Publishing 4 changes…" in place of the button, then the usual
  published state. A failure says why, keeps the proposal, and offers **Open
  the proposal** (the changes are there, nothing is lost) and **Try again**
  where retrying can help (a failed build), not where it cannot (the site
  moved under it).

### What happens

```
 Studio                                   content (home)
 ──────                                   ──────────────
 closure = whole patch sets of selection
 POST /proposals { kind: "publish",  ──▶  create row, base = site head,
   patchIds: closure, requestId }          moveIntoProposal (re-key), record
                                           the site chain position of the move
 prepare + POST /proposals/:n/save   ──▶  commit on val/p/<n>
 POST /proposals/:n/merge            ──▶  merge job: build in tab, verify, seal
 ◀── merged ─────────────────────────────  site base now holds the selection
```

Everything here exists except three changes, all in home:

1. **A `publish` proposal kind** beside `editor | ai | affected`. It is
   created, saved and merged in one press and is not meant to be opened, so it
   skips work that only an open proposal needs: the address/overlay `setup`
   job, and the `carry-over` job (changes made during the merge stay on the
   site, where they were written). Verify which of those the merge itself reads
   before skipping it. It still appears under Proposals › Merged, so history
   can say what was published.
2. **A merge check for that kind.** Today `pending-on-site` refuses a merge
   when any pending site patch shares a module with the proposal — true in the
   common case, so Publish selected would almost never merge. For the `publish`
   kind, patches that were on the site when the move happened are safe by rule
   2, so the check becomes: **no site patch created after the move touches a
   module the proposal holds.** A patch written after the move was written
   against a view without the selection, and content cannot compute patch sets
   to tell whether it is affected, so the module is the granularity, as it is
   everywhere else in proposals. `published-since` is unchanged.

   When the check fails the merge does not happen and the proposal stays open
   as an ordinary proposal ("Someone changed this page while it was
   publishing"), with **Open the proposal** — nothing is lost and nothing is
   rebased.

3. **One request for create + move**, so a lost answer cannot leave a
   proposal with nothing in it. `POST /proposals` already takes `patchIds`
   and a `requestId` that makes a retry the same proposal; check that the
   move happens in the create's transaction for the `publish` kind.

In Val:

- `selectionClosure(patchSets, selected)` in the worker: every patch in every
  patch set a selected patch is in. Replaces `stageClosure` /
  `unstageClosure` / `computeWriteClosure`. "New proposal + my changes"
  (`NewProposalDialog`, which today does not carry changes) uses the same
  function.
- `proposalsClient.create` gains `kind` and `patchIds`.
- The save's `prepare` and the merge press are what `PublishProposalDialog`
  already does; Publish selected calls them in sequence from the site.

### The window while it merges

Between the move and the merge landing, the selection is on the proposal's
branch, not the site's: a site Studio does not show it. Today a merge is a
build in the tab, verify and seal — tens of seconds or more. Fields reverting
for that long, then coming back, reads as data loss.

Two ways to close it, decide before building the UI:

- **(recommended) Show it as publishing.** While a `publish`-kind proposal is
  merging, `/stat` lists its patches as `publishingPatches`, the way a running
  site job's patches are listed today, and the Studio renders them on top of
  the site's chain, read-only. They are already rendered this way for a site
  job; the new part is reading them from another branch.
- **Wait for `hosted-publishing.md`.** Its direction makes a merge a ref
  update instead of a build, which shrinks the window to about a second.
  Building B after that lands may make the first option unnecessary.

### Rejected for B

- **A site publish job with a selected subset**, no proposal. Cheaper per
  press, but it publishes a patch while an earlier one stays pending — the
  non-prefix applied set this plan exists to remove.
- **Prefix closures** (what groups used). Safe while patches stay in one chain;
  not once they are moved out of it (rule 2).

---

## Phases

Each phase ships on its own and leaves both repositories releasable. Order
matters: home stops producing groups before Val stops reading them, and home
keeps accepting the old request fields (ignored) until no supported Studio
sends them.

### Phase 1 — home: stop producing groups

Behaviour change only; tables stay.

- `postPatches`: stop resolving, creating and adding to groups. Accept and
  ignore `patchGroupId`, `withPatchIds`, `alsoAddPatchIds`, `closureVersion`
  (as `holdBackForGroupIds` already is). Drop the `withPatchIds` validation
  and the cross-proposal closure guard.
- `GET /patch-groups` → 404. Stage/unstage routes → 404.
- `/applicable/patches` (`/stat`), the websocket `patches` message and
  `GET /patches`: stop sending `patchGroups` and per-patch `patchGroupIds`.
- `postCommit`: ignore `patchGroupId` (keep the proposal refusal on
  `newBranch`). Stop `markPublished` / `removePatchesFromAllGroups`.
- `deletePatches`, publish-job discard, `moveIntoProposal`, publish-job
  RECORD: stop touching groups; accept and ignore `unstagePatchIds`.

**Val side, same phase, no code change:** verify the Studio's no-groups path
against it. `e2e/http` already runs the mock content host with groups off
(`enablePatchGroups` is opt-in); run `chromium-http` and `webkit-http` and the
`reloadEquivalence` specs without groups and fix what fails before Phase 2.

### Phase 2 — Val: delete the scoped paths

Everything that exists for groups. By package:

- **shared** — `ApiRoutes.ts`: `PatchGroup`, `/stat` `patchGroups`,
  `PUT /patches` `patchGroupId` / `withPatchIds` and response `patchGroupId`,
  `DELETE /patches` `unstagePatchIds`, `GET /patches` `include_patch_groups` /
  `patchGroupIds` / `patchGroups`, the `/patch-groups/~/patches` route,
  `own_patch_groups_only` on `/sources/~` and `/json`, `/save` `patchGroupId`
  and its 403 / `patchGroupPublished` answers. `publish/contentApi.ts`: the
  `unstagePatchIds` argument.
- **server** — `ValServer.ts`: the `/patch-groups` routes, group handling in
  `PUT` / `GET` / `DELETE /patches`, the `/json` and `/sources/~` scope,
  `/save` ownership, and the helpers `scopedPatches`, `boundUnstageClosure`,
  `ownPatchIdsIn`, `ownPatchScopeFor`, `resolveOwnPatchScope`,
  `refuseUnlessOwn`. `ValOps.ts`: the `patchGroup` parameter,
  `PatchGroupMembership`, `patchGroups` on ordered patches. `ValOpsHttp.ts`:
  schemas, `getStat` groups, the `fetchPatches` fold, `stagePatches`,
  `unstagePatches`, `getPatchGroups` and its cache, `mutatePatchGroup*`,
  membership on create, commit `patchGroupId`. `ValOpsFS.ts` /
  `ValOpsMemory.ts`: the ignored `_patchGroup` parameter. (FS "staged uploads"
  are binary uploads, unrelated: keep.)
- **ui stores** — `createSystem.ts`: `setPatchGroup`, `seedPatchGroup`,
  `setPatchGroupResolver`, `setOwnPatchGroupId`, `computeWriteClosure`,
  `stagePatches`, `unstagePatches`, `persistPatchGroupChange`, `patchGroup()`,
  `emptiesOwnPatchGroup`, `extendPatchGroup`, `narrowPatchGroup`,
  `reconcileScope`, `holdGroupChangesFor`, `queueGroupChange`,
  `holdBackOverHoles`, the `unconfirmed` bookkeeping, `prefixViolations`,
  `computePatchSetsBuild`, the `group-widened` event, and the group parts of
  `publish` (`groupScoped`, `closesPatchGroupId`, `group-published`).
  `takeNamedPrefix` stays (a prefix of the whole chain). `SourceStore.ts`:
  `visiblePatchIds`, `isVisible`, `setVisiblePatchIds`, `rebuildModules`, the
  skip branch in `applyEntries` and the `unstaged` apply-event field.
  `PatchStore.ts`: groups, `groupsVersion`, `ownPatchGroupId`,
  `patchGroupsSeen`, `unstagedIds`, the group half of `markPublished`.
  (`stage()` / `takeStaged()` are BaseAlignment prefetching: keep.)
  `PatchSync.ts`: membership on save, resolver. `StatStore`, `types.ts`,
  `PublishSeam`, `react/createValSystem.ts`, `react/ValStoreProvider.tsx`,
  `react/statSnapshotOf.ts`, `hooks/useStatus.ts`.
- **ui components** — delete `PatchStagingProvider`, `StagingToggle`,
  `PatchGroupWidenedToasts`, `useCurrentPatchGroup`, `useOwnUnstagedPatchIds`,
  `useIndexedPatchSets`, `utils/patchGroups.ts`, `utils/patchGroupScenario.ts`,
  `utils/splitTreesByStaging.ts`. Edit `ValProvider.tsx` (the group hooks,
  `useUnstagedPatchIds`, the scope in `useOwnPendingChangeCount` and
  `useNoOpSourcePaths`), `ValShell.tsx` (`StagingScope`, `StagedCompare`,
  `usePatchGroupScope*`), `HandoffPublishTab`, `PublishButton`,
  `publishButtonState` (`unstagedChangeCount`), `ComparePatchSets`
  (`StagedSections`), `DraftChanges`, `netChangeModules`, review
  (`ReviewSurface`, `ReviewView` — staged / unstaged sections and Stage /
  Unstage go, the selection checkbox stays — `toReviewModel`, `types`,
  `useReviewModel`, `reviewCompareParam`), `publish/pressForPage.ts`,
  `publish/jobClient.ts`, and stories / fixtures.
- **next / tanstack** — drop `own_patch_groups_only` from `initValRsc.ts` and
  `initValContent.ts`.
- **e2e** — delete `http/patchGroups.spec.ts`, `http/staging.ts`; edit
  `reloadEquivalence.spec.ts` / `.ts`, `httpMode.ts`, and the mock content
  host (`MockPatchGroup`, group state, stat groups, write membership,
  stage/unstage, commit group checks, the admin toggle and routes).
  `homeWireContract.test.ts` follows the mock.
- **Tests to delete** — server: `boundUnstageClosure`, `ownPatchScope`,
  `patchGroupOwnership`, `patchGroupResolution`, `sourcesPatchGroup`,
  `scopedJsonEntries`, `scopedPatches`. ui: the ten `stores/patchGroup*.test.ts`,
  `discardClosure.test` (its forward-closure cases move to a discard test if
  not already covered), `utils/patchGroups.test` and snapshot,
  `patchGroupsStaging.test`, `splitTreesByStaging.test`,
  `useCurrentPatchGroup.test`, `useOwnUnstagedPatchIds.test`,
  `stagingBulkActions.test`. Edit the rest the inventory names
  (`appliedSetSync`, `noOpSourcePaths`, `publishButtonState`,
  `ownPendingChangeCount`, `netChangeModules`, `toReviewModel`,
  `reviewCheckbox`, the sources-memo tests, `ValRouter`, `proposalMode`).
  Per the repo's rule, a test is edited only where it asserts group
  behaviour, never to make a non-group failure pass.

Keep: `PatchSets.ts`, `PatchSetStore`, the worker. They still drive the
discard closure, review and compare grouping, `collectFieldChanges` (commit
messages), `CompareLink`, `PatchErrorsDialog` — and, in Phase 5, the
selection closure.

Changeset: a minor bump for `@valbuild/ui`, `server`, `shared`, `next`,
`tanstack`, written for users: "Publish now publishes every pending change.
To keep changes out of a publish, move them to a proposal."

### Phase 3 — make "applied is a prefix" true, then cash it in

First enforce it, in home:

- **`/commit`** (projects not hosted on the platform): refuse an
  `appliedPatches` that is not exactly the pending chain up to a patch,
  in chain order. Today it accepts any subset.
- **Publish jobs** take everything pending at start, but skip claimed rows.
  A failed job keeps its claims until retried or discarded; a new job must
  not ship patches after them. Either the new job includes the failed job's
  patches, or the press is refused until that job is retried or discarded
  (the latter is today's queue behaviour — verify, then assert it).
- **Flow A**, when it is built: an affected patch blocks the site's publish
  rather than being skipped by it.
- A database-level check in RECORD: after marking applied, no pending site
  patch precedes an applied one. A violation is a bug and fails the publish.

Then simplify, in both:

- **Applied set → cursor.** `/stat` and the websocket send
  `appliedThrough: PatchId | null` instead of the applied id list.
  `PatchStore.receiveApplied` / `applyServerApplied`, `knownShipped`,
  `shippedOutside`, `pendingAmong`, `SourceStore.markApplied` and
  `publishJobs.heldByContent` read the cursor. The published realm
  (`peekBase`, compare's "before") is base + chain up to the cursor.
- **Chain head.** The last listed patch is the head again. `chainHeadOf` falls
  back to it; `headPatchId` stays as a cross-check one release, then goes.
  `headVersion` stays (it orders stats, not publishes). Update the
  `quirks.md` entry that explains why the head is not the last patch.
- **Publish head** (`expectedHeadCommitSha`, `/save` `headMoved`,
  `publishHead.test`). It existed so a subset publish could not land on a
  commit the client had not seen. Decide in this phase whether "you reviewed
  a chain that is no longer what ships" is still worth a 409; default: keep
  it, it is cheap and the question is still real.
- **Shared draft reads.** `/sources/~` and `/json` answers are the same for
  every authorized caller, so they can be cached by
  `(sourcesSha, headPatchId, headVersion)` instead of per request.
  `requestScopedMemo` keeps the per-request memo; a cross-request cache is a
  separate, measured change. Update `quirks.md` on draft reads.

### Phase 4 — home: drop groups for good

- Forward migration dropping `val_patch_group_patches` and `val_patch_groups`
  (migrations are forward-only; keep the old files).
- Delete `dal/patchGroups.ts`, `getPatchGroups.ts`, `postPatchGroupPatches.ts`,
  `deletePatchGroupPatches.ts`, `utils/patchGroupAccess.ts`, the routes in
  `routes.ts`, the `Api.ts` types, `platform/scripts/content-host.ts`'s stub.
- Delete `patchGroups.test.ts` and `admin/.../patchGroupMembership.test.ts`
  after moving the two deletion tests in `patchGroups.test.ts` (chain locked
  before delete; a job-held change left in place) to a `deletePatches` test.
  Edit `proposals.leaks.test`, `postCommitPhases.test`, `postPatchesHead.test`,
  `patchesMessage.test`, `publishJobs.test`, the billing tests.
- Stop accepting the ignored request fields once the oldest supported Val no
  longer sends them.
- Comments that assume groups: `dal/patches.ts`, `postPatches`,
  `getApplicablePatchesAndCommits`, `Api.ts`.

### Phase 5 — Publish selected

As described above. home first (kind, merge check, one-request create+move,
`publishingPatches` across branches if that option is chosen), then Val
(`selectionClosure`, Review action, dialog, progress and failure states).

Tests that matter:

- `selectionClosure`: a selection inside an array with an earlier insert by
  someone else pulls the insert in; a selection in an unrelated field of the
  same module pulls in nothing.
- Content: a `publish`-kind merge succeeds with unselected pending patches in
  the same module (written before the move); refuses, and leaves the proposal
  open, when a site patch in that module is written after the move.
- e2e (`chromium-http`, mock content host): two authors on one page; one
  publishes a selection; the other's changes are still pending and still
  render; a reload shows the same thing (`reloadEquivalence`).

### Phase 6 — docs

- `docs/independent-publish/DESIGN.md` and `PLAN.md`: replace with a short note
  pointing here, keep in git history.
- `architecture/stores.md` (the head paragraph), `architecture/quirks.md`
  (the chain head and draft-read entries).
- home: `docs/proposals.md` (the "Patch groups stay" note, Flow A's Unstage,
  "closed the way unstage is" → whole patch sets, the staged-group wording,
  "Later › Patch groups"), `docs/app-mode.md` (RECORD's group cleanup, discard
  `unstagePatchIds`, the open question proposing groups for subset publish),
  `docs/tiers-build-plan.md` (cites `postPatchGroupPatches.ts`).

---

## Open questions

1. **The merge window** for Publish selected: show the selection as
   publishing, or build B after `hosted-publishing.md` makes a merge a ref
   update. See above.
2. **Does a merge read the overlay** that the `setup` job creates? Decides
   whether the `publish` kind can skip it.
3. **A patch set spanning authors.** Publishing a selection can publish
   someone else's change because it moves the same list. The dialog lists it;
   is listing enough, or should it need that author's change to be selected
   explicitly?
4. **Publish head**: keep or drop (Phase 3).
