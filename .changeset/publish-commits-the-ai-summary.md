---
"@valbuild/ui": patch
---

Publish the AI summary that arrived while you were waiting for it

Pressing Publish while the AI was still writing the commit message starts a
short countdown, so the summary gets a chance to land before the commit goes
out. It landed — the box on screen filled with it — and then the commit said
"Update Home" anyway.

The text was read back out of the summary state by the publish button, from
that button's own render. The countdown fires a callback created when Publish
was pressed, and applying the summary and ending the wait happen in the same
flush, so the callback always ran with the text the box held _before_ the
summary arrived. No amount of waiting could have fixed it.

The popover now hands the text to publish along with the request, and works it
out from the values as they are at that moment. The rule is unchanged and is
still the one thing this flow guarantees: an AI summary takes over only a box
nobody has typed in, so anyone who wrote their own summary publishes exactly
what they wrote, whenever the AI happens to answer.
