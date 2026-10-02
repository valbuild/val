---
"@valbuild/ui": patch
---

Pressing Save (or Publish) right after typing now saves what you typed. With changes already pending, pressing the button the moment you finished typing did nothing and showed nothing: the press is what writes your last edit, and the button switched itself off while that write was on its way, so the click was dropped. The button now stays pressable, and the save waits for the last edit before it runs. The button also no longer remounts whenever it switches between enabled and disabled.
