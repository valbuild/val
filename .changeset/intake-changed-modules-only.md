---
"@valbuild/ui": patch
---

In local development, saving one `.val.ts` file no longer makes the Studio
validate and preview every module again. Each reload of the project's
modules used to count every module as changed; now only the modules whose
code actually changed are, and the ones that refer to them.
