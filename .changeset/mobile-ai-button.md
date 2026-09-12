---
"@valbuild/ui": patch
---

Move the assistant button to the bottom bar on mobile

On a phone the Sparkles button sat in the top right of the top bar, sharing
that corner with the navigation menu, History, notifications and the account
avatar — the furthest point on the screen from a thumb, and the row you reach
for least.

It is now in the sticky bottom bar, beside Quick actions, where Preview and
Publish already are. The top bar drops its own button below the mobile
breakpoint, so there is still exactly one way in rather than two places to look
for the same panel. Nothing changes on tablet or desktop, and a project with no
assistant configured shows no button in either place.
