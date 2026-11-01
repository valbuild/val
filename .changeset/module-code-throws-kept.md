---
"@valbuild/ui": patch
---

When a module's code throws while you are editing it, the Studio now keeps
showing that module as it was before, and tells you which module it is, with
the error under Details. It used to drop the module without a word. The message
goes away once the code loads again.
