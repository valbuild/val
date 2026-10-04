# Remove patch groups

Status: **plan, nothing removed yet.** This branch sits on top of #793
(`claude/ecstatic-pasteur-fsayf8-draft-overlay`) so #793's fixes land first;
rebase onto `main` once #793 merges. The work spans this repo and
`valbuild/home`. Each phase below is meant to be its own PR, and any of them
can be split further.

Replacing groups with something else ("proposals") is out of scope here. This
plan only takes groups out and leaves the Studio in the state it was in before
they existed: one shared pending chain, everyone sees all of it, Publish ships
it.

## Why

A patch group is a per-author, server-side, curated subset of one shared,
linearly ordered patch chain. Keeping that subset publishable (the prefix
invariant, `docs/independent-publish/DESIGN.md`) and keeping every tab, every
browser and the server agreeing on it is where most of the Studio's recent
publishing complexity comes from:

- prefix closures computed on the client and trusted by the server
  (`withPatchIds`, the stage closure, `unstagePatchIds`);
- scoped rendering: base + your group, "held" patches, `held` vs settled;
- following the server's groups: `reconcileScope`, unconfirmed stage/unstage
  overlays, versioned group snapshots on every `/stat` and websocket message;
- ordering group changes against saves (`holdGroupChangesFor`, #787);
- group lifecycle: `emptiesOwnPatchGroup`, `closesPatchGroupId`,
  `ownPatchGroupId`, `patchGroupsSeen`, the window with no open group after a
  publish, 409s on a stale id, "already published";
- coalescing holes nobody repairs, and the widening toasts.

Eight of the nine "invariants worth attacking" in `DESIGN.md` are about groups.
Rough size of what goes: 12–15k lines across both repos, about half of them
tests.

## What stays, because it is not group logic

These look like group code and sit next to it, but they are needed by any
multi-author chain. **Do not remove them in a grep sweep.**

- **`headVersion` / chain versioning.** It came in with home's
  `val_patch_chains` (home `e9de49b`) to order competing `/stat` answers;
  groups only added stage and unstage as two more things that bump it. Keep it
  on `/stat`, `PUT /patches`, `DELETE /patches` (`reportHeadVersion`), `/save`,
  commit, publish jobs and the websocket message. Drop it only from the
  stage/unstage responses, which go away.
- **`headPatchId` / `chainHeadOf`.** Still the right parent for a write. Only
  the comments justifying it "since patch groups" change (`chainHead.ts`,
  `architecture/stores.md`, `architecture/quirks.md`, home's
  `getApplicablePatchesAndCommits.ts` and `dal/patches.ts`).
- **The applied set** (`receiveApplied`, `serverAppliedIds`, `pendingAmong`,
  `SourceStore.markApplied`, `peekBase`), **the publish head / 409**
  (`expectedHeadCommitSha`, `head-moved`), `markPublished` / `forgetPublished`,
  `takeNamedPrefix` / `exact` publish, and `recordPublishErrors`.
- **`PatchSets`.** They feed compare, review, `DraftChanges`,
  `FilePropertiesModal` and `System.getPatchSets`, independently of groups.
- **`draftOverlay` / `scopedModulePatches`'s module filter in `ValOps.ts`.**
  This is #793's work and has nothing to do with groups; only the `patchIds`
  scope argument goes.
- **Publish jobs.** They are already group-agnostic ("a job takes every queued
  request and everything pending"); the only trace is `unstagePatchIds` on
  discard.
- **Other things called "stage"**, unrelated to groups: the chain-swap
  `PatchStore.stage`/`staged`/`holdsAll` and `BaseAlignment`, history's
  `useStageRestore`/`RestoreControls`, `PendingChangesGate`'s `held`, and the
  fs `.val/patches` staging directory.

## Decisions

Agreed. The first three are behaviour changes users will see.

1. **Publish ships the whole pending chain.** No "publish only my changes" until
   proposals exist. The selected-subset machinery (`stageClosure`,
   `validateGroup`, `prefixViolations`) is deleted rather than kept for later;
   it is small, it is in git, and proposals may not want the same shape.
2. **Draft previews show everyone's pending work.** The Studio, SSR
   `fetchVal`/`useVal` and #793's `fetchValDraft` all go unscoped. That is
   what groups existed to prevent, so it goes in the changeset in plain words.
3. **The Review badge and pending counts include other authors' changes** on a
   shared branch.
4. **Discard needs no closure.** A later patch that no longer applies after a
   discard is already dropped by the existing unapplicable-patch path in
   `createSystem`.
5. **home answers the removed `/patch-groups` routes by what an old client
   needs from each, and silently ignores leftover group fields:**
   - `GET /patch-groups` → **404**, from routing. This one is not a choice: an
     old `@valbuild/server` reads 404 as "this deployment has no groups" and
     renders unscoped, and reads anything else, a 400 included, as an error
     and renders base (see "Compatibility").
   - `POST` / `DELETE /patch-groups/:id/patches` (stage, unstage) → **400 Bad
     Request**, `"Patch groups have been removed. Reload the Studio."`. The
     request is one this API no longer accepts, rather than a resource that
     never existed. Only a Studio left open across the deploy sends it (an old
     server shows it as "Could not update patch group. HTTP error: 400"; the
     body message is not surfaced). These two handlers are a few lines each
     and can be deleted once old Studios are gone.
6. **The table drop ships after the code removal** in home, never in the same
   deploy (see H2).
7. **`x-val-profile-id` is no longer sent on commit.** home's `postCommit` read
   the profile only to check the caller owned the group it closed; the
   committer is already in the body. The header stays where
   `getProfileAuthHeaders` sends it for other calls; only the commit-specific
   one in `ValOpsHttp.commit` goes. An old server still sending it is harmless:
   home's auth reads it as an identity claim and derives no scope from it.

## Compatibility

Studio and `@valbuild/server` ship together inside the customer's app, and
**customer apps pin their own versions**. So an old `@valbuild/server` will keep
talking to the new home for months. `@valbuild/next`/`@valbuild/tanstack` deploy
with it. Only home deploys on its own.

| Combination                        | What happens                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New Val → old home                 | Works. zod strips the extra annotations home still sends; home keeps putting writes into groups that never close, which nothing reads. So **V1 can ship before H1**.                                                                                                                                                                                                                                         |
| Old Val → new home                 | Works **only if** home answers `GET /patch-groups` with a plain **404**. Old `ValOpsHttp.fetchPatchGroups` reads 404 as "unsupported" and goes unscoped; any other status (401, 403, 410, 500) reads as an error and `resolveOwnPatchScope` renders **base**, so every draft preview silently loses all pending content. The 404 has to come from routing, not from an auth check before it.                 |
| Old Studio → new home, mid-session | An old Studio latches `patchGroupsSeen` only after a stat or save answer carries groups. The new home never sends them, so after a reload it runs unscoped. A tab left open across the deploy can get one 400 on a stage click; a reload fixes it.                                                                                                                                                           |
| Leftover fields from old servers   | home's body schemas are non-strict `z.object`, so dropping a field from the schema strips it silently. That is the accept-and-ignore. Fields: `patchGroupId`/`withPatchIds` (+ `alsoAddPatchIds`, `holdBackForGroupIds`, `closureVersion`) on `POST /patches`, `unstagePatchIds`/`alsoUnstagePatchIds` on `DELETE /patches` and on job discard, `patchGroupId` on `POST /commit`. Pin each with a test (H1). |

**Verify in H1, not assumed yet:** an old Studio running unscoped in http mode
publishes plain `chainNow`, which includes applied-but-not-yet-deployed patches
(see V1's publish fix). Check what home's `postCommit` does when handed a patch
that is already applied. If it refuses, old Studios on a groups-less home hit it
on every publish made between a publish and its deploy.

## Phases

```
val:   V1 ──► V2 ──► V3 ──► V4 ──► V5
home:      H1 (any time after V1 is ready) ─────────► H2 (after H1 is deployed)
```

V1 is the one that changes behaviour; everything after it deletes code that V1
made unreachable. V1 is also the cheap experiment: if publishing problems go
away with V1 alone, that settles the question before the big deletions.

### V1 — Stop using groups (val, small, behaviour change)

Make every path take the unscoped branch it already has. fs mode, memory mode
and every http e2e without `enablePatchGroups` already run it.

- **Studio:** in `components/shell/ValShell.tsx`, stop mounting
  `usePatchGroupScope`, `usePatchGroupChange`, `usePatchGroupWrites`,
  `usePatchGroupIdentity`, `<PatchGroupWidenedToasts/>` and the `StagingScope`
  wrappers. The staging context's no-op default then gives `enabled: false`
  everywhere, `patchGroupIds` stays `null`, and no resolver is registered.
- **Publish must filter applied patches.** The unscoped branch in
  `createSystem.publish` (`groupScoped`) is plain `chainNow`, which in http mode
  still carries applied-but-not-yet-deployed records; only the scoped branch
  filtered them. Make it `chainNow` filtered by `patchStore.pendingAmong(chainNow)`.
  Port `patchGroupIdentity.test.ts`' "a group whose every patch has shipped
  elsewhere publishes NOTHING" as "a chain whose every patch shipped elsewhere
  is `nothing-to-publish`" to pin it.
- **Server:** make `resolveOwnPatchScope` in `ValServer.ts` return `undefined`
  (unscoped) unconditionally, so `/sources/~` and `/json` stop scoping.
  `own_patch_groups_only` is then accepted and ignored; the keys stay on the
  wire until V4.
- **Tests:** group tests that fail once nothing mounts the scope are deleted
  (in V2/V3), never skipped. If that set is large, do V1 and V2 as one PR.
- **e2e:** `reloadEquivalence.spec.ts`' four staging tests and
  `patchGroups.spec.ts` go here or in V2 (they need the Unstage button and
  `data-val-staging`).

### V2 — Delete the staging UI (val/ui)

Files that go whole: `PatchStagingProvider.tsx`, `StagingToggle.tsx`,
`useCurrentPatchGroup.ts`, `useOwnUnstagedPatchIds.ts`,
`PatchGroupWidenedToasts.tsx`, `useIndexedPatchSets.ts`,
`utils/splitTreesByStaging.ts`, with their tests (`useCurrentPatchGroup.test`,
`useOwnUnstagedPatchIds.test`, `stagingBulkActions.test`,
`splitTreesByStaging.test`).

Simplify:

- **Review** (`review/ReviewView.tsx`, `types.ts`, `useReviewModel.ts`,
  `ReviewSurface.tsx`, `toReviewModel.ts`, `fixtures.ts`, stories): one list
  instead of Staged/Unstaged; no Stage/Unstage buttons, "Partly staged" badge,
  "also unstages"/"also publishes" notes; "Compare staged changes" becomes
  "Compare changes". The row checkboxes stay, because Revert uses them.
- **Compare** (`ComparePatchSets.tsx`, stories): `StagedSections` always takes
  the `renderTrees(trees)` path; no `StagingToggle`, greyed-out rows or
  `data-val-staging`.
- **Publish button** (`PublishButton.tsx`, `publishButtonState.ts`): drop
  `unstagedChangeCount` and its reason text.
- **ValProvider.tsx:** delete `statPatchGroups`, `useChainOrder`,
  `useGroupsVersion` (a memo dependency in several hooks — remove it from them
  in the same change), `usePatchGroups`, `useOwnPatchGroupId`,
  `usePatchGroupsSupported`, `useUnstagedPatchIds`; drop the held-path branch of
  `useNoOpSourcePaths`; `useOwnPendingChangeCount` counts `allRecords()` minus
  committed.
- **ValShell.tsx:** delete the hooks V1 unmounted, `StagingScope`,
  `sameMembers`; `StagedCompare` becomes a plain `<ComparePatchSets>`.
- Trim mixed tests: `noOpSourcePaths.test`, `ownPendingChangeCount.test`,
  `publishButtonState.test`, `publishAfterRefusal.test`, `toReviewModel.test`
  (keep the cases that pin unscoped behaviour; delete the ones about
  unstaged/held patches).

### V3 — Delete the store machinery (val/ui stores)

In this order, each step typechecking:

1. **`createSystem.ts`:** the `System` methods `setPatchGroup`,
   `seedPatchGroup`, `setPatchGroupResolver`, `setOwnPatchGroupId`,
   `computeWriteClosure`, `computeDiscardClosure`, `stagePatches`,
   `unstagePatches`, `persistPatchGroupChange`, `patchGroup()`; the types
   `StagePatches`, `PatchGroupChangeRequest`; the state and every function
   from `patchGroupIds` through `computeWriteClosure` (`emptiesOwnPatchGroup`,
   `sendPatchGroupChange`, `extend/narrowPatchGroup`, `reconcileScope`,
   `holdGroupChangesFor`, `queueGroupChange`, `unstageOverWrite`,
   `closureOfWrite`, `holdBackOverHoles`, the unconfirmed overlay,
   `prefixViolations`, `shippedPatchIds`); the scope-only listeners
   (`patch:groups`, and the scope parts of `patch:create`/`saved`/`receive`/`chain`);
   in `publish`, the prefix check, `closesOwnPatchGroup`, the `group-published`
   branch and the `closedOwnPatchGroup` option; in `dispose`, the
   `writeInFlight` release; in `discard`, the closure. Keep the shared in-flight
   patch-set build (it guards a double-apply bug); `PatchSetsBuild.chain` can go.
2. **`PatchSync.ts`:** `PatchGroupMembership`, `PatchGroupResolver`,
   `WriteMembership*`, the resolver field/setter/await, `recordOwnPatchGroup`,
   `SaveResult.patchGroupId`. Removing the always-present `await` drops a
   microtask between `setState("saving")` and `save()`; watch the
   PatchSync/autosave timing tests. The post-resolver `stopped` check goes with it.
3. **`PublishSeam.ts`:** `closesPatchGroupId`, `group-published`,
   `DiscardPatches.unstagePatchIds`. **`createValSystem.ts`:** the matching
   seams (`stagePatches`/`unstagePatches`, membership on save, `patchGroupId`
   on the save answer, `closesPatchGroupId`/`patchGroupPublished` on publish,
   `unstagePatchIds` on discard). `publish/jobClient.ts`: the unused
   `unstagePatchIds` parameter.
4. **One commit for visibility:** `SourceStore` `visiblePatchIds`, `isVisible`,
   `setVisiblePatchIds`, `rebuildModules`, the unstaged skip and event field in
   `applyEntries`, the rebuild branch of `markApplied`; **together with**
   `PatchStore.unstagedIds` and the unstaged condition in `chainSettled`, and
   `types.ts`' `source:patch-apply.unstaged`. Splitting these reintroduces "the
   chain never settles, every field stays inert".
5. **`PatchStore.ts`:** `patchGroups`, `sameGroups`, `groupsVersionCounter`,
   `ownPatchGroupId`, `patchGroupsSeen`, `receiveStatGroups` and the rest of the
   group accessors, `markPublished`'s options, `bumpGroups`. **`StatStore.ts`**,
   **`statSnapshotOf.ts`**, **`ValStoreProvider.tsx`**, **`types.ts`**
   (`stat:receive.patchGroups`, `patch:groups`, `patch:group-widened`).
   `StatStore.profileId` was only read by `reconcileScope`; check for other
   readers before removing it.
6. **`utils/patchGroups.ts` and `utils/patchGroupScenario.ts`.** First move
   `patchGroups.test.ts`' "patch sets stay sensible" describe into
   `PatchSets.test.ts` (it tests PatchSets through the scenario). Then delete
   both files, `patchGroups.test.ts`, its snapshot and `patchGroupsStaging.test.ts`.
   Update the comments that point at them (`PatchSets.ts`, `PatchSets.test.ts`,
   `compare/types.ts`, `compare/undoSelection.ts` — `undoSelection`'s own
   closure is independent and stays).

Test files deleted whole in V3: `patchGroupSaveRace`, `patchGroupDeferredChanges`,
`patchGroupChangeAnswers`, `patchGroupOtherTab`, `patchGroupWidened`,
`patchGroupAdoptHoles`, `patchGroupLifecycle`, `discardClosure`. Port first:

- `patchGroupPublish.test.ts`: "an unscoped client still publishes the whole
  chain", and "writes with no group when no resolver is registered" reworded as
  "a save carries no group fields".
- `patchGroupFollowsServer.test.ts`: "my publish, announced while the old build
  is served → stays on screen" (keep the `read()`/`pendingAmong` asserts).
- Trim `appliedSetSync.test.ts` (drop the scope cases and `withGroups`),
  `publishedBase.test.ts` (it calls `setPatchGroup([])` only to force a rebuild —
  use another trigger), `statSnapshotOf.test`, `useStatus.test`.

### V4 — Wire contract, server, framework packages, e2e (val)

- **`shared/ApiRoutes.ts`:** `PatchGroup`/`PatchGroupT`; `/stat` `patchGroups`;
  `DELETE /patches` `unstagePatchIds` (keep `reportHeadVersion`);
  `PUT /patches` `patchGroupId`/`withPatchIds` and response `patchGroupId`;
  `GET /patches` `include_patch_groups` and `patchIds`/`patchGroups` annotations;
  the whole `/patch-groups/~/patches` route; `/sources/~` `patch_id` and
  `own_patch_groups_only`; `/save` `patchGroupId`, its 403 arm and the
  `patchGroupPublished` 409; `/json` `own_patch_groups_only`; the websocket
  `patches` message's `patchGroups`. `publish/contentApi.ts`: discard
  `unstagePatchIds`. `hooks/useStatus.ts`' `PatchGroup` zod field goes in the
  same change.
- **`ValServer.ts`:** the `#region patch groups` route; membership in
  `PUT /patches`; the annotation in `GET /patches`; `boundUnstageClosure` in
  `DELETE /patches` (also saves a `fetchPatches` round trip per discard);
  scoping in `/json` and `/sources/~`; `refuseUnlessOwn` and `patchGroupId` in
  `/save`; the helpers `scopedPatches`, `boundUnstageClosure`,
  `resolveOwnPatchScope`, `refuseUnlessOwn`. **`CommitContext.patchGroupId`
  is public API** (exported, reaches `publishOverride` hosts): removing it is a
  type break — say so in the changeset.
- **`ValOps.ts`, `ValOpsFS.ts`, `ValOpsMemory.ts`:** `PatchGroupMembership`,
  the `patchGroup` parameter on `createPatch`/`saveSourceFilePatch`,
  `SaveSourceFilePatchResult.patchGroupId`, `OrderedPatches.patchGroups`, the
  `patchIds` option on the json-entry readers.
- **`ValOpsHttp.ts`:** the applicable-patches annotations,
  `SavePatchResponse.patchGroupId`, the whole groups region (`stagePatches`,
  `unstagePatches`, `patchGroupsCache`, `getPatchGroups`, `fetchPatchGroups`,
  `ownGroupBranch`, `mutatePatchGroup`), group fields on save, delete and
  commit, and the commit-specific `x-val-profile-id` header (decision 7).
- **next / tanstack:** remove `own_patch_groups_only: true` and
  `patch_id: undefined` from `initValRsc.ts` and `initValContent.ts`
  (including #793's `fetchValDraft` and `withDraftJsonEntries`'
  `include_patch_groups: undefined`). Rewrite the rationale in
  `shared/server/requestScopedMemo.ts`: the memo is still per request, now
  because the body is unpublished content released only to a valid session,
  not because it is one author's scope. Edit `initValRsc.sourcesMemo.test`,
  `draftRead.perf.test`, `initValContent.sourcesMemo.test`.
- **Server tests:** delete `patchGroupOwnership`, `boundUnstageClosure`,
  `scopedPatches`, `patchGroupResolution`, `sourcesPatchGroup`; trim
  `scopedJsonEntries.test.ts` to its `draftOverlay` cases; in
  `ValRouter.test.ts` switch the "optional body" regression tests from
  `unstagePatchIds` to `reportHeadVersion` so the guard survives;
  `homeWireContract.test.ts`: delete the group cases, keep head, version,
  delete, commit-modules and history.
- **e2e:** delete `http/patchGroups.spec.ts`, `http/staging.ts`; in
  `reloadEquivalence.spec.ts` keep "own publish never takes it off…" and "Ada
  publishes three times" minus the `patch:group-widened` listener;
  `reloadEquivalence.ts`: `staged`/`unstaged` become `pending`, `settled()`
  becomes `chainSettled()`; `httpMode.ts`: `MockPatchGroup`, `enablePatchGroups`.
- **Mock content host (`e2e/mock-content-host/server.ts`):** group state,
  broadcast field, annotation, save membership, `getOrCreateOpenGroup`,
  `getPatchGroups`, `resolveOwnOpenGroup`, `mutatePatchGroup`, unstage on
  delete, group handling in commit, the `patch-groups` control and routes. It
  must then 404 `/patch-groups` like the new home.
- **mcp:** nothing but the comment in `writePath.test.ts`. (MCP writes never
  joined a group, so they were invisible in scoped previews and never shipped
  by a group publish; this removal fixes that.)

### V5 — Docs and changeset (val)

- Delete `docs/independent-publish/DESIGN.md` and `PLAN.md`, or replace them
  with a short note saying what groups were, that they were removed and why,
  linking this plan. Comments in `ApiRoutes.ts`, `ValServer.ts` and UI files
  link there; fix them.
- `architecture/stores.md` (head rationale), `architecture/quirks.md` (head
  paragraph; memo rationale), `VAL_PROMPT.md`, and the UI's
  `stores/architecture.md` and `stores/openquestions.md`.
- Leave the `CHANGELOG.md` entries alone; they are release history.
- **Changeset** (ui, server, shared, next, tanstack): Publish now ships every
  pending change on the branch, previews show everyone's pending work, the
  review page has no staging, and `CommitContext.patchGroupId` is gone.

### H1 — Remove groups from the content API (home)

- **Routes** (`content/src/routes.ts`, decision 5):
  `GET /:org/:project/patch-groups` is removed, so it **404s**; verify the 404
  comes from routing and not from an auth check in front of it.
  `POST` and `DELETE /:org/:project/patch-groups/:patchGroupId/patches` are
  replaced by one tiny handler answering **400** "Patch groups have been
  removed. Reload the Studio.", with no auth, DB or chain access.
- **Delete files:** `content/src/handlers/postPatchGroupPatches.ts`,
  `deletePatchGroupPatches.ts`, `getPatchGroups.ts`,
  `content/src/utils/patchGroupAccess.ts`, `server-side/src/db/dal/patchGroups.ts`
  (+ its two lines in `dal/index.ts`); the `/patch-groups` types in
  `content/src/handlers/Api.ts`.
- **`postPatches.ts`:** schema fields, the `withPatchIds` existence check (a 400
  on unknown ids — must go for accept-and-ignore), group resolution and its
  404/403/409 refusals, `addPatches`, `patchGroupId` in the response. After:
  lock chain → read head → parent/pending check → insert → bump version.
- **`deletePatches.ts`:** schema fields and the unstage block.
- **`postCommit.ts`:** the `resolveOwnPatchGroup` refusals before commit
  (including "Patch group is already published"), `markPublished` of the group
  and `removePatchesFromAllGroups` in RECORD. Commit already checks no prefix
  invariant or membership; it publishes what it is given. Keep
  `bumpChainVersion`/`headVersion`.
- **`getApplicablePatches.ts`:** group reads, `patchGroupIds`, `patchGroups`.
- **`patchesMessage.ts`, `webSocketServer.ts`:** `patchGroups` out of the
  message; keep `appliedPatches` (#147).
- **`publishJobs.ts`** (`postPublishJobDiscard`) and
  **`val/publishJobs/postgresStore.ts`:** the unstage parse and
  `removePatchesFromAllGroups`.
- **`dal/patches.ts`:** delete `announceChange` (only the group handlers call
  it); keep `bumpChainVersion`, fix its docs.
- **`platform/scripts/content-host.ts`:** the `GET /patch-groups` case.
  `docs/app-mode.md`: three mentions.
- **Tests:** before deleting `content/src/handlers/patchGroups.test.ts` (1254
  lines), move its two `deletePatches` cases and the mock-DAL harness into a
  new `deletePatches.test.ts` — they are the only unit tests of
  `deletePatches` ("the chain of every branch it deletes from is locked before
  the delete"; "a change a publish job holds is left in place…"). Delete
  `admin/src/lib/patchGroupMembership.test.ts`. Edit `postCommitPhases.test.ts`,
  `postPatchesHead.test.ts`, `publishJobs.test.ts` (keep `unstagePatchIds` in
  the discard body so it pins accept-and-ignore), `patchesMessage.test.ts`.
  **Add** accept-and-ignore cases: `POST /patches` with `patchGroupId` and
  `withPatchIds` (including an unknown id) → 200; `POST /commit` with a foreign
  or already-published `patchGroupId` → not refused; `DELETE /patches` with
  `unstagePatchIds` → only `patchIds` deleted; `GET /patch-groups` → 404;
  stage and unstage → 400 and nothing written; `POST /commit` with no
  `x-val-profile-id` → committed.
  And the open item from Compatibility: `POST /commit` handed an already-applied
  patch.
- **Checks** (home has no CI on push; per `rules.md` the PR gets a "Checks on
  `<sha>`" comment): `pnpm ci:lint`, `pnpm ci:typecheck`, `pnpm ci:test`
  (Postgres on localhost:5432), `pnpm --filter @valbuild/platform ci:unit` and
  `ci:e2e`.

### H2 — Drop the tables (home, after H1 is live)

`publish.yml` runs `run-migrations` in parallel with `deploy`, so a drop that
lands in the same deploy as H1 can run while the old code still serves, and
every `POST /patches` 500s on `patchGroups.getOrCreateOpen`. Ship it as its own
PR after H1 is deployed:

```sql
-- db/migrations/<next timestamp>.do.drop_patch_groups.sql
BEGIN;
DROP TABLE IF EXISTS val_patch_group_patches;
DROP TABLE IF EXISTS val_patch_groups;
COMMIT;
```

Nothing references the tables (their foreign keys point outward), and no other
table has group columns. Do not edit or delete `1788470000` /
`1788544100`: postgrator records applied versions and test setup replays every
`.do.` file, so create-then-drop has to keep working.

## Checks (val, per PR)

From `.claude/CLAUDE.md`: `pnpm run lint`, `pnpm -w run format`,
`pnpm run -r typecheck`, `pnpm test`, `pnpm run build` (then
`pnpm preconstruct dev`), `examples/next` and `examples/tanstack` builds, the
blocking smoke (`--project=tanstack`; chromium `smoke` + `insecure-context`),
and — since this is all publishing — `--project=chromium-http` for
`draftAfterPublish`, `publish`, `reloadEquivalence` and `history`. Run
`val validate` against `examples/next` after V4 (it touches `packages/server`).

## Open questions

None left from the first round (answered as decisions 1, 2, 5 and 7). Still to
verify rather than decide: what home's `postCommit` does with an
already-applied patch (Compatibility).
