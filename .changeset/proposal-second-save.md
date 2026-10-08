---
"@valbuild/ui": patch
---

Saving twice in a row in a proposal now works.

After a Save in a proposal, the Studio went back to showing the content from before that save, although the proposal had it. The next edit was then made on top of content the proposal had already moved past, and its save failed. Two changes fix it:

- A change this tab saved is no longer mistaken for one that was thrown away when it leaves the server's list of pending changes. It stays on screen.
- After a Save in a proposal, the Studio reads the proposal's new content straight away, instead of on its next periodic check, which could be twenty minutes away.
