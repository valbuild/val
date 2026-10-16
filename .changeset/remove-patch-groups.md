---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/next": minor
"@valbuild/tanstack": minor
---

Patch groups are removed. **Publish** now publishes every pending change, and
the Review list shows everyone's pending changes in one list. To keep changes
out of a publish, move them to a proposal.

Draft reads no longer send `own_patch_groups_only`, `patch_id` or
`include_patch_groups`, and the server no longer has the patch-group routes or
fields. A content host that still sends them is fine: they are ignored.
