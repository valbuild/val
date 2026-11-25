---
"@valbuild/cli": patch
"@valbuild/tanstack-build": patch
---

**`val publish --dry-run` now checks the build against your own `vite build`.** Val publishes with its own builder, which does not read `vite.config.ts`. Some things `vite build` handles were published without an error and then broke the site: a stylesheet loaded with `import()`, a `virtual:` module from a Vite plugin, a package whose main file is CSS (`import "@fontsource/inter"`). A dry run now also builds the client with the project's Vite. It stops on each import Vite resolves that Val's build would leave for the browser to load, and on each stylesheet Vite puts on the page that Val's would not, and says how to fix it. It also names the Vite plugins Val's build does not run. Skip the check with `--no-vite-check`.
