---
"@valbuild/ui": minor
"@valbuild/server": patch
---

**Upgrade your site's dependencies from the Studio.** When newer versions of your site's packages are available, an **Upgrade** button appears in the Studio's top bar (on a phone, in the account sheet). It is marked when the upgrade fixes a vulnerability.

- **Pick a kind:** fix vulnerabilities, move to the latest version within each major, or move to new major versions. For majors, you can untick any package to leave it out.
- **Upgrade in a proposal:** this opens a proposal with the upgrade in it, and the Studio follows it there:
  - computing the upgrade;
  - building the new dependencies;
  - typechecking your code against them;
  - building the proposal.
- **Publish:** offered once the upgrade adds no type errors and the proposal is built. If it adds type errors, they are listed by file and the proposal stays open, so you can fix them there.
- **Settings → Updates** offers the same choice. "Update site", which published the template's dependencies straight to the live site, is gone.

A proposal whose dependencies change is typechecked automatically, and it can't be published until the typecheck finds no new errors. The **Typecheck** check in the Publish dialog runs it on request.
