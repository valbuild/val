# Prompt for the home repo (content.val.build)

Paste this into a session on the repo that serves `content.val.build`. It is written
to be self-contained: it does not assume the reader has seen the `val` repo.

Companion document with the full reasoning, invariants and test plan:
`docs/independent-publish/PLAN.md` in `valbuild/val`.

---

## Context you need

`content.val.build` stores **patches** for Val projects. A patch is a JSON-patch-ish
document scoped to one content module file (e.g. `/content/page.val.ts`). Patches form
a **linear chain per project+branch** via `parentPatchId`, and
`GET /v1/{project}/applicable/patches` returns, in chain order, the patches that apply
on top of the current commit. The Val server package then applies them in that order
to produce the content the CMS shows, and `POST /v1/{project}/commit` writes a subset
of them to git.

Today publishing is all-or-nothing: the CMS sends every pending patch id. Two people
editing the same project therefore cannot ship independently — whoever publishes
first publishes the other's unfinished work too.

## What we are building

A **patch group**: a uuid-identified, per-user set of patch ids. Publishing publishes
one group, not everything pending.

- Every user has one "current" patch group per project+branch. It is created lazily.
- **A group holds every pending patch by default, not just its owner's.** A new patch is
  added to the creating author's group _and_ to every other open group on the same
  branch, in the same transaction as the patch itself. The one exception is a group that
  is deliberately holding that patch's region back (see below), which stays untouched.
- So a patch is in **many** groups at once. That is the normal case, not an edge case.
- The default is therefore identical to today's all-or-nothing publish. Independence
  comes from a user explicitly **unstaging**, which removes patches from _their_ group
  only.
- A patch a group does not hold is **unstaged for that user**: it still exists, still
  occupies its place in the chain, is still returned by `applicable/patches`, but is not
  applied to that user's view and is not published by that user.

Why the default is everything, since it is the one design decision here that looks
arbitrary and is not: patch group membership is closed when a patch is _created_, which
is after its author has already picked a path. If an author's group did not already hold
a pending array insert, they would pick an index against a view without it, membership
would then close over it, every index would shift by one, and their edit would land on
the wrong element — cleanly, with no error. There is an executable counterexample in
`packages/ui/spa/utils/patchGroups.test.ts` in `valbuild/val`.

The eventual goal: two people collaborate on one project and each publishes their own
small change (a title, say) without merging or waiting for the other.

### Staged is the truth

The staged set is not just a publish filter. `base + the user's group` is what the CMS
shows that user, what the site preview shows them, and what publish writes. There is no
"real" state behind it that they can also see.

### Patches outlive commits — keep it that way

Publishing one group must not disturb anyone else's pending work. Alice publishes, and
Bob carries on with patches that were already there; his patches keep applying on top of
the new commit. That is how this repo already behaves — `applicable/patches` answers
relative to a given commit, and committed patches are marked `applied` rather than
deleted — and this feature does not change it.

There is therefore **no base-commit validity condition on a group** and nothing for you
to check before committing. A group is a set of ids applicable on top of whatever commit
is current.

What guarantees that: a group holds everything pending by default, so an author's view
already contained every other pending patch when they picked their path. Committing some
of those patches into the base does not move anything, because they were already applied
in the view the path was chosen against. The only way a group ends up _not_ holding a
pending patch is that its owner unstaged it — and then that region is read-only for them,
so they cannot have picked a path inside it. Either way there is nothing to rebase.

Do not add a stale-base check, and do not try to rebase or repair a group.

## Critical constraint: do NOT filter `applicable/patches`

`applicable/patches` must keep returning the **full chain**, unfiltered, exactly as it
does today. Add annotations; never remove patches.

Reason: the CMS client computes the parent for a new patch as the last patch id in
that response. If the response were filtered to one group, every client would compute
a parent that is not the real chain head and `POST /v1/{project}/patches` would answer
409 forever. Filtering happens on the client and at commit time, both of which are
already patch-id-driven.

Old clients are safe with added fields: the client parses this response with a
non-strict zod object, which strips unknown keys.

