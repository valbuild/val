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
long-polled against watchers that could never fire, burning CPU for the whole
hold to learn nothing;
`/api/val/enable` 500'd; and every read of a `.val.ts` went through a shimmed
filesystem when the host could simply hand the source over.

`ValOpsMemory` takes the source as `sourceFiles`, refuses the local binary
members by name — this configuration uses Val's remote files — and answers the
history members with the same closed `not-supported-in-fs-mode` error `ValOpsFS`
gives, so the History UI degrades the way it already knows how rather than
inventing a commit list.

`getStat` still long-polls -- the hold is what paces the client, and an earlier
version that answered immediately turned a 20-second poll into a request every
6ms -- but it parks on a SIGNAL rather than a timer. This mode owns its store,
so it is told when something changes: no timers while parked, and a patch
written by another tab is seen at once rather than up to 250ms later.

Two seams come with it. `commitPrepared` lets a host take what a save produced
instead of a git commit, and `publishOverride` lets a publish be something other
than a push. Both are opt-in; an app that sets neither behaves exactly as before.

The in-memory patch store is explicitly **not durable**. It is behind
`ValPatchStore`, so a durable implementation is a swap rather than a rewrite,
but as shipped a restart loses unpublished patches.

**Memory mode authenticates.** `ValOps` gained `requiresAuth` alongside
`patchesAreLocal`, because one flag was answering two questions: whether a store
auto-saves or publishes (behaviour, reported as `mode` and keyed off by the UI),
and whether an unauthenticated request may write (security). With two
implementations the answers coincided — `fs` is a developer's own machine where
no credential exists, `http` is remote — so `getAuth` was written against
`patchesAreLocal` and returned anonymous _success_ for a missing cookie, an
invalid JWT, an unparseable payload, or no configured secret.

Memory mode splits them: its store is local, and it runs deployed. It therefore
requires a verified session, like `http` mode. A host that authorises requests
before Val sees them can opt out with `unsafelyAllowUnauthenticated`, which is
spelled that way on purpose and warns at startup. `fs` mode is unchanged.

Val's own MCP endpoint refuses memory mode outright. It has the same absence fs
mode has — no credential, no backend, every permission check on the far side of
one — and unlike fs mode it is meant to run deployed, so the existing
"development only" and loopback guards refuse nothing. A host in this mode owns
its own trust boundary and can offer the tools through it.

Internally, the routes' `instanceof ValOpsFS` checks meant "is this a local
store" — correct with two implementations and silently wrong with three. They are
now `ValOps.patchesAreLocal` at all 17 policy sites.
