import { defineConfig } from "vite";
import {
  DEFAULT_STATIC_HOST,
  rolldownBrowserBindingPlugin,
  rolldownWasmPlugin,
} from "./build/rolldownWasm";

const OUT_DIR = "./server/.tmp";

/**
 * The Studio's own bundle.
 *
 * Everything this emits is base64-embedded into the server bundle by
 * `fix-server-hack.js` and served from `/api/val/static` -- with one exception,
 * which is what the plugin below is for. See `build/rolldownWasm.ts`.
 */
// https://vitejs.dev/config/
export default defineConfig({
  mode: "production",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  base: "/api/val/static", // TODO: needs to be configurable
  esbuild: {
    target: "ES2020",
  },
  plugins: [
    rolldownBrowserBindingPlugin({ root: import.meta.dirname }),
    rolldownWasmPlugin({
      root: import.meta.dirname,
      host: process.env.VAL_STATIC_HOST || DEFAULT_STATIC_HOST,
      outDir: OUT_DIR,
    }),
  ],
  /*
   * The builder runs in a worker (`spa/publish/builder.worker.ts`), and a worker
   * is a bundle of its own with plugins of its own. ES modules, because the
   * builder is dynamic imports and rolldown's loader awaits at the top level.
   * The binding redirect again, because the builder is in THIS bundle now; the
   * wasm URL rewrite needs nothing, as `renderBuiltUrl` is config for every
   * bundle the build emits.
   */
  worker: {
    format: "es",
    plugins: () => [
      rolldownBrowserBindingPlugin({ root: import.meta.dirname }),
    ],
  },
  build: {
    outDir: OUT_DIR,
    minify: true,
  },
});
