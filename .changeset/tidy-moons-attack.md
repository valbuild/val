---
"@valbuild/ui": patch
---

Stop invalidating every module while editing a field. A patch-id change no longer forces a full re-sync (the studio reads sources un-patched and folds patches in client-side, so patch ids cannot change them), and a full sync now only invalidates modules whose source actually changed.
