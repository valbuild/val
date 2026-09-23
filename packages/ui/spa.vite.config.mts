import { defineConfig } from "vite";
import { DEFAULT_STATIC_HOST, rolldownWasmPlugin } from "./build/rolldownWasm";

const OUT_DIR = "./server/.tmp";

/**
 * The Studio's own bundle.
 *
 * Everything this emits is base64-embedded into the server bundle by
 * `fix-server-hack.js` and served from `/api/val/static` -- with one exception,
 * which is what the plugin below is for. See `build/rolldownWasm.mjs`.
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
    rolldownWasmPlugin({
      root: import.meta.dirname,
      host: process.env.VAL_STATIC_HOST || DEFAULT_STATIC_HOST,
      outDir: OUT_DIR,
    }),
  ],
  build: {
    outDir: OUT_DIR,
    minify: true,
  },
});
