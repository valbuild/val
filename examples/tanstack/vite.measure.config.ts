import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

/**
 * This app, built the way an app that installs Val from npm is built: Val's
 * packages left EXTERNAL, so the server imports their built `dist/` at run
 * time, as a deployed site does. For `scenarios/measure/coldStart.ts`, after
 * a root `pnpm run build` (then `pnpm preconstruct dev`, see CLAUDE.md):
 *
 *   pnpm exec vite build --config vite.measure.config.ts
 *
 * The normal build bundles the linked workspace packages from source instead,
 * which hides what an app's server actually loads: in this repository the
 * Studio's server entry is a dev shim, where a published one embeds ~22 MB of
 * assets.
 */
export default mergeConfig(
  base,
  defineConfig({
    build: { outDir: "dist/measure" },
    ssr: {
      external: [
        "@valbuild/core",
        "@valbuild/react",
        "@valbuild/shared",
        "@valbuild/server",
        "@valbuild/tanstack",
        "@valbuild/ui",
        "@valbuild/mcp",
      ],
    },
  }),
);
