---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/mcp": patch
---

An edit Val Build refuses to save because of the project's plan — the Free plan's 1,000 changes a week are used, or a Hosted trial has ended — is now kept in the Studio instead of being reverted.

- `PUT /patches` answers such a save with a `403` of type `plan-refused`, carrying Val Build's reason and fix as data and which patches of the request it did save. It used to answer `400 patch-error`, which the Studio reads as a bad patch and drops.
- The Studio keeps the refused edits and any made after them, shows the plan notice with **Upgrade** or **Add a card** beside it, and saves them by itself once the plan allows it: as soon as Val Build says editing is open again (an owner added a card, the week moved on), and otherwise by trying again now and then. A publish or a restore that meets held edits says why, in Val Build's words, instead of suggesting the connection.
- The MCP write tools answer a refused write as `forbidden`, with Val Build's sentence, instead of `internal`.
