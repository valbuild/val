---
"@valbuild/ui": patch
---

An upgrade proposal no longer lists packages as `6.0.3 → 6.0.3`. When an upgrade only raises a package's version range (pnpm moves `^6.0.2` up to `^6.0.3` when 6.0.3 is already installed), the list now reads `typescript range ^6.0.2 → ^6.0.3`. And the notice names Val's version only when Val's version moved, instead of "This proposal upgrades Val 0.150.0 → 0.150.0".
