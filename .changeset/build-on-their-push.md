---
"@valbuild/ui": patch
"@valbuild/server": patch
---

**Build on their push.** When a developer pushes to a proposal's git branch
(`val/p/<name>`), Commit and Publish no longer leave you stuck. Instead of
committing over a push it has not seen, the Studio says who pushed and when,
links to their commit, and offers **Build on their push**:

- Their changes come into the proposal. Where you both changed the same file,
  the proposal's version is kept, and the Studio lists those files. Anything
  a proposal cannot hold (for example a change outside the project) is listed
  too, since the next Commit leaves it as the site has it.
- Anything waiting to be saved is saved first, so "the proposal's version" is
  what you see.
- The proposal's preview is rebuilt with their code. Commit goes through
  right away, on top of their commit; Publish waits for the rebuild and says
  so.
- If they push again in the meantime, the notice moves to their newer commit.
  If GitHub cannot be reached, the session ran out, or the project's plan
  does not allow changes, it offers Try again, Sign in or Billing. When
  nothing can help from here (their push is too large to bring in, say), it
  says so and offers only their commit.

Publish refused the same way now shows the same notice inside the Publish
dialog, rather than a Try again that would fail again. When GitHub refuses
Publish's commit for good (a protected branch), the dialog links the branch
instead of offering Try again. On a phone, where Publish is finished in a new
tab, the commit message you typed now goes with it, and a refusal there
comes back to the dialog with the same offer.
