import { defineConfig } from "vite";
import { spaDevServerOptions } from "./src/spaDevServer";
import {
  eslintInBrowserEsbuildPlugin,
  eslintInBrowserPlugin,
} from "./build/eslintInBrowser";

// https://vitejs.dev/config/
export default defineConfig({
  base: "/api/val/static",
  // The assistant's `lint` runs ESLint in the tab. The production build
  // (`spa.vite.config.mts`) redirects `esquery` and `node:path` for ESLint's
  // imports; dev needs the same, or `lint` answers "esquery.matches is not a
  // function". Dev pre-bundles `eslint/universal` with esbuild, which never
  // runs the Rollup plugin, hence the esbuild twin as well.
  plugins: [eslintInBrowserPlugin({ root: import.meta.dirname })],
  optimizeDeps: {
    esbuildOptions: {
      plugins: [eslintInBrowserEsbuildPlugin({ root: import.meta.dirname })],
    },
  },
  // Its HMR socket goes to this server, never through the app: see
  // `spaDevServerOptions`.
  server: spaDevServerOptions,
  esbuild: {
    target: "ES2020",
  },
  build: {
    minify: true,
    lib: {
      entry: {
        "valbuild-ui": "./src/vite-index.ts",
      },
      formats: ["cjs", "es"],
      /**
       * Sets file names to match the output from Preconstruct
       */
      fileName(format, entryName) {
        switch (format) {
          case "es":
            return `${entryName}.esm.js`;
          case "cjs":
            return `${entryName}.cjs.js`;
          default:
            throw Error(`Unexpected format: ${format}`);
        }
      },
    },
  },
});
