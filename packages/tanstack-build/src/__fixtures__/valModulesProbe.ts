/**
 * Bundles a small Val project with `bundleValModules`, imports the bundle and
 * reports what its modules are -- what the builder tab does, on Node.
 *
 * A separate process for the reason splitEnvMarkersProbe.ts gives: rolldown is
 * rolldown's, which is ESM-only, and jest runs CommonJS here. The
 * site's vendor chunk is a file under a temp directory standing in for the
 * origin, re-exporting this repository's `@valbuild/core`.
 */
import "./nativeBundler";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { pathToFileURL } from "url";
import { bundleValModules } from "../valModules";
import type { BuildTarget } from "../contract";

const CORE = path.resolve(__dirname, "../../../core/src/index.ts");

async function main() {
  const files: Record<string, string> = JSON.parse(process.argv[2]!);
  const dir = mkdtempSync(path.join(tmpdir(), "val-modules-"));
  mkdirSync(path.join(dir, "_pvendor", "r1"), { recursive: true });
  // The site serves its chunks as modules; Node needs telling.
  writeFileSync(path.join(dir, "package.json"), `{ "type": "module" }`);
  writeFileSync(
    path.join(dir, "_pvendor", "r1", "valbuild__core.js"),
    // Core runs as CommonJS under tsx, so its names are read off the default.
    [
      `import core from ${JSON.stringify(pathToFileURL(CORE).href)};`,
      `export const { initVal, modules, Internal } = core;`,
      ``,
    ].join("\n"),
  );
  const target: BuildTarget = {
    base: {
      rev: "b1",
      shellRev: "s1",
      rscShellRev: "s1",
      modules: {},
      rscModules: {},
      paths: {
        baseFromProject: "../vendor/",
        projectVendorDir: "pvendor/",
        rscVendorBase: "../vendor/",
        rscRuntimeSpecifier: "platform:rsc",
        rscRuntimePath: "rsc/runtime.js",
        flightServer: "flight",
        serverFnBase: "/_serverFn/",
      },
    },
    project: {
      rev: "r1",
      rsc: false,
      modules: { "@valbuild/core": "valbuild__core" },
      css: {},
      workerOnly: [],
    },
  };
  let code: string;
  try {
    code = (
      await bundleValModules({
        files,
        target,
        origin: pathToFileURL(dir).href,
      })
    ).code;
  } catch (error) {
    console.log(JSON.stringify({ error: String(error) }));
    return;
  }
  const bundle = path.join(dir, "val.modules.mjs");
  writeFileSync(bundle, code);
  const core = await import(CORE);
  const entry = await import(pathToFileURL(bundle).href);
  const modules: Record<string, unknown> = {};
  for (const { def } of entry.default.modules) {
    const module = (await def()).default;
    const source = await core.Internal.resolveJsonValues(
      core.Internal.getSource(module),
    );
    modules[core.Internal.getValPath(module)] = {
      schema: core.Internal.getSchema(module)["executeSerialize"]().type,
      source,
    };
  }
  console.log(
    JSON.stringify({ modules, external: /_pvendor\/r1\//.test(code) }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
