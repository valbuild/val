---
"@valbuild/ui": minor
---

Find your history from the Studio, instead of building a URL by hand

The two-pane history view shipped with no way in. Everything behind it worked —
the commit archives, the reconstruction, the compare, the restore — but the
only way to reach it was to read a commit sha out of the database and assemble
a query string yourself. A feature nobody can find is not shipped.

There is now a **History** button in the top bar, next to Publish. It lists what
has been published on this branch, newest first, with the message, who published
it, when, and how many changes it carried. Click one and it opens beside the
Studio; **Stop comparing** closes it again.

- Commits made before Val recorded history — and ones pushed straight to the
  repo — are listed, but greyed out and not clickable, with a note saying why.
  Hiding them would make your history look shorter than it is.
- **Load more** pages back through older commits.
- The button does not appear in local development, where there is no published
  history to list.
