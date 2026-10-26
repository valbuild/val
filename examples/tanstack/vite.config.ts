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
