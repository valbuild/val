---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

A site hosted on Val (a managed project, with no repository of its own) can now be updated from the Studio. **Settings → Updates** says whether a newer version of the software the site runs on is available, lists the packages that move and their versions, and offers **Update site**.

Updating rebuilds the site in the browser on the new versions and publishes it through the ordinary publish, so it is checked before it goes live: if the updated site does not render, nothing changes and the site keeps running the old versions. Unpublished changes are kept and are **not** published by an update. After it goes live, reload the Studio to use the new one.

The versions come from the template the project was made from, as the platform last built it. A project whose code lives in a repository is not offered this; its dependencies are updated there.

For hosts: `@valbuild/server` forwards `GET` and `POST /api/val/publish-api/update-target` to the content service, beside `/build-target` and `/project-source`.
