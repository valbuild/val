import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin";

export default defineConfig({
  plugins: [
    tanstackStart({
      // A `*.val.ts` beside a route file is content, not a route.
      router: { routeFileIgnorePattern: "\\.val\\.[tj]sx?$" },
    }),
    /*
     * The server build, for wherever it is deployed. Nitro picks its preset
     * from the environment: Vercel's output on Vercel, a Node server
     * (`pnpm start`) everywhere else.
     *
     * No source maps: the Studio's own files are embedded in the server
     * (`@valbuild/ui/server`, tens of MB), and mapping them ran the build out
     * of memory.
     */
    nitroV2Plugin({ compatibilityDate: "2026-10-18", sourceMap: false }),
    viteReact(),
  ],
});
