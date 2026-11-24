import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  /*
   * `PUBLIC_` reaches the browser, as it does on Val's platform, where a
   * project's `PUBLIC_` variables are `import.meta.env.NAME` in the browser
   * and everything else is `process.env.NAME` on the server only
   * (`@valbuild/tanstack-build`'s `envFor`). Vite lets only `VITE_` through by
   * default, so without this a `PUBLIC_` value from `.env` is there hosted and
   * missing in `vite dev`. And ONLY `PUBLIC_`: a `VITE_` name would reach the
   * browser here and not on the platform.
   */
  envPrefix: "PUBLIC_",
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
    "process.env.VAL_E2E_SCALE": JSON.stringify(
      process.env.VAL_E2E_SCALE ?? "",
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
   *
   * `modern-screenshot` and `@vercel/stega` are the same case, and were left
   * to be found at run time: every cold start discovered both after the page
   * had begun loading, and whether that reloaded the page ("optimized
   * dependencies changed. reloading") was a race the Studio's import order
   * decided. A change that moved one import took the first cold `/val` load
   * from never reloading to reloading one time in five, and the e2e warm-ups
   * failed on it. When a cold `vite dev` logs "dependencies optimized: x"
   * after its first bundling, x belongs in this list.
   */
  optimizeDeps: {
    include: [
      "@valbuild/tanstack > @valbuild/shared > zod",
      "@valbuild/tanstack > @valbuild/shared > zod-validation-error",
      "@valbuild/tanstack > @valbuild/shared > flexsearch",
      "@valbuild/tanstack > @valbuild/shared > modern-screenshot",
      "@valbuild/tanstack > @valbuild/react > @vercel/stega",
    ],
  },
  /*
   * No common-chunk merging in the production build, because this app
   * bundles Val's SOURCE.
   *
   * The readers load Val's server lazily (`import()` behind the Val API and
   * a draft read), so `@valbuild/shared/internal`'s modules are needed both
   * at startup and by those lazy chunks. Bundled from source, the entry is
   * dozens of modules, and rolldown's chunk merging moved some of them (with
   * zod at their top level) into a lazy chunk that the startup chunk imports
   * in a cycle. The first request then failed with `ZodEnum is not a
   * constructor`, and the server was loaded eagerly anyway. An app that
   * installs Val from npm bundles each entry as ONE prebuilt file, which
   * cannot be split like that: its default build is fine and stays lazy. See
   * `architecture/quirks.md`, "TanStack Start".
   */
  build: {
    rolldownOptions: {
      experimental: { chunkOptimization: false },
    },
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
