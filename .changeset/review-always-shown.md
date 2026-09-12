---
"@valbuild/ui": patch
---

Review stays in the top bar with nothing pending, and says so

Above the mobile breakpoint — a phone reaches Review through Quick actions, and
still does — the Review button was hidden whenever nothing was pending: present
in the layout so the bar would not reflow, but unreachable and invisible to
screen readers. That made "is anything of mine still unpublished?" unanswerable from
the top bar: a hidden button and a button whose data has not loaded yet look
exactly the same, so the only way to find out was to publish and see what
happened. The Quick actions row on a phone already answered it; the bar now
does too.

Opening it with nothing pending gives a real screen instead of the single grey
"No pending changes." line: it says the editor and the published site agree, and
what the view will show once they do not. The wording follows the mode, so a
local dev project is told about its working tree rather than about publishing.

The change count is still a badge that only appears when there is one, so an
empty Review reads as "nothing pending" rather than as "0 changes".
