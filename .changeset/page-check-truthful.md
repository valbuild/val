---
"@valbuild/ui": patch
---

Code mode's checks are easier to live with:

- The checks above the assistant's composer take a line, not the screen: when they still find problems, the bar says so in one line with Fix it, and what they found is folded under "What they found" (the assistant says it in the chat too). The checks can be hidden, passing or failing, and come back when they find something new. On a phone, what they found used to fill the screen with no way to put it away.
- The page check no longer reports a change as missing when the page in the preview cannot show it yet. It used to wait 20 seconds for the change's quick preview and then read the page anyway, which was still the last build, and it read it also when the quick preview could not be made. Now it waits as long as a quick preview takes, and when the change is not on the page it says the page was not checked, and why, instead of sending the assistant back to fix what it already fixed.
