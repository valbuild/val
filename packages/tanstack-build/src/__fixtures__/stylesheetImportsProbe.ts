/**
 * Publishes a project laid out the way valbuild/templates' Full template is --
 * one entry sheet importing Tailwind and a theme, the theme importing a font
 * package -- and reports what reached the stylesheet and the published assets.
 *
 * The font package is a real directory on disk, because what is being tested
 * is the CI half (`collectDependencyCss` reading node_modules) handing over to
 * the builder half. A separate process for the reason productionBuildProbe.ts
 * gives: rolldown is ESM-only and jest runs CommonJS here.
 */
import "./nativeBundler";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUserApp } from "../build";
import type { BuildTarget } from "../contract";
import {
  collectDependencyCss,
  cssSpecifiersOf,
  layerDepsOf,
} from "../node/vendorLayer";

const FONT_BYTES = Buffer.from("not really a woff2, but bytes all the same");

const files: Record<string, string> = {
  "src/app.tsx": `
import "./styles.css";
export default function App() {
  return <main className="bg-brand font-display">hello</main>;
}
`,
  "src/styles.css": `@import "tailwindcss";
@import "./theme/theme.css";

body { margin: 0; }
`,
  "src/theme/theme.css": `/* The fonts, then the tokens. */
@import "@fontsource-variable/inter";

@theme {
  --color-brand: #123456;
  --font-display: "Inter Variable", sans-serif;
}
`,
};

const target = (css: Record<string, string>): BuildTarget => ({
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
  project: { rev: "project", rsc: false, modules: {}, css, workerOnly: [] },
});

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "stylesheet-imports-"));
  try {
    const pkg = join(dir, "node_modules", "@fontsource-variable", "inter");
    await mkdir(join(pkg, "files"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { "@fontsource-variable/inter": "5.0.0", react: "19" },
      }),
    );
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "@fontsource-variable/inter", main: "index.css" }),
    );
    // A relative import inside the package, and the same file twice.
    await writeFile(
      join(pkg, "index.css"),
      `@import "./latin.css";\n@font-face { font-family: "Inter Variable"; src: url(./files/inter.woff2) format("woff2"); }\n`,
    );
    await writeFile(
      join(pkg, "latin.css"),
      `@font-face { font-family: "Inter Variable"; src: url('./files/inter.woff2'); unicode-range: U+0000-00FF; }\n`,
    );
    await writeFile(join(pkg, "files", "inter.woff2"), FONT_BYTES);

    const specifiers = cssSpecifiersOf(files);
    const assets: Record<string, string> = {};
    const css = await collectDependencyCss(dir, specifiers, assets);
    const layerDeps = layerDepsOf(
      {
        dependencies: { "@fontsource-variable/inter": "5.0.0", react: "19" },
      },
      files,
    );

    const built = await buildUserApp({
      files,
      target: target(css),
      dependencyAssets: assets,
    });

    console.log(
      JSON.stringify({
        specifiers,
        layerDeps,
        assetNames: Object.keys(assets),
        assetBase64: Object.values(assets),
        fontBase64: FONT_BYTES.toString("base64"),
        cssCode: built.cssCode,
        assetFiles: built.assetFiles,
        warnings: built.warnings,
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
