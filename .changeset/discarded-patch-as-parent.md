---
"@valbuild/ui": patch
---

Stop losing the edit you make after discarding changes

In proxy mode, discarding a set of changes and then editing again failed with
"An edit could not be saved and has been reverted." and `Parent patch not
found`, and it kept failing for every edit after that until the tab was
reloaded. The edits were gone, not merely unsaved.

Every write names its parent, because the chain is linear. The sync computes
that parent from what the content service has said exists — and a discard
deleted the patches without telling it, so the next write named one of the
deleted ids. A service refuses a parent it does not hold differently from one
that is merely out of date: out of date is a conflict, which is re-synced and
retried, while a parent that is gone is a permanent refusal, and a permanent
refusal is answered by dropping the patch and putting the field back. Hence a
lost edit rather than a slow one.

It could not recover on its own, either. The sync releases an id it is holding
only when a fresh `/stat` lists it, which is right — a snapshot taken before our
own write must not walk the parent backwards — but a deleted patch is never
listed again, so nothing could clear it.

A patch leaving the chain now reaches the sync, whether it left through a
discard here, a discard in another tab, or a refusal by the server.
