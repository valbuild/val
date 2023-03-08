import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      jsxRuntime: "automatic",
      jsxImportSource: "@valbuild/react",
    }),
  ],
  optimizeDeps: {
    /**
     * NOTE: Only necessary when developing in this monorepo!
     */
    exclude: ["fsevents"],
  },
});