## The closure — computed by the client, not by you

Patches are grouped into **patch sets** — sets of patches that are mutually dependent
and must be published together (e.g. every patch touching the same array, because
array ops shift indices). Computing patch sets requires the project's content
**schema**, which `content.val.build` does not have. So the client computes it and
tells you.

Concretely: when the client creates a patch it also sends the list of _other_ patch
ids that must join the same group. Your job is a transactional set-union. Do not try
to derive the closure yourself, and do not reject a closure you cannot verify.

The rule the client implements, for your understanding only: for every patch group `G`
and every patch set `PS`, `G ∩ PS` must be a **prefix** of `PS` in chain order.
Staging a patch pulls in the patches that preceded it in its patch set; patches added
to that patch set _afterwards_ by other users are not pulled in.

Store a `closure_version` integer alongside each membership row so a bad client
rollout is identifiable and recomputable later.

## Schema

```sql
create table patch_group (
  id                uuid primary key,
  project           text        not null,
  branch            text        not null,
  author_id         text        not null,
  created_at        timestamptz not null default now(),
  published_at      timestamptz,
  published_commit  text
);
-- at most one open group per user per branch, for now
create unique index patch_group_one_open
  on patch_group (project, branch, author_id)
  where published_at is null;

create table patch_group_patch (
  patch_group_id  uuid        not null references patch_group(id) on delete cascade,
  patch_id        uuid        not null references patch(id)       on delete cascade,
  added_at        timestamptz not null default now(),
  added_reason    text        not null check (added_reason in ('explicit','dependency')),
  closure_version int         not null,
  primary key (patch_group_id, patch_id)
);
create index on patch_group_patch (patch_id);
```

`added_reason` drives a UI note ("added because your change depends on it"), so keep it
accurate: `explicit` for the patch the user actually created or staged, `dependency`
for everything pulled in by the closure.

## API changes

### 1. `POST /v1/{project}/patches` — create a patch (changed)

Add to the request body:

```
patchGroupId:        string | null  // null = "my current group, create it if absent"
alsoAddPatchIds:     string[]       // the closure; may be empty
holdBackForGroupIds: string[]       // other groups that must NOT receive this patch
closureVersion:      number
```

Add to the response body:

```
patchGroupId: string               // the group actually used
```

All of this in **one transaction**: insert the patch, resolve-or-create the caller's
group, insert membership for the new patch (`added_reason='explicit'`) and for every id
in `alsoAddPatchIds` (`added_reason='dependency'`, upsert / do-nothing on conflict so
retries are safe). If any `alsoAddPatchIds` entry is not a real patch on this
project+branch, fail the whole request — that is a client bug and silently dropping it
would corrupt the group.

**Then add the new patch to every other open group on this branch too**, per "a group
holds every pending patch by default" above — except a group that is already holding
that patch's region back. You cannot compute "its region" without the schema, so the
client tells you: it sends `holdBackForGroupIds: string[]`, the groups that must _not_
receive this patch. Skip exactly those and add the patch to the rest.

`patchGroupId` non-null and not owned by the caller ⇒ 403.

### 2. `GET /v1/{project}/applicable/patches` — annotate (additive only)

Per patch, add:

```
patchGroupIds: string[]            // usually every open group; empty if all hold it back
```

Top level, add:

```
patchGroups: [
  {
    id: string,
    authorId: string,
    createdAt: string,
    publishedAt: string | null
  }
]
```

Everything else — `patches[].path/patch/patchId/authorId/baseSha/createdAt/applied`,
`commits`, `deployments` — stays byte-identical. Do not reorder, do not filter, do not
change the existing chunking behaviour.

### 3. `POST /v1/{project}/patch-groups/{groupId}/patches` — stage (new)

Body `{ patchIds: string[], closureVersion: number }`. The client has already closed
the set; upsert all of them with `added_reason='dependency'` except any the client
marks explicit (accept an optional `explicitPatchIds: string[]`). Idempotent. 403 if
the group is not the caller's, 409 if it is already published.

### 4. `DELETE /v1/{project}/patch-groups/{groupId}/patches` — unstage (new)

