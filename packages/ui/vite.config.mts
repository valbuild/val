import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  base: "/api/val/static",
  plugins: [react()],
  build: {
    minify: true,
  },
});
