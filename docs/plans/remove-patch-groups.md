# Remove patch groups; publish a selection through a proposal

> Plan of record for taking patch groups out of Val (this repository) and the
> content service (valbuild/home). Keep the "Current state" block up to date
> after every work chunk.

---

## Current state / resume here

> **2026-10-17: Phases 1–3 are on main** (val #861 and home #235 for 8.2,
> then the removal). Built on top, on `claude/proposals-feature-design-ctgmbc`
> in both repositories: hosted-publishing 8.2 step 2, Publish in a proposal
> moving the site's conflicting pending changes into proposals of their own
> (val `movesAtMerge`; home migration `1793800000`, `mergeMoves.ts`); and
> Phase 4, Publish selected (see its "Built"; home migration `1793900000`);
> and Phase 5 for managed projects (see its "Built"; `1794000000`). Next:
> proposals for connected projects (decided 2026-10-17: they get them, and
> keep held back until then), which Phase 6 waits on; Phase 7's docs.
>
> **2026-10-16, building Phases 1–3.** Landing order, decided: the 8.2 work
> on `claude/proposals-feature-design-ctgmbc` goes to main first, in its own
> PRs (with main merged in, `proposal_merge_commits` renumbered to
> `1793500000`, and `merge-from-site` asking `proposalSaveRefusal`), then this
> branch's PRs on top. Done on this branch so far:
>
> - **Phase 1 (home)**: groups off everywhere (`1237b4f`). Content suite
>   1490/1490; the loop passes everything up to the WebKit steps, which needed
>   WebKit installed in this container.
> - **Phase 2 (val)**: done. Plan `56c6e76`; shared, server, next, tanstack,
>   mcp, the mock content host and e2e `284d0ea`; the Studio `6d80624`; the
>   changeset and a leftover comment `5086aab`.
> - Discard keeps today's no-groups behaviour: it deletes the ids asked for and
>   nothing else (see rule 3).
>
> **Before that, 2026-10-16: planned.** This branch now carries the
> proposals work (`claude/proposals-feature-design-ctgmbc`, val `3392738`, home
> `bd4422f`) and main, merged in. Baseline before any removal:
> `pnpm test packages/server/src/proposalMerge` 106 (3 todo),
> `pnpm test packages/server/src/proposalMode.test.ts` 40, the home loop 256/256.
> What the removal must keep working is listed under "Proposals: what this
> must keep working" — read it before every phase. Hosted-publishing 8.2
> (merging like a pull request) is built on this plan, and its next step —
> moving conflicting pending changes when a proposal is published — waits on
> Phases 1–3.
>
> **2026-10-14:** rebased on main after hosted-publishing steps 1–10 (home)
> landed. Decided:
>
> 1. Patch groups go, in both repositories. The site's Publish ships every
>    pending change.
> 2. **Switched off everywhere at once**, in one home change. A project that
>    publishes through `/commit` (connected, on its own hosting — Next.js on
>    Vercel) loses partial publish and gets nothing in its place. Accepted.
> 3. **No compatibility window.** Val's users are on current Val. Content
>    stops accepting the group request fields in the same release train as
>    the Val deletion, not a release later.
> 4. **Publish selected** is part of the plan: pick changes in Review, Val
>    moves their whole patch sets into a throwaway proposal and merges it.
>    Managed projects only, because proposals are. When a selection pulls in
>    another author's change, the dialog lists it and confirming publishes it.
> 5. **A held-back publish goes to a proposal.** A publish that breaks a page
>    no longer holds its changes back on the site; they move to a proposal.
>    This is what makes "published comes first" true on the site's chain, and
>    it reverses `proposals.md` P4 for this one case (see Phase 5).

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
- **Client-computed closures the server trusts** (`withPatchIds`, stage
  `patchIds` + `withPatchIds`, `unstagePatchIds`) and the races between them
  (`holdGroupChangesFor`, `reconcileScope`, widening toasts) — seven numbered
  invariants in `docs/independent-publish/DESIGN.md`, most of them about races.
- **A second meaning of "staged".** Since hosted-publishing step 7, staging is
  what a proposal does with files; patch groups use the same word for patches.

