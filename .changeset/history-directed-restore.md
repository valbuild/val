---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

See how a module looked at any past commit, and restore from it by pointing at it

Val could publish edits but never look back. Now every commit is a durable
record you can open, and any part of it can be put back.

**Open a commit and the Studio splits in two.** The left half is the Studio
itself — same navigation, same fields, same everything, because it _is_ the
editor rather than a copy of it. The right half shows the project as that commit
left it. On a phone the two become one pane and a toggle.

**Restoring is directed: you point at the old value, then at where it goes.**
Val does not try to work out which of today's fields corresponds to which of the
commit's. It cannot be sure — array items splice, schemas move — and a restore
that guesses wrong writes into the wrong place and looks like it worked. Two
picks leave nothing to guess. You can restore across paths, so last month's
headline can become today's tagline.

Before you click, every field on the "now" side says whether it can hold the
value you picked, and a field that cannot explains why when you click it rather
than doing nothing. A changed union is not itself a blocker: what matters is
whether the value's own shape is still allowed, so a union that gained a case
restores fine and one that lost the case you are restoring does not.

Rich text can be restored but is marked "probably fits" rather than confirmed —
comparing every mark and block against the options a schema allows is not done
yet, and saying so is better than a confident answer we cannot back. It is
checked properly the moment you commit to it: before anything is staged, the old
value is checked against the field it is going into, and a value that cannot be
that field is refused with the reason. A value that is the right shape but
breaks a rule about its content — a name too short for its `minLength` — is
staged and then held at publish, the same as if you had typed it, because a
restore should not be stricter than typing.

**A whole module can be put back on its own**, from a commit that changed
several, without reverting the rest of the commit.

**Restores are staged, not applied.** They land in pending changes, are reviewed
beside every other edit, and go out with the next publish. There is also "put
everything back", for when a whole publish was the mistake.

To make this possible, publishing now records each changed module's data and the
schema it was written against. Not the `.val.ts` — git already keeps that, but
it is code, and turning code back into data means parsing it, which is
best-effort and stops working as TypeScript, your runtime and Val move on. The
schema is kept because a value on its own cannot be drawn: showing a module as it
was at a commit whose schema has since changed needs _that commit's_ schema, and
nothing in your current checkout has it.

Things it will not pretend about: a module the commit did not touch says so
rather than showing today's value; a module saved by a different version of Val
says the version differs and that nothing is lost; a commit made before Val
started recording history disables restore with the reason next to it. Images
and files are restored by re-uploading them, since the bytes at an old commit
may no longer be on your branch.

History requires the Val content service. In filesystem mode it reports
`not-supported-in-fs-mode` rather than faking it from git, which has the files
but not which of a commit's changes were one editor's work.
