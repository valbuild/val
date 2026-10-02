---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

Publishing a Git-connected app-mode project now puts your changes on the site in seconds, instead of waiting for CI.

- The Studio builds the site in the browser, the same way it does for a managed project. Val pushes the commit to your repository as before. When nothing but content has changed since the build the site is serving, the browser's build goes live right away. If a developer has pushed code in between, the site waits for CI's build, so their code is never taken off the site.
- If the browser cannot build, the publish still goes through and CI delivers it. This happens when the page is not cross-origin isolated, or when the build keeps failing. Your changes stay visible in the Studio until the site serves a build that has them.
- Content that would break a page is caught before anything is pushed to your repository.
