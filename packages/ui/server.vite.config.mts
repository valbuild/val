import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  mode: "production",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  build: {
    outDir: "./server/dist",
    manifest: true,
    lib: {
      entry: {
        "valbuild-ui-server": "./src/vite-server.ts",
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
    minify: false, // do not minify server - it can corrupt the injected code
  },
});
