---
"@valbuild/language-server": patch
"@valbuild/core": patch
"@valbuild/next": patch
"@valbuild/react": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Every release now ships a changelog. Each package's `CHANGELOG.md` records what
changed under the version that shipped it — with a link to the pull request, the
commit and the author — and the same entry becomes the body of the GitHub
Release for the tag. The file is included in the npm tarball, so it is also
readable from an installed copy.

Up to now those changelogs were generated empty, and the GitHub Releases with
them, so there was no record of what any given version contained. Releases from
this one on have one; earlier versions stay blank.
