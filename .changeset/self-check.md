---
"@valbuild/shared": patch
"@valbuild/tanstack": patch
---

A site's Val can now check the site's content with its own rules: `Internal.selfCheck` in `@valbuild/tanstack`. The platform's upgrade page calls it on the version an upgrade moves to, so content the new version would reject is found before the upgrade is published, not after. It answers the errors that would hold a publish back, the same ones the Studio shows, and loads nothing until it is called, so it adds nothing to a site's pages.
