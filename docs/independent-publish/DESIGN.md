# Independent publish — how it works

One editor publishes their own changes while other people's unpublished work
sits in the same patch chain, untouched.

## Two different things

- **Patch set** — computed from the schema. Patches that can shift each other's
  paths (an array insert moves every later index). Not curated; it is a fact
  about the content.
- **Patch group** — curated, one open group per author per branch. The set of
  patch ids that author intends to publish. This is what a publish ships.

## The chain

There is one linear, ordered, shared chain of patches on a branch. Publishing a
subset of it is only safe because of:

**The prefix invariant.** For every patch group and every patch set, the group's
members within that patch set form a _prefix_ of that set in chain order.

A patch left behind is then in a different patch set, so committing this group
cannot shift its paths. Skip a patch and ship a later one from the same set and
the later one applies onto a value that never existed.

The union of prefix-closed groups is prefix-closed, so two authors publishing
independently stay safe.

## Write path (atomic)

`POST /patches` carries the patch _and_ its membership in one request:

- No `patchGroupId` is sent. The server resolves "this author's open group on
  this branch, creating it if absent". The client must not hold an id across
  publishes — a publish closes the group and a write into a closed one is
  refused.
- `alsoAddPatchIds` is the **closure**: other patches that must join the group
  for the prefix invariant to hold. Computed on the client, which is the only
  side with the schema. The server set-unions it and does not second-guess it.
- Every refusal runs before the insert, so an invalid closure is a 400 with
  nothing written. A patch outside its author's group is one they cannot
  publish.
- The response returns `patchGroupId`. This is the only way the client learns
  the id of the group its own first write created.

## Read path (scoping)

- **Studio.** `System.setPatchGroup(ids)` sets _what is visible_ and _what will
  publish_ in one call. `SourceStore` holds back non-members (rebuild, not
  un-apply: JSON patches are not invertible). Held patches stay in the chain —
  held is not gone. `publish` filters the chain by the group, preserving _chain_
  order.
- **RSC / draft (`fetchVal`, `useVal`).** No client state, so it cannot name its
  own ids: `PUT /sources/~` with `own_patch_groups_only`, and the server
  resolves the caller's open groups from the session.

Scoping applies to **pending** work only. A published patch stays in the chain
with `appliedAt` set until the next deployment moves the base, so a scoped render
applies its caller's group UNION everything already applied — keyed on
`appliedAt` rather than the group's `publishedAt`, because a partial publish
leaves the group open with only some of its patches applied. Without that, the
moment someone published, their own preview reverted the field they had just
shipped and nobody else saw it until the deploy landed.

Three states are kept distinct at every hop, and collapsing any two is a bug
with a different symptom each time:

| value         | meaning                      | behaviour                 |
| ------------- | ---------------------------- | ------------------------- |
| `null`/absent | no groups on this deployment | unscoped (today's)        |
| `[]`          | a group holding nothing      | render base, ship nothing |
| `[...]`       | a group                      | scoped                    |

A group lookup has three outcomes, not two. **404** means the content API has no
patch groups at all, and that deployment stays unscoped. Any other failure means
the endpoint is there and did not answer, and renders **base**: a degraded
preview beats leaking someone's draft. (The shipped assumption is that the
content API _does_ have groups — valbuild/home#37 — so the 404 path is a
belt-and-braces fallback rather than a supported configuration.)

Stage and unstage are refused unless the caller owns the group and it is still
open. `getAuth` only proves a session exists, and every call to the content API
carries the app's key rather than the editor's identity, so this server is the
only place that knows both who is asking and whose group it is.

## Three things that keep a client honest about the world

- **The applied set.** `/stat` sends which of the chain ids have already
  SHIPPED, not just which exist. A record is fetched once and then held, so
  without it a client never learns that somebody else's publish committed a
  patch it is holding — the patch stayed pending in the scope, the prefix gate
  read a hole in front of it, and Publish refused for a reason that had stopped
  being true. Absent is "no news", never "none of them"; the mark is one-way and
  is cleared only by the patch leaving the chain.
- **The publish head.** `/save` carries the newest commit the client knew about
  and is answered 409 when the server sees a newer one. Not `baseSha`, which
  moves only when a deployment lands, and not git's not-fast-forward guard,
  which cannot see this at all: the chain is fetched and committed fresh at
  publish time, so the parent commit sent is always the server's current one.
- **The widening toast.** The write closure is the one place other people's work
  enters your view without you asking. It is announced after the fact, with no
  undo — the edit that triggered it was written against a view those patches
  produce, so it already depends on them.

## Editing inside a region you are holding back

Allowed, and the held patches are loaded back in. An earlier design made such a
region **read-only** until it was staged again, for a real reason: an author
picks an array index against their own view, so re-staging patches afterwards
shifts the content under the path they just chose and their edit lands on the
wrong element — cleanly, every invariant intact, only the content wrong.

