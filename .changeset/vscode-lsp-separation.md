---
"@valbuild/server": patch
"@valbuild/cli": patch
"@valbuild/language-server": patch
---

Move the `val validate --fix` handler layer into `@valbuild/server`, so the
language server runs the same fixes as the CLI instead of an editor
reimplementing them.

The language server now:

- adjudicates the gallery checks core emits unconditionally, rather than
  publishing them as-is. A gallery module with nothing wrong showed two
  permanent warnings; one that does have a problem now reports it on the entry
  it is about, with the message `val validate` gives.
- offers a quick fix for a module missing from `val.modules`, advertised as
  `fix/missing-module`.
- serves `val.login`, `val.uploadRemote` and `val.downloadRemote` over
  `workspace/executeCommand`, so remote upload/download and login work in any LSP
  client rather than only in the VS Code extension.
- reacts to `workspace/didChangeWatchedFiles`, and registers the watchers itself
  when the client allows it. A `.val.ts` changed by git, or a file dropped into
  `/public`, previously went unnoticed until something was retyped.
