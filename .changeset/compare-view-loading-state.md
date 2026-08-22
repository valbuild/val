---
"@valbuild/ui": patch
---

Show a loading state while the compare view loads.

Opening the compare view flashed "No pending changes" before the changes appeared — twice, in fact: `usePatchSets` reported success over the empty patch sets the sync engine had not read yet, and `usePatchSetsWorker` started with `isComputing` false and empty trees, so the first render happened before any computation had been posted to the worker.

`usePatchSets` now reports `not-asked` until the sync engine is initialized, which is what its previously unreachable `not-asked` branch was for. `usePatchSetsWorker` starts as computing, since a computation is always posted from an effect on mount, and reports `hasComputed` so an empty `trees` before the first result can be told apart from "nothing changed". Both stages render the same skeleton placeholder, so there is one continuous placeholder rather than a sequence of differently shaped messages, and the header summary stays hidden until the changes are counted instead of showing "0 changes to review" first.
