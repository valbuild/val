import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: "./server/.tmp",
    rollupOptions: {
      output: { entryFileNames: "[name].js" },
    },
  },
});
