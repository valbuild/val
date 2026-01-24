import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  mode: "production",
  base: "/api/val/static",
  define: {
    "process.env.NODE_ENV": '"production"',
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
