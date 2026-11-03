---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

Code mode now works in a hosted Studio. In a proposal, the `</>` beside the
proposal's name turns code mode on for everyone in it, and the assistant can
then change the proposal's code. On the site, the `</>` lists the open
proposals and opens the one you choose with code mode on.

- **Nothing you typed is lost when code changes.** Turning code mode on saves
  every pending change first, and so does each of the assistant's code
  changes, so a field the assistant adds can be filled in and stays filled
  in. Turning code mode off discards nothing.
- **Each person chooses what they see.** While code mode is on you can stay
  in the content editor, or see the proposal's preview and its code changes.
  The proposal's menu says who turned code mode on, and when.
- **The assistant asks.** With code mode off, its code tools refuse and say
  who turned it off; it asks for code mode with a button in the chat instead.
- **Save is the one main button** in a proposal, and also updates the
  preview when the code changed. Its menu holds **Commit**, in a project
  connected to git, which puts the proposal on its git branch as one commit,
  and **Publish**, which commits and then merges into the site. Both use the
  project's commit message setting. In code mode, Save saves even when
  content has validation errors; Publish is still refused until they are
  fixed. If someone else pushed to the proposal's branch, Commit says who and
  when, and links to their commit, instead of committing over it.
- The "schema changed, reload" dialog is not shown in code mode, where the
  schema changes with every build.
