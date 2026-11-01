/**
 * What it costs to get a project's schemas and content from its code without
 * a build: bundle `val.modules.ts` and what it imports (`bundleValModules`,
 * the function "update from the site with code" uses), then import the bundle
 * and read every module (`readValModules`'s steps). The plan's "evaluating
 * code after a write" runs this after every staging.
 *
 * In Node this bundles with NATIVE rolldown, as `val publish` and the
 * tanstack-build probes do (`src/__fixtures__/valModulesProbe.ts`, which this
 * follows). The Studio bundles with rolldown's WebAssembly build in a worker,
 * which is slower, so these are a floor for the browser, not its numbers.
 *
 * Not a test: it prints. Run from `scenarios/`:
 *
 *   pnpm exec tsx measure/evaluateValModules.ts /home/user/templates/tanstack/full
 */
import "../../packages/tanstack-build/src/__fixtures__/nativeBundler";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { performance } from "perf_hooks";
import { pathToFileURL } from "url";
import { bundleValModules } from "../../packages/tanstack-build/src/valModules";
import type { BuildTarget } from "../../packages/tanstack-build/src/contract";

const PACKAGES = path.resolve(__dirname, "../../packages");
const CORE = path.join(PACKAGES, "core/src/index.ts");

/** The project's source files, by path from its root: what a proposal holds. */
function projectFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|json|css)$/.test(name)) {
        files[path.relative(root, full)] = readFileSync(full, "utf8");
      }
    }
  };
  walk(root);
  return files;
}

/** A vendor chunk that re-exports a workspace package's own source, whole. */
async function vendorChunk(dir: string, name: string, entry: string) {
  const loaded = await import(entry);
  const names = Object.keys(loaded.default ?? loaded).filter((key) =>
    /^[A-Za-z_$][\w$]*$/.test(key),
  );
  writeFileSync(
    path.join(dir, "_pvendor", "r1", `${name}.js`),
    [
      // Run as CommonJS under tsx, so its names are read off the default.
      `import pkg from ${JSON.stringify(pathToFileURL(entry).href)};`,
      `export const { ${names.join(", ")} } = pkg;`,
      ``,
    ].join("\n"),
  );
}

async function once(files: Record<string, string>, origin: string, target: BuildTarget, dir: string, run: number) {
  const startBundle = performance.now();
  const { code } = await bundleValModules({ files, target, origin });
  const bundled = performance.now();
  const bundle = path.join(dir, `val.modules.${run}.mjs`);
  writeFileSync(bundle, code);
  const core = await import(CORE);
  const entry = await import(pathToFileURL(bundle).href);
  let count = 0;
  let bytes = 0;
  for (const { def } of entry.default.modules) {
    const module = (await def()).default;
    core.Internal.getSchema(module)["executeSerialize"]();
    const source = await core.Internal.resolveJsonValues(core.Internal.getSource(module));
    bytes += JSON.stringify(source).length;
    count++;
  }
  const evaluated = performance.now();
  return {
    bundleMs: Math.round(bundled - startBundle),
    evaluateMs: Math.round(evaluated - bundled),
    bundleKB: Math.round(code.length / 1024),
    modules: count,
    contentKB: Math.round(bytes / 1024),
  };
}

async function main() {
  const root = path.resolve(process.argv[2] ?? "");
  const files = projectFiles(root);
  const dir = mkdtempSync(path.join(tmpdir(), "val-measure-"));
  mkdirSync(path.join(dir, "_pvendor", "r1"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), `{ "type": "module" }`);
  await vendorChunk(dir, "valbuild__core", CORE);
  await vendorChunk(dir, "valbuild__tanstack", path.join(PACKAGES, "tanstack/src/index.ts"));
  await vendorChunk(dir, "valbuild__next", path.join(PACKAGES, "next/src/index.ts"));
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
      modules: {
        "@valbuild/core": "valbuild__core",
        "@valbuild/tanstack": "valbuild__tanstack",
        "@valbuild/next": "valbuild__next",
      },
      css: {},
      workerOnly: [],
    },
  };
  const origin = pathToFileURL(dir).href;
  const cold = await once(files, origin, target, dir, 1);
  const warm = await once(files, origin, target, dir, 2);
  process.stdout.write(
    `${JSON.stringify({ project: path.basename(path.dirname(root)) + "/" + path.basename(root), files: Object.keys(files).length, cold, warm })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
