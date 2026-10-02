---
"@valbuild/server": patch
"@valbuild/shared": patch
---

A project created on val.build with a GitHub repository can publish right away. Before, the first publish was refused with "this deployment was not built from one" until the repository's first CI build had finished.

While that first build runs, the site is served the template's build. When you publish from it, Val now checks that its content files are exactly the same as the files in your repository. If they are, the publish goes ahead and is pushed to your repository straight away. Your changes stay visible in the Studio until the site serves CI's build of them. If the files differ, the publish is refused, as before.
