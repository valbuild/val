import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  mode: "production",
  base: "/api/val/static", // TODO: needs to be configurable
  build: {
    outDir: "./server/.tmp",
    minify: true,
  },
});
