---
"@valbuild/ui": patch
---

Fix two flickers on save:

- Field content briefly reverted to its pre-edit value before settling on the saved value. In fs mode, `publish()` now bakes the optimistic (patched) value into the local sources as it drops the just-saved patches, so the displayed value stays stable until the next sources sync.
- The Save button briefly flicked back to enabled right after saving. `publish()` now invalidates the server-side patch-id snapshot when it empties it, so the button transitions enabled → disabled cleanly instead of reading a stale value until the next sync.
