---
"@valbuild/cli": minor
---

Add `val publish`, which publishes a project's build through content.val.build.

```sh
npx val publish                 # publish the build in .output / dist / build / .next
npx val publish --dir build     # publish a directory by name
npx val publish --dry-run       # verify, and stop before the site changes
```

It hashes the built files, uploads only the ones content does not already
have, and asks content to verify the build by rendering a canary before the
site changes. A build content already holds uploads nothing; a canary that
does not render is never promoted, and the command exits non-zero with what
content said went wrong, so CI gates on it.

Authenticates with `VAL_PROJECT_TOKEN` — the single secret a repository needs,
since the token names its project — or with the `val login` token in
`.val/pat.json`, which is exchanged for a ten minute publish token and needs
the project (`"<org>/<project>"`) in `val.config` or `VAL_PROJECT`. Never a
command line flag: an argument is visible to anyone who can list processes,
and it is kept in shell history and in the log of every CI job that echoes its
command line.

The commit and branch the build is of are taken from `--commit` / `--branch`,
then `VAL_GIT_COMMIT` / `VAL_GIT_BRANCH`, then `GITHUB_SHA` / `GITHUB_REF_NAME`,
then git. They decide which version of its own content the published site
reads, so the command refuses rather than guessing when it cannot tell.
