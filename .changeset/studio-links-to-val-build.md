---
"@valbuild/ui": patch
---

The Studio now links out to the project in Val Build.

Val edits content; everything else about a project — who can edit it, its API
keys, its versions, its subscription — lives at
[admin.val.build](https://admin.val.build), and there was no way to get from
one to the other. You had to know the URL, or find the project again from the
front page.

Two ways there now:

- **The project name in the top bar is a link.** It opens the project's own
  page in Val Build, in a new tab, since leaving the Studio would mean leaving
  whatever is being edited in it.
- **Settings has a Project section**, with **Administer project** — the same
  page — and **Manage members**, which opens the organisation's member list.

Both hang off `project` in `val.config`, which is `"<org>/<project>"`. A
project that has not been connected to Val Build — no `project`, or one that is
not in that form — has no page to open, so the name stays a plain label and the
Settings section is not shown at all, rather than offering a link that lands on
a sign-in for an organisation you may not be in.
