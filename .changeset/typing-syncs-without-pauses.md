---
"@valbuild/ui": patch
---

Typing without pausing now updates the preview, instead of everything sitting still until you stop

Writing a sentence straight through left the rest of the Studio frozen. The page
in the canvas, the list row naming what you were editing and the heading above
it all kept showing the value from before you started, and then jumped to the
new one once you stopped typing.

It looked like the editor had lost its connection to the page, and the longer
the sentence the worse it looked — a paragraph typed in one go updated nothing
until the last word.

The cause was that a field waits for a pause before writing, and fluent typing
has no pauses in it. The gap between keystrokes at a normal writing speed is
shorter than the wait, so every character pushed the write further away and it
never happened at all.

Writes are now capped: whatever you have typed goes out at least every two
seconds, whether or not you have stopped. Typing that does have pauses in it is
unchanged — still one write per pause, so nothing about the editing you were
already doing gets noisier.

This affects text, code and rich text fields.
