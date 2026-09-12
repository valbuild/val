---
"@valbuild/ui": patch
---

"All changes saved", not "All changes saved locally"

The status bar's resting state claimed changes were saved _locally_, at every
breakpoint and in both modes. Against a project that is wrong: the patch is on
the content service, which is where it has to be for a colleague to see it and
for Publish to ship it. "Locally" reads as "still only on this machine" — the
one thing an editor would want to know, said backwards.

It is not worth saying in local dev either, where the bar already shows "Dev
mode" and the branch a couple of items to the left.
