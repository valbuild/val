---
"@valbuild/ui": patch
---

The assistant in code mode now hears about problems in its changes without stopping to ask. After each code change, the Studio typechecks and lints the proposal in the background. Whatever those checks find goes with the assistant's next tool answer, whichever tool that is, once for each version of the files.