Body `{ patchIds: string[] }`. The client has already computed the forward closure
(unstaging a patch also unstages everything after it within its patch set). Delete the
membership rows. Idempotent — deleting a row that is not there is a 200, not a 404.
403 / 409 as above.

### 5. `GET /v1/{project}/patch-groups` — list (new, optional)

`{ groups: [{ id, authorId, createdAt, publishedAt, patchIds: string[] }] }`. Used only
for a lightweight "someone else has unstaged work" indicator, so it is not on the
critical path. Note that a client reading this _instead of_ the annotations in (2) can
see a group referencing a patch its patch list does not have yet; the annotations exist
precisely to avoid that race.

### 6. `POST /v1/{project}/commit` — publish (changed behaviour, same signature)

It already commits a subset of patch ids, so the signature does not change. Accept the
group id as an optional body field so the bookkeeping below is unambiguous.

There is **no new pre-condition** on commit — see "Patches outlive commits" above. In
the same transaction as the commit:

- set `published_at` / `published_commit` on the group being published;
- **mark the committed patches applied**, so `applied.commitSha` is set for exactly
  those patches in subsequent `applicable/patches` responses — and for no others. The
  Val server relies on this to skip already-applied patches when it rebuilds the
  content; if it is wrong in either direction, patches are applied twice or dropped;
- **remove the just-published patch ids from every other group** that contains them.
  They are applied now; leaving them would make another user's next publish try to
  re-apply an applied patch.

Groups that survive the commit are left exactly as they are. Their remaining patches
still apply, and their authors carry on working — that is the whole point.

### 7. `DELETE /v1/{project}/patches` — delete (changed behaviour)

`on delete cascade` handles the membership rows. But deleting a patch that sits in the
middle of a patch set leaves the _other_ groups containing it with a non-prefix
intersection. The client is responsible for sending the forward closure alongside the
delete; make sure the endpoint accepts and applies that, rather than assuming a bare
cascade is sufficient.

## Rollout — must be shippable in this order

1. **This change set, with nothing reading it.** Tables, annotations, write endpoints.
   Every newly created patch auto-joins its author's current group. Backfill existing
   pending patches into a group per author. After this step every pending patch is in
   exactly one group, so a group and "everything pending" are the same thing and no
   client behaviour changes.
2. The Val client starts _sending_ group ids to commit while still applying every
   patch. Identical behaviour, because of step 1.
3. The client allows a group to become a strict subset. Only now does anything change
   for users.

Step 1 must therefore be correct **and** behaviour-neutral. Do not add filtering
anywhere in step 1.

## Tests to write on your side

- Backfill: every pre-existing pending patch ends up in exactly one group; running the
  backfill twice is a no-op.
- Create-patch is atomic: an invalid id in `alsoAddPatchIds` rolls back the patch too.
- Stage and unstage are idempotent under retries and concurrent identical calls.
- `applicable/patches` byte-compat: existing fields unchanged for a project with no
  groups and for one with groups; the chunked-request path still returns the same
  patch set.
- Commit removes published ids from _all_ groups, not just the published one.
- Commit sets `applied.commitSha` on exactly the committed patches, and the next
  `applicable/patches` reflects that — neither more nor fewer.
- After committing one group, the other groups are untouched and their remaining
  patches still come back from `applicable/patches` for the new commit.
- A patch shared by two groups survives deletion from one.
- Unique index actually prevents a second open group per user per branch.
- 403 on another user's group; 409 on a published group.

## What NOT to do

- Do not filter `applicable/patches` (see above).
- Do not compute the closure server-side. You do not have the schema, and a coarse
  approximation ("same module file ⇒ same group") is correct but so broad it defeats
  the whole feature.
- Do not make membership one-to-one. A patch legitimately belongs to several groups.
- Do not delete a patch when it is unstaged. Unstaged patches must remain, and must
  remain re-stageable.
- Do not add a base-commit pre-condition, and do not rebase or repair a group after a
  commit. Patches outlive commits; the closure is what keeps them valid.
