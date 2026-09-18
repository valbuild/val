---
"@valbuild/server": patch
---

A publish result can now say which commit it was built on, and what tree it points at

`CommitResult` gains two optional fields, `parent` and `tree`, filled in from
the content service's commit response when it reports them.

Both matter to a host that keeps its own record of what each commit changed —
a build cache, or an incremental publisher that rebuilds from the last thing it
built rather than from scratch. Such a host can only tell whether its record is
COMPLETE by chaining the commits it holds back to the one it last built. With
just a sha per commit the record is a set of snapshots with no way to notice a
gap, so a commit somebody else made in between is silently absent instead of
detected — and the host rebuilds from a source tree that is missing a change it
never knew about. `parent` is what closes that.

`tree` identifies the CONTENT of a commit rather than the commit itself, so two
commits carrying the same tree are the same source. A host that has already
built one of them can recognise the other and skip the work.

Both are optional, and absent means NOT REPORTED rather than absent-in-git: a
content service that predates these fields sends neither, and a caller must not
read a missing `parent` as "this is a root commit". They are plain strings
rather than branded shas for the same reason — they are passed through as what
a separately versioned service said, not as something this end has checked.

Nothing changes for a host that does not look at them. The publish route's own
response is unchanged.
