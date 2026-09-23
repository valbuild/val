---
"@valbuild/ui": patch
---

A publish from a managed project now builds and ships the site, instead of stopping at the commit.

There is no repository and no host watching one, so nothing outside the browser would have turned that commit into a running site. The publish button stays busy until the build is live, and a build that fails says the changes are saved and the site has not been rebuilt — which is the truth, and the state `Finish publishing` exists to resolve.

A project whose pages are files under `src/routes` needs a route tree generator, which is TanStack's over babel and is not something this package can carry. A deployment supplies one on `globalThis.__VAL_ROUTE_TREE_GENERATOR__`; without it such a project is refused by name.
