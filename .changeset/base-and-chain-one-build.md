---
"@valbuild/core": patch
"@valbuild/ui": patch
---

After a publish, the Studio no longer loses edits or applies a list reorder twice while the new build is rolling out.

The Studio shows the content built into the page it loaded, with the unpublished changes on top. Which changes those are comes from the server, and the server lists them relative to its own build. For a while after a publish the two can be different builds: a tab opened before the publish keeps its page, and a managed project's new build reaches each location up to a minute apart. The Studio then applied one build's list of changes to another build's content. Published edits went missing, or were applied a second time, which is invisible for a text replacement but reorders a list again, or removes the wrong item.

The server already says which build answered (`sourcesSha`), and the Studio now computes the same fingerprint for the content it holds. When the two differ, it fetches the answering build's content and puts it in place together with that build's list of changes, in one step, so nothing on screen shows a half-updated state. Going back to its own build needs no fetch. When they match, which is almost always, nothing extra is requested.
