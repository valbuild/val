import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  /*
   * Overridable for the e2e suite, which can run a second dev server of this
   * app in proxy mode beside the fs-mode one (see `playwright.config.ts`). Two
   * servers re-optimizing dependencies into one cache delete each other's
   * chunks, and the page that asked for one 404s. `NEXT_DIST_DIR` in the Next
   * example is the same thing for the same reason.
   */
  cacheDir: process.env.VAL_E2E_VITE_CACHE_DIR || "node_modules/.vite",
  /*
   * The e2e switches `val.modules.ts` reads, inlined so the browser and the
   * server read the same answer: the Studio is handed the modules in the
   * browser too, where there is no `process.env`. Empty, so off, unless the
   * suite's servers set them.
   */
  define: {
    "process.env.VAL_E2E_FIXTURES": JSON.stringify(
      process.env.VAL_E2E_FIXTURES ?? "",
    ),
    "process.env.VAL_E2E_REMOTE_MEDIA": JSON.stringify(
      process.env.VAL_E2E_REMOTE_MEDIA ?? "",
    ),
  },
  /*
   * The dependencies of `@valbuild/shared/internal`, bundled up front.
   *
   * In this monorepo the `@valbuild/*` packages are linked source, which Vite
   * does not pre-bundle, so it meets their dependencies only when a page
   * imports them -- and `ValTanStackProvider` imports this entrypoint lazily,
   * the first time a page renders with the overlay on. Vite then re-optimizes
   * and reloads every page it serves, the Studio included: the first canvas
   * test on a fresh checkout lost what it was editing to that reload. An app
   * that installs Val from npm has none of this, since `@valbuild/tanstack` is
   * pre-bundled with everything it imports, lazily or not.
   */
  optimizeDeps: {
    include: [
      "@valbuild/tanstack > @valbuild/shared > zod",
      "@valbuild/tanstack > @valbuild/shared > zod-validation-error",
      "@valbuild/tanstack > @valbuild/shared > flexsearch",
    ],
  },
  plugins: [
    tanstackStart({
      /*
       * A `*.val.ts` beside a route file is content, not a route.
       *
       * The route generator scans every file under `src/routes`, so without
       * this it reads `posts.$postId.val.ts` as a route at
       * `/posts/$postId/val` and warns on every run that the file exports no
       * `Route`. The same pattern belongs in `tsr.config.json` for the
       * standalone `tsr generate` CLI.
       */
      router: { routeFileIgnorePattern: "\\.val\\.[tj]sx?$" },
    }),
    viteReact(),
  ],
});