That guard is not what ships, and the trade is deliberate. The shape is rare in
practice (two people's edits mostly land in different routes), and refusing an
edit for a reason the author cannot see is a worse everyday experience than the
case it prevents. So the corruption case is **mitigated rather than prevented**:
the widened set is what the editor renders and what the compare view lists, so
the real result is on screen immediately rather than being argued about.

`editWouldRestage` in `utils/patchGroups.ts` is the guard that would have
enforced it. Nothing in production calls it; it survives as the executable
statement of the rule and is exercised by `patchGroupScenario`.

## Keeping the invariant

- **Writes** carry their closure (above), so a group cannot gain a hole from
  anything its owner does.
- **Coalescing** can still open one: `PatchSets.insertPath` merges an existing
  set into a broader one, so a third party's insert can swallow two leaf sets
  and leave a hole in a group whose owner touched nothing.
- **Nothing repairs that.** A group grows when its owner writes, and at no other
  time. The hole stays, and **publish refuses the group and names what is
  missing**; the review screen is where the owner resolves it, by staging the
  missing patch or unstaging what depends on it.

  Both automatic repairs were rejected, each for its own reason. `extend`
  restores the prefix by pulling the missing patches in — publishing work the
  owner deliberately excluded, without asking. `truncate` honours the exclusion
  by dropping their own edit instead, which leaves a _valid_ group, so no
  assertion fires and the only trace of the loss is their group quietly
  emptying. Both decide, silently, the one thing only that person can.

## Three things the client alone can compute

The content API has no schema, so it cannot derive patch sets — every closure is
the client's to send, and each one is a field the two sides have to agree on.
Getting any of them wrong is invisible from either repo alone.

- **`alsoAddPatchIds`** on `PUT /patches` — the prefix closure of a write.
- **`explicitPatchIds`** on stage — which of those the user actually clicked.
  Membership is stored as `explicit` or `dependency` and anything unnamed reads
  as a dependency, so omitting it files the patch someone chose as one the
  closure dragged in.
- **`alsoUnstagePatchIds`** on `DELETE /patches` — the forward closure of a
  discard. Deleting a patch out of the middle of a patch set leaves every group
  still holding the rest with a non-prefix intersection; those memberships are
  dropped without the patches being deleted. Computed against the whole chain,
  not against the discarder's own group: the question is what can no longer be a
  member of ANY group, and scoping it locally leaves everyone else holding the
  suffix.

## Publish

Commits the group's patches in chain order; the content API closes the group
(`publishedAt`) — but only when `POST /commit` NAMES it, and it closes what it is
named without checking that the commit shipped all of it. So the client sends
`patchGroupId` only when the publish accounts for every patch the group still
holds (`emptiesOwnPatchGroup`); a partial publish omits it and the group stays
open with the rest in it. Omitting it always is not neutral: the commit still
empties the group, but `published_at` is never set, so the id is reused across
publishes instead of a new group per publish and the "already published" refusal
can never fire. Patches stay in the chain marked `applied` until the new commit
comes back. The next write creates the next group, so the client forgets the id
on publish.

That leaves a window — before the first write on a branch, and after every
publish — where groups exist here and this author has none open. Two things
follow, and both were wrong before:

- **Staging stays on.** "Does this deployment have groups" is latched
  (`PatchStore.patchGroupsSeen`), separately from "do I have one". Asking the
  second in place of the first turned staging off after every publish and, worse,
  dropped the write resolver, so patches written before the next reload joined no
  group at all.
- **A stage in that window is held, not dropped.** `persistPatchGroupChange`
  queues it on the system and the shell flushes it when an id appears — on the
  system rather than on the review screen, because the id normally appears
  BECAUSE the user left that screen to type something.
- **The replay is reconciled, not verbatim.** The write that creates the group
  runs its own closure, which can re-stage the very patch a queued unstage names.
  At flush time an unstage whose ids are back in the scope is dropped, and so is
  a stage whose ids have left it: the scope is what this client intends the group
  to be, so where the two disagree the write beats the earlier click.

Two things go stale in opposite directions and must not be confused. The chain
**annotation** refreshes only inside a fetch for MISSING patch ids, so on a quiet
branch it is arbitrarily old; `ownPatchGroupId` comes from the last save response
and is cleared the moment a publish makes it wrong. So `ownPatchGroupId` wins
where it is set, and `markPublished` also closes the annotation's copy of any
group whose every patch it just shipped — nothing else ever will, because
`forgetPublished` drops those ids and the next `/stat` files them as stale. Named
the closed group instead and every stage is a silent 409 and the queue never
engages.

## Invariants worth attacking in review

1. Is the prefix invariant actually sufficient, or can two patches in _different_
   patch sets still interact? (Patch sets are defined as "can shift each other's
   paths"; the safety argument rests entirely on that definition being complete.)
2. The closure is computed client-side and trusted server-side. A buggy or old
   client can write an under-closed group. `closureVersion` is stored per
   membership row so such rows are identifiable and recomputable — but nothing
   currently recomputes them.
3. A coalesced hole is left for the user rather than repaired, so a group can
   sit un-publishable until they act. That is deliberate — see "keeping the
   invariant" — but it means a third party's insert can block your publish, and
   the refusal names raw patch ids rather than describing the change.
4. **A second tab's STAGE can be closed away by this tab's publish.**
   `emptiesOwnPatchGroup` decides from the local scope plus the chain
   annotation, and treats an absent annotation as "nothing else is in the
   group" — it has to, or a single-author branch never fetches one and the group
   never closes at all. A patch WRITTEN in another tab is a missing id here, so
   the fetch that pulls it in carries the annotation and the check sees it. A
   patch that other tab merely STAGED is already in this chain, so nothing
   fetches, and this tab can name a group that still holds it. Closed by the
   same thing that closes the rest of this list: the annotation refreshing on
   its own.

5. Scope is client-held local truth seeded from the server's annotation, and
   nothing reconciles it. `PatchStore` re-reads the annotation only inside a
   fetch it makes for MISSING patch ids, so on a quiet branch a failed stage is
   kept on screen until the page is reloaded, and a stage in one tab never
   reaches another. Closing both needs the annotation to refresh on its own. The
   deferred queue above narrows this but does not close it: a change held while
   there is no group is lost if the tab closes before one exists.
6. Held patches count as _settled_ but not _applied_ (`chainSettled`), because
   the editor holds every field inert until the chain settles. A held patch that
   counted as neither would dim the Studio permanently.
