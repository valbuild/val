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

/** What a layer with server-only dependencies reports, and what it ships. */
export type ServerOnlyOutcome = {
  modules: Record<string, string>;
  skipped: Array<{ specifier: string; reason: string }>;
  workerOnly: Array<string>;
  workerOnlyReasons: Record<string, string>;
  browserCode: string;
  workerCode: string;
  browserFiles: Array<string>;
};

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
  // Server-only: Node builtins, statically, through a module of its own -- and
  // a named import, which a stub with no exports would fail to link.
  "node_modules/server-dep/package.json": pkg(
    "server-dep",
    "1.0.0",
    "./index.js",
  ),
  "node_modules/server-dep/index.js":
    'import { fileOf } from "./files.js";\n' +
    "export const read = (name) => fileOf(name);\n",
  "node_modules/server-dep/files.js":
    'import path from "path";\n' +
    'import { randomUUID } from "node:crypto";\n' +
    'export const fileOf = (name) => path.join("/", name, randomUUID());\n',
  // A builtin behind import() only: the browser gets it, and the import
  // rejects at runtime, as it always did.
  "node_modules/lazy-dep/package.json": pkg("lazy-dep", "1.0.0", "./index.js"),
  "node_modules/lazy-dep/index.js":
    'export const tryFs = () => import("node:fs").then(() => true, () => false);\n',
  // Loads a native binary, which nothing can bundle: not layered, for either
  // side, and not a reason to build every other dependency on its own.
  "node_modules/native-dep/package.json": JSON.stringify({
    name: "native-dep",
    version: "1.0.0",
    main: "./index.js",
  }),
  "node_modules/native-dep/index.js":
    'module.exports = require("./addon.node");\n',
  "node_modules/native-dep/addon.node": "\u007fELF not really a binary",
  // `events` is a builtin's name AND an installed npm package, which a browser
  // build has always used. It stays the package.
  "node_modules/events/package.json": pkg("events", "3.3.0", "./events.js"),
  "node_modules/events/events.js":
    "export class EventEmitter { on() { return 'from-the-events-package'; } }\n",
  "node_modules/emitter-dep/package.json": pkg(
    "emitter-dep",
    "1.0.0",
    "./index.js",
  ),
  // Val's server entry point for a demo, which builds for a browser -- and is
  // nothing a browser imports, so it is built for the worker only.
  "node_modules/@valbuild/tanstack/package.json": JSON.stringify({
    name: "@valbuild/tanstack",
    version: "1.0.0",
    type: "module",
    exports: {
      ".": "./index.js",
      "./demo": "./demo.js",
      "./server": "./server.js",
    },
  }),
  "node_modules/@valbuild/tanstack/index.js":
    "export const ValProvider = () => 'the-provider';\n",
  // Server-only by contract AND unbuildable: skipped, and not also reported as
  // server-only.
  "node_modules/@valbuild/tanstack/server.js":
    'export * from "./missing.js";\n',
  "node_modules/@valbuild/tanstack/demo.js":
    "export const initValDemoServer = () => 'the-built-studio-as-strings';\n",
  "node_modules/emitter-dep/index.js":
    'import { EventEmitter } from "events";\n' +
    "export const emitter = () => new EventEmitter();\n",
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

async function serverOnly(deps: Array<string>): Promise<ServerOnlyOutcome> {
  const root = await mkdtemp(join(tmpdir(), "vendor-layer-server-only-"));
  try {
    for (const [path, text] of Object.entries(PROJECT)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const built = await buildVendorLayer(root, deps, {}, remote({}));
    return {
      modules: built?.modules ?? {},
      skipped: built?.skipped ?? [],
      workerOnly: built?.workerOnly ?? [],
      workerOnlyReasons: built?.workerOnlyReasons ?? {},
      browserCode: Object.values(built?.browser ?? {}).join("\n"),
      workerCode: Object.values(built?.worker ?? {}).join("\n"),
      browserFiles: Object.keys(built?.browser ?? {}).sort(),
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
    serverOnly: await serverOnly([
      "native-dep",
      "server-dep",
      "lazy-dep",
      "emitter-dep",
    ]),
    serverOnlyBesideABrokenDependency: await serverOnly([
      "broken",
      "server-dep",
    ]),
    serverEntry: await serverOnly([
      "@valbuild/tanstack",
      "@valbuild/tanstack/demo",
    ]),
    serverEntryBesideABrokenDependency: await serverOnly([
      "broken",
      "@valbuild/tanstack",
      "@valbuild/tanstack/demo",
    ]),
    unbuildableServerEntry: await serverOnly([
      "@valbuild/tanstack",
      "@valbuild/tanstack/server",
    ]),
  };
  console.log(JSON.stringify(result));
}

void main();
