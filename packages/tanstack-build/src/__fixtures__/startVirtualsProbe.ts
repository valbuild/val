/**
 * Builds a dependency layer whose one dependency reaches TanStack Start's
 * manifest the way `@tanstack/start-server-core` does, beside one that reaches
 * a module that does not exist, and reports what the build printed.
 *
 * What is printed is the thing under test, so the console is captured: rolldown
 * hands a warning to `onLog`, and `onLog` hands what it does not silence to
 * rolldown's own handler, which writes it out. A separate process because
 * `rolldown` is ESM-only and jest runs CommonJS here.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildVendorLayer, type VendorPlatform } from "../node/vendorLayer";

const platform: VendorPlatform = {
  base: {
    rev: "base-rev-1",
    shellRev: "",
    rscShellRev: "",
    modules: {},
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
  },
  resolvePlatformModule: () => null,
  baseLayerDir: null,
};

const pkg = (name: string) =>
  JSON.stringify({
    name,
    version: "1.0.0",
    type: "module",
    exports: "./index.js",
  });

const PROJECT: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture", dependencies: {} }),
  // As start-server-core's router-manifest.js has it.
  "node_modules/manifest-dep/package.json": pkg("manifest-dep"),
  "node_modules/manifest-dep/index.js":
    "export async function getManifest() {\n" +
    '  const { tsrStartManifest } = await import("tanstack-start-manifest:v");\n' +
    "  return tsrStartManifest();\n" +
    "}\n",
  // A genuinely unresolvable import, which must still be reported.
  "node_modules/ghost-dep/package.json": pkg("ghost-dep"),
  "node_modules/ghost-dep/index.js":
    'export const ghost = () => import("not-installed-anywhere");\n',
};

async function layer(deps: Array<string>) {
  const root = await mkdtemp(join(tmpdir(), "start-virtuals-"));
  const printed: Array<string> = [];
  const original = {
    warn: console.warn,
    log: console.log,
    error: console.error,
    info: console.info,
    write: process.stderr.write.bind(process.stderr),
  };
  const capture = (...args: Array<unknown>) => {
    printed.push(args.map(String).join(" "));
  };
  console.warn = capture;
  console.log = capture;
  console.error = capture;
  console.info = capture;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    printed.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    for (const [path, text] of Object.entries(PROJECT)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const built = await buildVendorLayer(root, deps, {}, platform);
    return {
      modules: built?.modules ?? {},
      skipped: built?.skipped ?? [],
      workerCode: Object.values(built?.worker ?? {}).join("\n"),
      printed: printed.join("\n"),
    };
  } finally {
    console.warn = original.warn;
    console.log = original.log;
    console.error = original.error;
    console.info = original.info;
    process.stderr.write = original.write;
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const result = {
    manifest: await layer(["manifest-dep"]),
    ghost: await layer(["ghost-dep"]),
  };
  console.log(JSON.stringify(result));
}

void main();
