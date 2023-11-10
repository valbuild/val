import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: "./server/dist",
    manifest: true,
    lib: {
      entry: {
        "valbuild-ui-server": "./src/vite-server.ts",
        "valbuild-ui-main": "./src/main.jsx",
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
    // Output semi-readable code and let consumers handle minification
    minify: false,
  },
});