**On hosted projects groups already decide nothing about what is published.**
A publish there is a job: `POST /publish-requests` carries `{ requestId, tab }`
and the runner takes everything pending (home `runner.ts`, `pendingPatchIds`).
Groups only narrow what the editor SEES, so the scoped view and the Publish
button already disagree. The only place a group still decides a publish is
`/commit`, used by connected projects on their own hosting — which decision 2
gives up.

Proposals keep work apart without sharing the chain: a proposal is its own
branch with its own chain and its own base, and since hosted-publishing step
8 a content-only merge is a ref update with no build. Restore already moves
pending site changes into a new proposal (`history/restoreDestination.ts` →
content's `POST /proposals` with `patchIds`).

Size: about 10.6k lines of Val files exist only for groups, plus large parts of
`createSystem.ts`, `PatchStore.ts`, `SourceStore.ts`, `ValServer.ts`,
`ValOpsHttp.ts`, the mock content host and the review UI. About 2.5k lines of
home files, plus edits across the content handlers.

---

## The model after

**The site is one shared draft.** What every editor sees is the bundle's Source
plus the whole pending chain. Publish ships all of it. Anything that is not
going out with the next publish is in a proposal.

Four rules replace the patch-group design:

1. **Published comes first.** On the site's chain, every patch a publish has
   shipped comes before every patch still pending. Every publish path
   enforces it (Phase 6). It is what lets the applied set become one cursor
   and the chain head become the last patch again. Held-back changes are the
   one thing on main today that breaks it, which is why they move to a
   proposal (Phase 5).
2. **The unit of selection is the patch set.** Wherever changes are split off
   the site's chain by the client — Publish selected, "New proposal with my
   changes", Flow A later — whole patch sets move, never part of one. (Patch
   sets are the schema-derived groups of patches that can shift each other's
   paths; `PatchSets` in `packages/shared/src/internal/patchSets/`, exported
   from `@valbuild/shared/internal`.) Sets that share a change are one set,
   because a change is never split. Hosted-publishing 8.2 already applies this
   rule on the server: `changesToMove` in
   `packages/server/src/proposalMerge/merge.ts`.

   Why whole sets, not a prefix as groups used: a move takes patches OUT of
   the site's chain. Move a prefix and the suffix left on the site replays
   without the patches it was written against — `items/3` lands on another
   item, or fails to apply and is deleted. Move a suffix and the same happens
   inside the proposal. Only whole sets are safe on both sides, and patches in
   different sets commute, so whatever is left in the same module is fine.
   Computed once, when someone clicks; never maintained.

   Content has no schema, and 8.2 decided it should not need to know about
   patch sets: Val computes which ids move, content checks only that they
   are pending. Where content has to decide alone (Phase 5), it moves by
   module, which is coarser and therefore also safe: a module holds whole
   patch sets.

3. **Discard deletes what it is asked to, as it does today without groups.**
   `computeDiscardClosure` only ever computed which memberships to repair
   (`unstagePatchIds`), and returned nothing on a deployment without groups,
   so it goes with them. Deleting what was written on top of a discarded
   change as well would be a new behaviour, and is not part of this.
4. **Every editor's draft is the same draft.** Draft reads (`fetchVal`,
   `useVal`, `initValContent`) no longer depend on who asks, beyond being
   allowed to ask.

### What is lost

- Two editors on the site can no longer publish independently. Whoever
  publishes ships everyone's pending changes — how Val worked before groups.
  Review says whose changes are in it (author shown, not filtered).
- Projects that publish through `/commit` have no partial publish at all.
- Flow A (milestone 2 in `proposals.md`, not built) loses "Unstage these and
  keep working". Its choices are "Continue in a proposal" and "Discard"; an
  affected change blocks the site's Publish until someone acts, and anyone
  may.

### Proposals: what this must keep working

Hosted-publishing 8.2 ("merging like a pull request", valbuild/home
`docs/hosted-publishing.md`) is built on top of this plan, on the same code.
Every phase keeps these working; none of them use patch groups.

1. **Patch sets live in shared.** `PatchSets` and `schemaTypesOfPath` are in
   `packages/shared/src/internal/patchSets/`; the files in `ui/spa/utils` are
   re-export shims. Change the shared copy only, and never bring a second one
   back. The comments about groups that Phase 2 removes are in the shared
   copy.
