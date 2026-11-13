---
"@valbuild/ui": patch
---

The Studio's assistant changes code more carefully and reads less to do it:

- **Small code changes stay small.** A new `edit_file` tool replaces one exact piece of a file instead of rewriting the whole file, so a one-line change no longer risks a truncated or accidentally rewritten file. It asks before running after a web search, like every tool that changes code.
- **Long files are read in parts.** `read_file` takes `offset` and `limit` (in lines) and says where the part is in the file; a file too long for one answer says where to read on.
- **In code mode, the assistant talks to you as someone working on the code.** It names files, components and schemas by their real names instead of avoiding technical words. Outside code mode, nothing changes for content editors.
- **Your project's instructions are followed.** In code mode the assistant reads `AGENTS.md`, `CLAUDE.md` and `.claude/CLAUDE.md` at the root of your repository, when they are there, and follows them when it changes your code.
- **Large content no longer overwhelms the assistant.** Answers from reading schemas, content, search results, validation errors and pending changes are capped; when something is left out the assistant is told what and how to ask for it. `get_all_schema` can ask for named modules, and `get_source` for one path in a module.
