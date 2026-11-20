import { defineConfig } from "vite";
import { spaDevServerOptions } from "./src/spaDevServer";

// https://vitejs.dev/config/
export default defineConfig({
  base: "/api/val/static",
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
