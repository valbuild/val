---
"@valbuild/ui": patch
---

Studio: stop a keystroke costing work proportional to the whole project, and fix two subscription bugs found along the way.

- Every leaf field called `useAllSources()` + `useSchemas()` during render, for data only a click handler ever read. That snapshot walks every module and deep-clones each one, and it is invalidated on every keystroke, so one keystroke re-cloned the project and re-rendered every mounted field. Fields now read the navigation path on demand.
- `subscribe()`'s unsubscribe spliced by an index captured at subscribe time, so removing an earlier listener detached a bystander instead — leaking the listener that should have gone and silencing one that should have stayed. The multi-path branch indexed the path array with a listener index, correct only for one path holding one listener. Listeners are now held per `(type, path)` and removed by identity.
- `getSourceSnapshot` keyed its cache by `(module, creatorId)`, so every mounted field got its own deep clone of the module on every keystroke. Cached per module now; the `optimistic` flag that `creatorId` was there for is computed separately.
- `subscribe()` returned a fresh closure on every call and nearly every call site calls it inline in render, so every render tore down and re-added every subscription in the tree. It is memoised per `(type, paths)`.
