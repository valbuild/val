---
"@valbuild/server": minor
"@valbuild/tanstack": minor
"@valbuild/mcp": minor
---

A third ValOps mode, for a host that already holds its own source

EXPERIMENTAL. `fs` mode assumes a working tree it can watch and write; `http`
mode assumes Val's content service owns the patch chain and that a commit is a
git commit. A host that builds and publishes its own output is neither: it holds
the source already, it has nowhere to watch, and its "commit" is a new build.

Forcing such a host into `fs` mode cost three things, all now fixed: `/stat`
long-polled for watchers that could never fire (20s per poll, now 28ms);
`/api/val/enable` 500'd; and every read of a `.val.ts` went through a shimmed
filesystem when the host could simply hand the source over.

`ValOpsMemory` takes the source as `sourceFiles`, refuses the local binary
members by name — this configuration uses Val's remote files — and answers the
history members with the same closed `not-supported-in-fs-mode` error `ValOpsFS`
gives, so the History UI degrades the way it already knows how rather than
inventing a commit list. `getStat` answers immediately, because nothing can edit
files behind Val's back here.

Two seams come with it. `commitPrepared` lets a host take what a save produced
instead of a git commit, and `publishOverride` lets a publish be something other
than a push. Both are opt-in; an app that sets neither behaves exactly as before.

The in-memory patch store is explicitly **not durable**. It is behind
`ValPatchStore`, so a durable implementation is a swap rather than a rewrite,
but as shipped a restart loses unpublished patches.

Val's own MCP endpoint refuses memory mode outright. It has the same absence fs
mode has — no credential, no backend, every permission check on the far side of
one — and unlike fs mode it is meant to run deployed, so the existing
"development only" and loopback guards refuse nothing. A host in this mode owns
its own trust boundary and can offer the tools through it.

Internally, the routes' `instanceof ValOpsFS` checks meant "is this a local
store" — correct with two implementations and silently wrong with three. They are
now `ValOps.patchesAreLocal` at all 17 policy sites.
