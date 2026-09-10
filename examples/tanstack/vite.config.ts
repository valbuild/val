import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
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
