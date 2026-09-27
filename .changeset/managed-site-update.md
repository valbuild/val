---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

A site hosted on Val (a managed project, with no repository of its own) can now be updated from the Studio. **Settings → Updates** says whether a newer version of the software the site runs on is available, lists the packages that move and their versions, and offers **Update site**.

Updating rebuilds the site in the browser on the new versions and publishes it through the ordinary publish, so it is checked before it goes live: if the updated site does not render, nothing changes and the site keeps running the old versions. Unpublished changes are kept and are **not** published by an update. After it goes live, reload the Studio to use the new one.

In Safari, which cannot build the site in the Studio's own page, Update site opens a tab that builds and publishes it, the same way a publish does there, and the Studio follows its progress.

A Studio that was opened before the site was updated no longer publishes: pressing Publish asks you to reload first, and nothing is saved until you do. Your unpublished changes are kept. Without this, a Studio left open from before an update would have built the site with the previous version of itself.

The versions come from the template the project was made from, as the platform last built it. A project whose code lives in a repository is not offered this; its dependencies are updated there.

For hosts: `@valbuild/server` forwards `GET` and `POST /api/val/publish-api/update-target` to the content service, beside `/build-target` and `/project-source`.