2. **The merge groups pending changes by patch set.** `changesToMove()` in
   `proposalMerge/merge.ts` calls
   `sets.insert(moduleFilePath, serializedSchema, ops, patchId, "", null)` and
   `sets.serialize()`, then joins sets that share a change
   (`joinSharedChanges`). If the `PatchSets` API changes, change that call
   with it. Decided rules for moved changes: whole patch sets only; everyone
   who wrote a change in a moved set owns the new proposal; it is titled
   "Moved when “<title>” was published" and starts at the site commit before
   the merge.
3. **The merge test world drives Val's real patch path.**
   `proposalMerge/world.ts` uses `ValOpsMemory`, one patch store per line
   (`content.ts`), and calls
   `createPatch(path, ops, patchId, { type: "head", headBaseSha }, null, author)`,
   `fetchPatches({ excludePatchOps: false })`, `analyzePatches`, `getSources`
   and `prepare`. If `createPatch`, `ParentRef` or `fetchPatches` change shape,
   change `world.ts` with them — never what the scenarios expect. (Phase 2
   removes only `createPatch`'s trailing, optional `patchGroup` argument; the
   `null` world.ts passes is the session id.)
4. **Update from the site** (`ValOpsHttp.proposalsApi`, `update-content` and
   `update-code`) reads content's `merge-inputs` / `merge-trees` and commits
   through `merge-from-site`. It touches no patches, but `merge-from-site`
   refuses while the proposal has unsaved changes (`dal.proposals.unsavedCount`).
   Anything that changes what counts as pending or unsaved (Phases 5 and 6)
   changes that count with it.
5. **The end-to-end loop** (valbuild/home `platform/scripts/loop.ts`): about
   22 steps `PUT /api/val/patches` with `parentRef` `{ type: "head",
headBaseSha }` or `{ type: "patch", patchId }`, and several read
   `headPatchId` from content's `/applicable/patches`. If the patches API or
   that response changes shape, change those steps. Its content-host stand-in
   answers `GET /patch-groups` with an empty list (`content-host.ts`), which
   Phase 3 deletes.

**Checks after every phase**, in addition to the repository's own CI:

```bash
pnpm test packages/server/src/proposalMerge         # 106, 3 todo
pnpm test packages/server/src/proposalMode.test.ts  # 40

# the home loop, against real content (256/256 at the baseline)
pg_ctlcluster 16 main start
moto_server -p 4569 &
cd home/platform/packages/loader && ./node_modules/.bin/wrangler dev \
  --var CONTROL_PLANE_AUTH:open --var PLATFORM_ADMIN_TOKEN:loop-admin-token &
cd home/platform && pnpm loop --val ../../val --content real
```

The admin token is required; without it the loop stops at "giving the project
its secrets" with a 401.

---

## Phases

Each phase leaves both repositories releasable. Phases 1–3 are one release
train: home switches groups off, Val deletes them and is released, home
deletes them — with no window in which content accepts fields Val no longer
sends.

| #   | Phase                                  | Repo      | Needs |
| --- | -------------------------------------- | --------- | ----- |
| 1   | Groups off, everywhere                 | home      | –     |
| 2   | Delete groups                          | val       | 1     |
| 3   | Delete groups                          | home      | 2     |
| 4   | Publish selected                       | home, val | 2     |
| 5   | A held-back publish goes to a proposal | home, val | 3     |
| 6   | Published comes first, and cash it in  | home, val | 5     |
| 7   | Docs                                   | both      | –     |

### Phase 1 — home: groups off, everywhere

Behaviour only; tables and types stay until Phase 3.

- `postPatches`: stop resolving, creating and adding to groups. Ignore
  `patchGroupId`, `withPatchIds`, `alsoAddPatchIds`, `closureVersion`. Drop
  the `withPatchIds` validation and the cross-proposal closure guard.
- `GET /patch-groups`, and the stage / unstage routes → 404. That is what the
  Studio already reads as "no groups on this deployment".
- `/applicable/patches` (`/stat`), the websocket `patches` message and
  `GET /patches`: stop sending `patchGroups` and per-patch `patchGroupIds`.
