---
"@valbuild/ui": patch
---

Fix the page going unclickable behind a stale selection box in the overlay's select mode.

In select mode the overlay draws a box over whatever Val content the pointer is on, and that box is what turns a click into "edit this" — it sits above the page and stops the event. The box was only ever written when the pointer found tagged content, never cleared when it left, so it stayed parked over the last thing the pointer crossed. Everything under that rectangle stopped responding for as long as select mode was on: most visibly, a link there could not be followed.
