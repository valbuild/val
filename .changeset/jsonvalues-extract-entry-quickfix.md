---
"@valbuild/server": patch
"@valbuild/language-server": patch
---

Add the editor quick fix for a `.jsonValues()` entry written inline: **Val: move entry into its own .val.json**.

The language server already reported the problem — "Entry '…' is written inline … Run 'val validate --fix' to move it" — but offered no way to act on it, so the only remedy was to leave the editor and run the CLI. It now offers a quick fix that creates the `*.val.json` with the entry's content and rewrites the `.val.ts` to `c.json(() => import("./…"))`, in one undoable step.

The fix is computed from the same code `val validate --fix` runs, so the two write the same files, and it is computed against the buffer you are looking at rather than what is on disk — an unsaved module can be fixed without saving first. It refuses, rather than overwriting, when a file or an unsaved buffer already occupies the target path.

Requires an editor that honours file creation inside a workspace edit; VS Code does. In an editor that does not announce it, no action is offered rather than one that would rewrite the module to import a file that never got created.
