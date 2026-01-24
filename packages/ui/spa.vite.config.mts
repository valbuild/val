import { defineConfig } from "vite";

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
  build: {
    outDir: "./server/.tmp",
    minify: true,
  },
});
