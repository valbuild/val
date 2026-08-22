---
"@valbuild/core": patch
"@valbuild/server": patch
---

Fix `render({ as: "list", select })` not being applied in Studio

Two regressions made list renders disappear:

- `/sources/~` skipped render generation when the client asked for un-patched sources (`apply_patches=false`, which is what Studio always does). Renders can only be computed on the server - the `select` functions are not part of the serialized schema - so they are now always computed, on the patched sources.
- `array` and `record` dropped the render input when `render()` was followed by `nullable()`, `readonly()`, `hidden()`, `describe()`, `validate()`, `router()` or `remote()`. Render input is now carried along like every other schema option, and `render()` no longer mutates the schema it is called on.