- `postCommit`: ignore `patchGroupId` (keep the proposal refusal on
  `newBranch`); stop `markPublished` / `removePatchesFromAllGroups`.
- `deletePatches`, publish-job discard, `moveIntoProposal`, publish-job
  RECORD: stop touching groups; ignore `unstagePatchIds`.

Before Phase 2, run Val's `chromium-http` and `webkit-http` against the
mock content host with groups off — the mock's default
(`enablePatchGroups` is opt-in) — including `reloadEquivalence`, and fix what
fails. That is the path every Studio takes from here.

### Phase 2 — Val: delete groups

By package:

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
  `ValOpsMemory.ts`: the ignored `_patchGroup` parameter. (FS "staged
  uploads" are binary uploads, unrelated: keep.)
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
  `useReviewModel`, `reviewCompareParam`), `publish/pressForPage.ts`
  (`newestUnpublished` loses its scope), `publish/jobClient.ts`, stories and
  fixtures.
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
  `stagingBulkActions.test`. Edit the rest where they assert group behaviour
  (`appliedSetSync`, `noOpSourcePaths`, `publishButtonState`,
  `ownPendingChangeCount`, `netChangeModules`, `toReviewModel`,
  `reviewCheckbox`, the sources-memo tests, `ValRouter`, `proposalMode`) —
  never to make a non-group failure pass.

Keep: `PatchSets` (in shared; only its group comments change),
`PatchSetStore`, the worker. They still drive the discard closure, review and
compare grouping, `collectFieldChanges` (commit messages), `CompareLink`,
`PatchErrorsDialog`, the proposal merge's `changesToMove`, and Phase 4's
selection closure. Keep the applied set and `headPatchId` until Phase 6.

`createPatch` loses its trailing `patchGroup?` argument; `ParentRef` and
`fetchPatches` keep their shape, so `proposalMerge/world.ts` and the loop are
untouched by this phase — the proposal checks above say so.

Changeset, written for users: "Publish now publishes every pending change. To
keep changes out of a publish, move them to a proposal."

### Phase 3 — home: delete groups

Right after the Val release, not a release later (decision 3).

- Forward migration dropping `val_patch_group_patches` and `val_patch_groups`
  (migrations are forward-only; keep the old files).
- Delete `dal/patchGroups.ts`, `getPatchGroups.ts`, `postPatchGroupPatches.ts`,
  `deletePatchGroupPatches.ts`, `utils/patchGroupAccess.ts`, the routes in
  `routes.ts`, the group types and request fields in `Api.ts`, and
  `platform/scripts/content-host.ts`'s stub. The request schemas are plain
  `z.object`s, which drop keys they do not declare, so a field an older
  Studio still sends is stripped, not refused: nothing it sends can fail.
- Delete `patchGroups.test.ts` and `admin/.../patchGroupMembership.test.ts`,
  after moving the tests in `patchGroups.test.ts` that are about something
  else — deletion (chain locked before delete; a job-held change left in
  place) and, since step 4, held back — to the tests of those handlers.
  Edit `proposals.leaks.test`, `postCommitPhases.test`, `postPatchesHead.test`,
  `patchesMessage.test`, `publishJobs.test`, the billing tests.
- Comments that assume groups: `dal/patches.ts`, `postPatches`,
  `getApplicablePatchesAndCommits`, `Api.ts`, `tiers-build-plan.md`.

### Phase 4 — Publish selected

Managed projects only, because proposals are.

**What the editor sees.** Review already has a selection checkbox on each row.
With groups gone it is the only selection there is.

- Select rows → **Publish selected (N)** beside Publish.
- If the selection pulls in more (rule 2), the dialog lists what it adds and
  whose it is — "These 2 changes by Kari come with it: they move the same
  list." — and confirming publishes them too. Nothing moves until then.
- Then "Publishing 4 changes…" in place of the button, and the usual
  published state. A failure says why and offers **Open the proposal** (the
  changes are there, nothing is lost), and **Try again** only where retrying
  can help.

**What happens.** Publish selected is "New proposal with my changes" and
then that proposal's Publish, in one press. Since 8.2, a merge is not refused
because of pending site changes: the ones that conflict with it move into a
proposal of their own, and the rest stay pending. So the unselected changes
on the same page are not in the way, and no special kind of merge is needed.

