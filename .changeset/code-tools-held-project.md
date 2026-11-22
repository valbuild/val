---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

The assistant's code tools answer faster in a proposal.

- **Reading costs no request after the first.** The Studio keeps the proposal's project in the tab for the life of the chat, instead of fetching the site's source and the proposal's files again for every `read_file`, `search_code`, `list_files`, `edit_file`, `format_files` and `lint`. It is read again when someone changes the proposal, when the site is published, and after the assistant's own changes.
- **A change is one or two requests instead of four.** `edit_file`, `write_files`, `format_files` and `lint` with `fix` no longer ask whether code mode is on before each write: Val's server already refuses a write while it is off, and the assistant is still told who turned it off. Before a file is edited, the Studio asks what the proposal stages now, so a change someone else made to it is edited rather than overwritten.
- **A change does not wait for the schema to be re-read unless it can change it.** Only a write to a `.val.ts`, `val.modules.ts`, `val.config.ts` or a file they import waits for the Studio to evaluate the Val modules. A component, a stylesheet or a route is answered at once, and several edits in one reply are evaluated together rather than one after another.
