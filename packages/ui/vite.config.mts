import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  base: "/api/val/static",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    lib: {
      entry: {
        "valbuild-ui": "./src/vite-index.tsx",
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
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
  },
  optimizeDeps: {
    include: ["react/jsx-runtime", "react/jsx-dev-runtime"],
  },
});
