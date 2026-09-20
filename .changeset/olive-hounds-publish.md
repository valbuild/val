---
"@valbuild/cli": minor
---

Add `val publish`, which publishes a project's build through content.val.build.

```sh
npx val publish                          # publish the artifacts in .val/publish
npx val publish --artifacts build/out    # publish a directory by name
npx val publish --dry-run                # verify, and stop before the site changes
```

It declares what the build is made of — every artifact by key, sha256 and size
— uploads only the ones content does not already hold, straight to object
storage, and then has content build and render the build as a canary before
anything goes live. A build content already holds uploads nothing. A canary
that does not render is never promoted, and the command exits non-zero with
content's own problem codes, hints included, so CI gates on it. Declaring the
same build twice resumes that publish rather than starting a second one, so a
re-run of a CI job picks up where it left off.

The artifacts are read from a directory whose layout is the key namespace:
the path of each file under it is its artifact key — `server`, `client`,
`css`, `rsc`, `layer`, or a path under `chunk/server`, `chunk/client`,
`chunk/rsc`, `asset`, `public`. Nothing is renamed on the way, since an asset
is addressed by the path the built code imports it at.

Authenticates with `VAL_PROJECT_TOKEN` — the single secret a repository needs,
since the token names its project — or with the `val login` token in
`.val/pat.json`, which is exchanged for a ten minute publish token and needs
the project (`"<org>/<project>"`) in `val.config` or `VAL_PROJECT`. Never a
command line flag: an argument is visible to anyone who can list processes,
and it is kept in shell history and in the log of every CI job that echoes its
command line.

The commit and branch the build is of are taken from `--commit` / `--branch`,
then `VAL_GIT_COMMIT` / `VAL_GIT_BRANCH`, then `GITHUB_SHA` / `GITHUB_REF_NAME`,
then git. The commit is baked into the published site and decides which version
of its own content it reads, so the command refuses rather than guessing when
it cannot tell.
