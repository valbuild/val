---
"@valbuild/ui": patch
---

The assistant makes a code change in fewer steps.

In code mode, the assistant now starts with a map of your project: which file serves each route, which Val modules there are and which components use each one, and the files by folder. It no longer has to list and search the project before it can open the file a change is in.

- It reads the files a change needs together, and makes all of the change's edits together, instead of one at a time.
- A change to a component or a style no longer starts by reading every schema, and is no longer followed by a content check it did not need.
- When you point at something in the preview, the assistant is told which file renders it.

Nothing changes for content editing outside code mode.
