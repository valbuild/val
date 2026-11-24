/**
 * Builds a project whose stylesheet points Tailwind at a config file with a
 * path relative to itself -- `@config "../tailwind.config.js"` in
 * `src/styles.css`, as blankno-v4 had it on its first publish -- and reports
 * what came out, or what the build said instead.
 *
 * The config is a real file on disk, loaded by the CLI's loader
 * (`cssModuleLoader`), because the two halves agreeing on what `base` means is
 * the part under test. A separate process for the reason productionBuildProbe.ts
 * gives: rolldown is ESM-only and jest runs CommonJS here.
 */
import "./nativeBundler";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildUserApp } from "../build";
import type { BuildTarget } from "../contract";
import { cssModuleLoader } from "../node/cssModules";

const target: BuildTarget = {
  base: {
    rev: "base",
    shellRev: "shell",
    rscShellRev: "rsc",
    modules: { react: "react", "react/jsx-runtime": "jsx-runtime" },
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
  project: { rev: "project", rsc: false, modules: {}, css: {}, workerOnly: [] },
};

const APP = `
import "./styles.css";
export default function App() {
  return <main className="bg-brand">hello</main>;
}
`;

/** On disk, beside the project's files: what the directives point at. */
const DISK: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture", type: "module" }),
  "tailwind.config.js":
    "export default { theme: { extend: { colors: { brand: '#abcdef' } } } };\n",
};

type Outcome = { css: string } | { error: string };

async function build(
  sheets: Record<string, string>,
  withLoader = true,
): Promise<Outcome> {
  const dir = await mkdtemp(join(tmpdir(), "tailwind-config-"));
  try {
    const files = { "src/app.tsx": APP, ...sheets };
    for (const [path, text] of Object.entries({ ...DISK, ...files })) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    }
    const built = await buildUserApp({
      files,
      target,
      ...(withLoader ? { loadCssModule: cssModuleLoader(dir) } : {}),
    });
    return { css: built.cssCode ?? "" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const result = {
    relative: await build({
      "src/styles.css": `@import "tailwindcss";\n@config "../tailwind.config.js";\n`,
    }),
    fromAnImportedSheet: await build({
      "src/styles.css": `@import "tailwindcss";\n@import "./theme/theme.css";\n`,
      "src/theme/theme.css": `@config '../../tailwind.config.js';\n`,
    }),
    missingFile: await build({
      "src/styles.css": `@import "tailwindcss";\n@config "../tailwind.config.ts";\n`,
    }),
    missingPackage: await build({
      "src/styles.css": `@import "tailwindcss";\n@plugin "@acme/tailwind-plugin/extra";\n`,
    }),
    noLoader: await build(
      {
        "src/styles.css": `@import "tailwindcss";\n@config "../tailwind.config.js";\n`,
      },
      false,
    ),
  };
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
