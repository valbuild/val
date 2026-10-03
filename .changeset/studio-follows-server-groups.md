---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

Every open Studio now shows the same changes, staged the same way, as a reload would.

- Staging or unstaging a change in one browser or tab now shows up in your other open Studios right away, without a reload, and publishing from any of them ships the same set.
- A change you stage before you have made any edit of your own is saved straight away, instead of being kept in the tab until your first edit and lost if you reloaded first.
- If staging a change fails, the Studio now goes back to showing what is actually saved, instead of keeping the failed change on screen until a reload.

This needs the Val Build content service released alongside this version.
