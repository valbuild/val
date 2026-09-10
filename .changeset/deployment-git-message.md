---
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/ui": patch
---

Show the git message on deployments Val did not publish

The deploy feed could only name a publish when Val itself had made the commit:
the message came off Val's own `ValCommit`, and every other deployment — a
developer's push, a merged pull request, a revert — showed a seven-character
sha. On most projects those are the majority, so "what went out at 14:02?" had
no answer in the Studio.

A deployment can now carry its own `commitMessage`, which the Studio uses
wherever there is no Val commit to prefer. It is optional and nullable, so a
content service that does not report messages is unaffected — those publishes
keep showing the short sha, exactly as before.

Deployment rows also show only the subject line of a message now. A git message
is a subject, a blank line and a body, and the rows are one truncated line — so
a real push arrived as "Subject The body went on like this…". The classic
Draft changes view still has the whole message in its tooltip.
