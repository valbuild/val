---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

A managed project published from the Studio keeps its images, and a project created from a template can publish from the Studio at all.

- A publish from the Studio carries over every file under `public/` that the site already serves, so the favicon and images no longer disappear after the first Studio publish. When content published the live build, it already holds those files and nothing is uploaded again. When it didn't (a project cloned from a template), the Studio reads them from the site it runs on and builds with them.
- An image uploaded in the Studio is now part of the build that publishes it. For a managed project, `/save` returns the files the commit wrote (`binaryFiles`), the same way it already returns the `.val.ts` text.
- `/save` also returns the project's branch for a managed project, and the Studio's build uses it. A project cloned from a template was wired at no commit and no branch, so its first Studio publish went out branchless and the platform refused it.
- When neither content nor the platform can say which public files the live site serves, the Studio refuses to publish and says so, rather than publishing a site without them.
