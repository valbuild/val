---
"@valbuild/ui": patch
---

**The canvas turns preview mode on by itself.** When the page in the canvas
says preview mode is off, or does not answer, the Studio now turns preview
mode on for you, every five seconds for up to thirty seconds, instead of
asking you to press a button.

- For the first ten seconds you only see a small spinner above the page.
- After that, the pill says what is happening: "Loading the preview…" or
  "Turning on preview mode…".
- If the page still is not in preview mode after thirty seconds, you get the
  message you had before, with **Turn on preview mode** and **Details**.
  Pressing the button, or reloading, starts the thirty seconds over.

The canvas never reloads the page while it is still loading, or while you are
using it (for example signing in to your site inside the canvas).