```
 Studio                                   content (home)
 ──────                                   ──────────────
 closure = whole patch sets of selection
 save pending, then
 POST /proposals { kind: "publish",  ──▶  create, base = site head, move
   patchIds: closure, requestId }          (re-key) in the same transaction
 prepare + POST /proposals/:n/save   ──▶  commit on val/p/<n>
 POST /proposals/:n/merge            ──▶  content-only: a ref update, no build;
                                           8.2's moves, if anything conflicts
 ◀── merged ─────────────────────────────  the site's content version holds it
```

The landing half already exists for restore (`landRestore`: save this tab's
pending changes, then `POST /proposals` with `patchIds`, request id taken
from the patches so Try again opens the same proposal). Publish selected
reuses it and adds the closure, the save and the merge.

Why it merges cleanly: the selection is whole patch sets (rule 2), and what
was left on the site is in other sets, so it commutes with the selection and
does not conflict at the merge. What CAN conflict is a change written on the
site after the move, against a view without the selection: 8.2 moves it, as
it moves any conflicting pending change, and its authors are told.

**Needs, from 8.2:** the move at publish wired into content and the Studio
(8.2's next step, which waits on Phases 1–3). Publish selected comes after
it.

**home:**

1. **A `publish` proposal kind** beside `editor | ai | affected` (and
   `held-back`, Phase 5). It is not meant to be opened, so it skips the
   address / overlay `setup` job if the content-only merge does not read it
   (check), and the `carry-over` job. It still lists under Proposals ›
   Merged, so history says what was published.
2. **Create and move in one transaction** for this kind, so a lost answer
   cannot leave an empty proposal.

**val:**

- `selectionClosure(patchSets, selected)` in `@valbuild/shared/internal`,
  beside `PatchSets`: every patch in every patch set a selected patch is in,
  sets that share a change joined. That is the grouping `changesToMove`
  already does with `joinSharedChanges`, so the two share one function (moved
  from `merge.ts` to shared) rather than two copies. Replaces `stageClosure`,
  `unstageClosure` and `computeWriteClosure`; "New proposal + my changes"
  (`NewProposalDialog`, which does not carry changes yet) uses it too.
- `proposalsClient.create` gains `kind`.
- The Review action, the dialog, and the progress and failure states. A
  failure keeps the proposal and says so; one the merge refused (the site
  code moved, say) offers what the proposal's own Publish offers.

**The window.** Between the move and the ref update, the selection is on the
proposal's branch, and a site Studio does not show it. For a content-only
merge that is the merge job's prepare and seal — seconds. Measure it in the
loop; if fields visibly revert, list a merging `publish` proposal's patches
as `publishingPatches` on the site's `/stat` and render them read-only, as a
running site job's are.

**Rejected:** a site publish job with a selected subset — cheaper per press,
but it ships a patch while an earlier one stays pending, against rule 1. A
prefix closure — safe only while patches stay in one chain. A merge check of
its own for this kind (planned 2026-10-14) — 8.2's moves make it unnecessary.

**Tests:** `selectionClosure` (an earlier insert by someone else is pulled
in; an unrelated field of the same module is not; sets that share a change
come together); a `proposalMerge` scenario: two authors on one page, one
publishes a selection, the other's change stays pending and still applies,
and a change written after the move that conflicts is moved; e2e on
`chromium-http`: the same through the Studio, and a reload agrees
(`reloadEquivalence`); the loop, end to end.

**Built (2026-10-17).** Decided: the site's own Val server does the second
step, rather than the Studio going to the proposal's address to publish it
there. What it came to:

- **Studio** (`review/publishSelected.ts`, `usePublishSelected`): Review's
  selection bar has Publish selected, offered where a restore opens a
  proposal (the site of a project with proposals). `planSelection` closes the
  ticked rows into whole patch sets (`selectionClosure` in shared, which
  shares `joinSharedChanges` with `changesToMove`), and the confirm names what
  comes with it and whose it is. Then: save, `POST /publish-selected`, and the
  proposal's Publish (`publishProposal`, content only), followed to Live by
  the tracker every publish goes through. A failure after the move offers
  **Open the proposal** as well as **Try again**.
- **Val's server** (`/publish-selected`): prepares the selection over the
  site's head exactly as a publish job of it is prepared (`buildSourcesOf`:
  this build, the commits since it, the selection) and saves only what the
  selection touched, into a `publish` proposal created on that head. The
  head is content's `headCommitSha`, read before the chain, so a publish
  landing in between makes the create refuse ("publish them again") rather
  than revert it. On the site, the merge checks and press of a `publish`
  proposal are answered with the 8.2 moves (`answersMovesFor`): it changes no
  code, so the site's schemas are its own.
