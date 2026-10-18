---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Opening a proposal no longer sends you through Val Build's sign-in again. The
Studio you are signed in to hands your session over to the proposal's address,
so you go straight to the same page there instead of past an "Authorizing"
screen and a "Signed in" page. If the handover cannot be made, the proposal
opens with the sign-in it used before.
