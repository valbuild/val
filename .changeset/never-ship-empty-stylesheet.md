---
"@valbuild/tanstack-build": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

**A publish from Val Studio no longer goes out without the site's styles.** A build in the Studio uses the live site's stylesheet, because the source Val stores holds no stylesheets. It could still publish a site with an empty stylesheet:

- **On a proposal's preview** it read the stylesheet from the preview's own address, so one empty build of a proposal made every rebuild of it empty too. It now reads the live site's stylesheet, and its public files, from the site's address.
- **When the live stylesheet could not be read**, it published with none. Now only a site that serves no stylesheet is published without one. Any other failure stops the publish and says to try again.
- **When the site's styles are missing and the live site has none**, it published the site unstyled. It now stops and says how to get the styles back: publish from the repository with `val publish`, or restore a build that has them from History.

`buildUserApp` reports the stylesheets the project's modules import that it was not given, as `missingStylesheets`.