- **Content**: the `publish` kind (migration `1793900000`), which names its
  base and carries changes. It keeps its `setup` job: the merge does not need
  the address, but a failed publish does, so its changes can be opened. That
  answers open question 1.

Not yet: a lost answer after the move (the changes are in the proposal and
the Studio does not know its name) says the changes are no longer on the
site, and the proposal is found in the list. The merge window (open question 2) is not measured yet.

### Phase 5 — a held-back publish goes to a proposal

Today (hosted-publishing step 4) a publish that fails on its content puts its
job in `held_back_job_ids`, and every later publish goes without that job's
changes and without later changes to the same `.val` file
(`heldBackPatches`, `jobPlan.ts`). Everything else publishes — so a pending
change sits before published ones, against rule 1.

Instead: **when a publish fails on its content, its changes move to a
proposal.**

- What moves: the failed job's changes, and the site's pending changes to the
  same modules written after them — exactly the set `heldBackPatches` holds
  today. Content moves by module, which holds whole patch sets (rule 2), so
  no client closure is needed. Under the site's locks, as
  `moveIntoProposal` already does.
- The proposal: kind `held-back`, named after the publish ("Publish of 14:02
  that broke /pricing"), base = the site head the job built on.
- The site bar says what happened and where the changes are: "Publishing
  broke /pricing. Its 6 changes are in a proposal." with **Open the
  proposal** and **Details**. Inside the proposal, **Try again** is its
  Publish, and **Discard** is Close (recoverable, as every Close is).
- Bo's good change that rode in Ada's broken publish moves with it, as it is
  held with it today; in the proposal Ada discards hers and publishes the
  rest. That replaces the "held only while every change is still pending"
  rule.
- A failure the platform caused (it did not answer) moves nothing, as it holds
  nothing today.
- **Projects without proposals** (connected, hosted by us — publish jobs, no
  proposals yet): the failed publish pauses the branch until Try again or
  Discard, as before step 4, so rule 1 still holds there. When proposals
  reach those projects they take this path.

**This reverses P4 for one case** ("nothing moves between branches unless an
editor moved it"), and `proposals.md` has to say so: the editor pressed
Publish, the publish could not land, and a proposal is where its changes can
be kept, seen and fixed without blocking anyone else. It is not the rejected
"moving affected changes automatically": an affected change was valid where
it was made and the site moved away from it; a held-back one broke a page.

The move is the one 8.2 makes, with content deciding alone (no Val server is
in the failed job's loop to compute patch sets), hence by module. The moved
changes leave the site as pending and are pending in the proposal, so
`merge-from-site`'s unsaved count sees them there, which is what it should.

Removed with it: `held_back_job_ids`, `heldBackPatches` / `heldBackOf`, the
"held back" count and reason in `publishButtonState`, the
`discardHeldByPublish` path for held-back changes (a change in a RUNNING
publish is still not discarded), `heldBackSource.ts`. Their model tests in
`docs/publish-jobs` (`suite.ts` §4) are rewritten for the move.

**Built, for managed projects (2026-10-17).** Decided: connected projects
get proposals too (later; on GitHub a proposal is a pull request, 8.2
decision 5), and until then they keep today's held-back behaviour rather than
pausing. So rule 1 holds on managed sites now, and on connected ones once
they have proposals; Phase 6 waits for that.

- **Content** (`moveFailedPublish`, migration `1794000000`): in the
  transaction that fails a job on its content, after the jobs sharing its
  changes are interrupted, `JobTx.moveFailed` moves what `heldBackPatches`
  would hold into a `held-back` proposal based on `job.base`, owned by the
  first author and co-owned by the rest. Changes an active job holds stay.
  `no-proposals` makes the runner hold them back, as before. The proposal
  remembers its job (`held_back_job_id`), and the request status says where
  the changes went (`movedTo`, with `actions: []`).
- **Studio**: the failure toast says "Publishing broke the site", names the
  proposal, and offers Open the proposal instead of Try again and Discard.
- **Tests**: the handler tests pin both (held back without proposals, moved
  with them), and the Postgres-against-memory differential test runs with
  proposals on in both worlds. The model's suite (`docs/publish-jobs`) is of
  a project without proposals and is unchanged; a model of the move is not
  written yet.

Found while building it: step 8.2's press reads `move-inputs` before it
reaches the merge, so an edit made right after pressing Publish got there
first and was refused as unsaved. The press now names the save it
publishes (`MergeBody.save`, from `move-inputs`), and content lets a press
that names its save go past later changes, which carry over.

Not yet: removing `held_back_job_ids`, `heldBackPatches` and the held-back
UI, which connected projects still use.

### Phase 6 — published comes first, and cash it in

Enforce rule 1, in home:

- **`/commit`** (projects on their own hosting): refuse an `appliedPatches`
  that is not the pending chain up to a patch, in chain order. Today it
  accepts any subset.
- **Publish jobs**: everything pending at start; a failure on content moves
  (Phase 5) or pauses; a platform failure ships nothing. Assert it.
- **Flow A**, when built: an affected change blocks the site's Publish rather
  than being skipped by it.
- **RECORD** checks, after marking applied, that no pending site patch
  precedes an applied one. A violation is a bug and fails the publish.

Then simplify, in both:

- **Applied set → cursor.** `/stat` and the websocket send
  `appliedThrough: PatchId | null` instead of the id list.
  `PatchStore.receiveApplied` / `applyServerApplied`, `knownShipped`,
  `shippedOutside`, `pendingAmong`, `SourceStore.markApplied` and
  `publishJobs.heldByContent` read the cursor. The published realm
  (`peekBase`, compare's "before") is base + chain up to the cursor.
- **Chain head.** The last listed patch is the head again. `chainHeadOf`
  falls back to it; `headPatchId` stays as a cross-check one release, then
  goes — and the loop's steps that read it from `/applicable/patches` change
  in the same PR. `headVersion` stays (it orders stats, not publishes). Update the
  `quirks.md` entry on why the head is not the last patch.
- **Publish head** (`expectedHeadCommitSha`, `/save` `headMoved`). It existed
  so a subset publish could not land on a commit the client had not seen.
  Keep it unless it gets in the way: "the chain you reviewed is not what
  ships" is still a fair 409.
- **Shared draft reads.** `/sources/~` and `/json` answers are the same for
  every authorized caller, so they can be cached by
  `(sourcesSha, headPatchId, headVersion)` instead of per request. A
  cross-request cache is its own, measured change; update `quirks.md` on
  draft reads either way.

### Phase 7 — docs

- `docs/independent-publish/DESIGN.md` and `PLAN.md`: replace with a short
  note pointing here; git keeps them.
- `architecture/stores.md` (the head paragraph), `architecture/quirks.md`
  (chain head, draft reads).
- home: `docs/proposals.md` (the patch-groups note, Flow A's Unstage, "closed
  the way unstage is" → whole patch sets, the staged-group wording, "Later ›
  Patch groups", P4's exception), `docs/hosted-publishing.md` step 4 (held
  back → proposal), `docs/app-mode.md` (RECORD's group cleanup, discard
  `unstagePatchIds`, the open question proposing groups for subset publish),
  `docs/tiers-build-plan.md`.

---

## Open questions

1. ~~**Does a content-only merge read the overlay** the `setup` job writes?~~
   No, but a `publish` proposal keeps its setup anyway: a failed publish
   leaves its changes in it, and they have to be openable (Phase 4, Built).
2. **Is the merge window visible?** Measure before building the
   `publishingPatches` fallback.
3. **Pausing on projects without proposals** (Phase 5) brings back, for them,
   the pause step 4 removed. Acceptable until proposals reach connected
   projects hosted by us?
