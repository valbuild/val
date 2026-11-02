---
"@valbuild/ui": patch
"@valbuild/react": patch
---

Typing in the Studio no longer slows down with the size of the module.

- **A keystroke in a large module is about five times faster.** The Studio
  used to copy the whole module for every change it applied; it now applies
  changes the way Val's server does, copying only what the change touches.
  In a module of 5 MB a keystroke went from about 100 ms to about 20 ms, and
  a module of 1 MB from about 17 ms to about 3 ms.
- **The Studio and the server show a change the same way.** Where an uploaded
  file's draft address goes, what an edit inside a `.jsonValues()` entry
  does, and what a new entry is, are decided by the same code in both, so
  the editor's fields, the page behind the Studio and a draft page's server
  render cannot disagree about them.
- **A draft entry that was discarded before the page's editor connected no
  longer stays on the page.** A page rendered from the draft of an edit
  inside a `.jsonValues()` entry kept showing that edit after it was
  discarded in another tab, until the page was reloaded.
