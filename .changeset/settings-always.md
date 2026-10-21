---
"@valbuild/ui": patch
---

**Settings is always in the Studio's rail.** The cog used to show only in projects with an `s.settings()` module, so a hosted project made from a template had no way to reach Settings → Updates, and with it no way to upgrade. It now shows in every project. Without a settings module, the panel says how to add one, except where it holds Updates.
