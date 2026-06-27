---
"@valbuild/ui": patch
---

Fix content flicker on save where a field briefly reverted to its pre-edit value before settling on the saved value. In fs mode, `publish()` now bakes the optimistic (patched) value into the local sources as it drops the just-saved patches, so the displayed value stays stable until the next sources sync.
