/**
 * Builds a small Val project with `buildUserApp` and reports where each Val
 * module's dependencies reached: the server bundle (`globalThis` read
 * replaced by the map), never the client. See moduleDependencies.test.ts.
 *
 * A separate process for the reason splitEnvMarkersProbe.ts gives: rolldown
 * is ESM-only and jest runs CommonJS here.
 */
import "./nativeBundler";
import { buildUserApp } from "../build";
import type { BuildTarget } from "../contract";

const target: BuildTarget = {
  base: {
    rev: "base",
    shellRev: "shell",
    rscShellRev: "rsc",
    modules: {
      react: "react",
      "react/jsx-runtime": "jsx-runtime",
      "react-dom": "react-dom",
      "@tanstack/react-router": "tanstack-react-router",
      "@tanstack/react-start": "tanstack-react-start",
    },
    rscModules: {},
    paths: {
      baseFromProject: "../vendor/",
      projectVendorDir: "pvendor",
      rscVendorBase: "../vendor-rsc/",
      rscRuntimeSpecifier: "@tanstack/react-start/rsc",
      rscRuntimePath: "./runtime.js",
      flightServer: "@vitejs/plugin-rsc/vendor/react-server-dom/server.edge",
      serverFnBase: "/_serverFn/",
    },
  },
  project: {
    rev: "project",
    rsc: false,
    modules: { "@valbuild/core": "valbuild__core" },
    css: {},
    workerOnly: [],
  },
};

const files = {
  "src/app.tsx": `
export const handed = globalThis.__VAL_MODULE_DEPENDENCIES__;
export default { routes: [] };
`,
  "val.config.ts": `import { initVal } from "@valbuild/core";\nexport const { s, c, config } = initVal();\n`,
  "val.modules.ts": [
    `import { modules } from "@valbuild/core";`,
    `import { config } from "./val.config";`,
    `export default modules(config, [{ def: () => import("./src/home.val") }]);`,
  ].join("\n"),
  "src/home.val.ts": [
    `import { s, c } from "../val.config";`,
    `import { TITLE } from "./shared";`,
    `export default c.define("/src/home.val.ts", s.object({ title: s.string() }), { title: TITLE });`,
  ].join("\n"),
  "src/shared.ts": `export const TITLE: string = "Sale";`,
};

async function main() {
  const built = await buildUserApp({ files, target });
  const server =
    built.serverCode + Object.values(built.serverChunks ?? {}).join("\n");
  const client =
    built.clientCode + Object.values(built.clientChunks ?? {}).join("\n");
  const map = `"src/home.val.ts":["src/shared.ts","val.config.ts"]`;
  const compact = (text: string) => text.replace(/\s+/g, "");
  console.log(
    JSON.stringify({
      server: {
        map: compact(server).includes(map),
        readLeft: server.includes("__VAL_MODULE_DEPENDENCIES__"),
      },
      client: { map: compact(client).includes(map) },
      warnings: built.warnings,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
