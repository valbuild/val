/**
 * Builds one small project's dependency layer against a platform that is
 * nothing but FACTS -- `BuildTarget.base`, no checkout, no built base layer --
 * which is how `val publish` sees the platform from a project's CI, and reports
 * what each build did.
 *
 * The project is the incident in PINS.md in miniature: a dependency that
 * reaches a TanStack package the base layer splits (`start-server-core`, which
 * is never a direct dependency of anything), installed two patches away from
 * the platform's, and importing a name from a base chunk. A separate process
 * because `rolldown` is ESM-only and jest runs CommonJS here.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BuildTarget } from "../contract";
import {
  buildVendorLayer,
  PinSkewError,
  type PinSkew,
  type VendorPlatform,
} from "../node/vendorLayer";

type Facts = Pick<BuildTarget["base"], "pins" | "exports">;

export type Outcome =
  | {
      built: true;
      modules: Record<string, string>;
      skipped: Array<{ specifier: string; reason: string }>;
    }
  | { built: false; pinSkew: Array<PinSkew> | null; message: string };

const remote = (facts: Facts): VendorPlatform => ({
  base: {
    rev: "base-rev-1",
    shellRev: "",
    rscShellRev: "",
    modules: { "@tanstack/react-router": "tanstack-react-router" },
    rscModules: {},
    paths: {
      baseFromProject: "../vendor/",
      projectVendorDir: "pvendor/",
      rscVendorBase: "../vendor-rsc/",
      rscRuntimeSpecifier: "",
      rscRuntimePath: "",
      flightServer: "",
      serverFnBase: "/_serverFn/",
    },
    ...facts,
  },
  resolvePlatformModule: () => null,
  baseLayerDir: null,
});

const pkg = (name: string, version: string, exports: string) =>
  JSON.stringify({ name, version, type: "module", exports });

const PROJECT: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture", dependencies: {} }),
  "node_modules/dep-a/package.json": pkg("dep-a", "1.0.0", "./index.js"),
  "node_modules/dep-a/index.js":
    'import { helper } from "@tanstack/start-server-core";\n' +
    'import { useRouter } from "@tanstack/react-router";\n' +
    "export const a = () => [helper(), useRouter];\n",
  "node_modules/@tanstack/start-server-core/package.json": pkg(
    "@tanstack/start-server-core",
    "1.169.37",
    "./dist/esm/index.js",
  ),
  // A nested manifest with no name or version, as real packages ship one: the
  // version has to come from the manifest above it.
  "node_modules/@tanstack/start-server-core/dist/esm/package.json":
    JSON.stringify({ type: "module" }),
  "node_modules/@tanstack/start-server-core/dist/esm/index.js":
    "export const helper = () => 1;\n",
  // Cannot build at all, which sends a layer down the per-dependency probe.
  "node_modules/broken/package.json": pkg("broken", "1.0.0", "./index.js"),
  "node_modules/broken/index.js": 'export * from "./missing.js";\n',
};

async function layer(deps: Array<string>, facts: Facts): Promise<Outcome> {
  const root = await mkdtemp(join(tmpdir(), "vendor-layer-facts-"));
  try {
    for (const [path, text] of Object.entries(PROJECT)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const built = await buildVendorLayer(root, deps, {}, remote(facts));
    return {
      built: true,
      modules: built?.modules ?? {},
      skipped: built?.skipped ?? [],
    };
  } catch (error) {
    return {
      built: false,
      pinSkew: error instanceof PinSkewError ? error.skew : null,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const skewed = { pins: { "@tanstack/start-server-core": "1.169.39" } };
const agreeing = { pins: { "@tanstack/start-server-core": "1.169.37" } };
const exportsOf = (names: Array<string>) => {
  const chunks = { "tanstack-react-router": names };
  return { worker: chunks, browser: chunks };
};

async function main() {
  const result = {
    skewed: await layer(["dep-a"], skewed),
    skewedBesideABrokenDependency: await layer(["broken", "dep-a"], skewed),
    agreeing: await layer(["dep-a"], agreeing),
    noPins: await layer(["dep-a"], {}),
    missingExport: await layer(["dep-a"], {
      exports: exportsOf(["createRouter"]),
    }),
    presentExport: await layer(["dep-a"], {
      exports: exportsOf(["useRouter"]),
    }),
    chunkNotListed: await layer(["dep-a"], {
      exports: { worker: {}, browser: {} },
    }),
  };
  console.log(JSON.stringify(result));
}

void main();
