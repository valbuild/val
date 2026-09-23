// A project's own vendor layer, built from its package.json.
//
// The base layer -- react, react-dom, the router, react-start -- has to stay
// global, because the natively-built shell imports it as `./vendor/react.js`
// and a single React instance in the isolate depends on the shell and the
// user's bundle naming the same module. Everything a project additionally
// declares is built here instead, once per project, *with the base layer as
// externals*: the same trick the architecture already uses, one level down.
//
// This is what makes "no new dependencies at publish time" a CI-time step a
// developer owns rather than a platform limitation. The layer changes when
// package.json does, which is rarely; publishing code against an existing layer
// stays a browser build and two KV writes.
//
// The risk this has to keep closing is not the plumbing. It is a project layer
// quietly bundling its own React instead of resolving into the base chunks --
// waste for a stateless helper, and for React the exact failure the whole
// architecture exists to prevent. It surfaces as broken hooks at runtime, not
// as a build error. `spike/vendorlayers` proves identity holds, against a
// deliberately duplicated negative control; the import audit below is the
// cheap check that runs every time.
import { build } from "rolldown";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BuildTarget } from "../contract";
import { nodeShims } from "./nodeShims";
import { parseAstAsync } from "rolldown/parseAst";

/**
 * Packages the base layer already provides.
 *
 * A project declares these and must -- `packages/verify` fails a project that
 * does not -- but they are supplied by the platform, so building them into a
 * project layer would be the duplication described above.
 */
export const BASE_PROVIDED = new Set([
  "react",
  "react-dom",
  "@tanstack/react-router",
  "@tanstack/react-start",
]);

/**
 * Chunk filename for a package.
 *
 * `@scope/name` becomes `scope__name`: a flat, filesystem-safe name, since
 * these are module-map keys and URL segments. A package literally named
 * `scope__name` would collide with a scoped one; that is unlikely enough to
 * take, and it would be caught here as a duplicate rather than silently.
 */
export const chunkNameFor = (specifier: string) =>
  specifier
    .replace(/^@/, "")
    .replace(/\//g, "__")
    .replace(/[^\w.-]/g, "-");

/**
 * Stub source for one project dependency.
 *
 * The *base* vendor build asks Node what a package exports and writes explicit
 * re-exports, because `export *` from an external CommonJS module yields no
 * static named exports. That reasoning does not carry here, and copying it is
 * actively wrong:
 *
 *   - These packages are bundled, not externalised, so rolldown resolves their
 *     named exports statically.
 *   - Node's `import()` resolves under Node's conditions; the bundle resolves
 *     under workerd's or the browser's. For a package with no `exports` map
 *     those are different files with different shapes -- `react-error-boundary`
 *     is exactly this, and the introspected stub fails with "Missing export".
 *
 * So the bundler does the resolving. The default export is derived at runtime
 * rather than probed, which keeps `import x from 'pkg'` working for CommonJS
 * packages; a package with genuinely no default hands back its namespace, which
 * is laxer than Vite but cannot fail the build.
 */
const stubSource = (specifier: string) =>
  `import * as __ns from ${JSON.stringify(specifier)}\n` +
  `export * from ${JSON.stringify(specifier)}\n` +
  `export default (__ns.default ?? __ns)\n`;

/**
 * Where each target's chunks address the base layer from.
 *
 * Module-map specifiers resolve against the *importing* module, so a project
 * chunk at `pvendor/zod.js` importing `./vendor/react.js` would look for
 * `pvendor/vendor/react.js` and fail at isolate startup. Hence `../vendor/`.
 * The browser has no such problem because its paths are absolute URLs.
 */
interface Target {
  name: "worker" | "browser";
  platform: "neutral" | "browser";
  conditions: Array<string>;
  mainFields?: Array<string>;
  /** Where THIS target's chunks address the base layer from. */
  baseFrom: string;
}

/**
 * The platform a layer is built against, as facts rather than as imports.
 *
 * This module used to read `@valbuild/vendor/externals` and
 * `@valbuild/vendor/resolve` directly, which is what kept it in the same
 * repository as the vendor package -- the same knot `BuildTarget` untied for
 * the browser builder, one level down. The facts have not changed and they are
 * still the platform's; they now ARRIVE.
 *
 * The three are separate because they answer at different times.
 * {@link base} crosses a wire, so it is data. The other two cannot: one
 * resolves against a node_modules that only the platform's own checkout has,
 * and the other is a directory in it. A host that has neither passes
 * `() => null` and `null`, and says so by doing it.
 */
export interface VendorPlatform {
  /** `BuildTarget.base`: the specifier map and the paths that read it. */
  base: BuildTarget["base"];
  /**
   * Where the PLATFORM's own copy of `specifier` is, as opposed to a project's.
   *
   * Null is the ordinary answer and not a failure: a project depends on plenty
   * the platform has never heard of, and those layer from the project's own
   * node_modules. What it is FOR is the `@tanstack/*` set, which has to agree
   * with the base layer version for version -- see `pinPlatformTanstack`.
   */
  resolvePlatformModule: (specifier: string) => string | null;
  /**
   * Where the built base layer's chunks are, or null when this checkout has
   * not built them.
   *
   * Only the export audit reads it, and only to check a named import against
   * the chunk it will link to. Null means that check is skipped, which is the
   * honest answer rather than a refusal -- see `baseChunkExports`.
   */
  baseLayerDir: string | null;
}

/**
 * Where each target's chunks address the base layer from.
 *
 * Module-map specifiers resolve against the *importing* module, so a project
 * chunk at `pvendor/zod.js` importing `./vendor/react.js` would look for
 * `pvendor/vendor/react.js` and fail at isolate startup. Hence `../vendor/`,
 * which the platform names as `paths.baseFromProject`. The browser has no such
 * problem because its paths are absolute URLs, so its prefix is a literal
 * here: it is a URL this package mints, not a path the platform owns.
 */
const targetsFor = (platform: VendorPlatform): Array<Target> => [
  {
    name: "worker",
    platform: "neutral",
    conditions: ["workerd", "worker", "import", "module", "default"],
    // The 'neutral' platform configures no main fields, so a package with no
    // `exports` map resolves to nothing and is silently left EXTERNAL -- a bare
    // specifier with no module-map entry, so the cold isolate refuses to boot.
    // The tell is a suspiciously tiny chunk re-exporting its own package name.
    mainFields: ["module", "main"],
    baseFrom: platform.base.paths.baseFromProject,
  },
  {
    name: "browser",
    platform: "browser",
    conditions: ["browser", "import", "module", "default"],
    baseFrom: "/_vendor/",
  },
];

export interface VendorLayer {
  rev: string;
  /**
   * Stylesheets a dependency ships, keyed by the specifier that imports them.
   *
   * `import 'react-day-picker/style.css'` is a bare specifier pointing at a
   * file in node_modules, and the browser build has no node_modules. Resolved
   * and read here, where there is one, and carried across with the layer --
   * the same trade as the code, and for the same reason.
   */
  css: Record<string, string>;
  /**
   * Specifiers built for the worker but not the browser.
   *
   * A server-only dependency is not a failure. `@valbuild/tanstack/server`
   * cannot build for a browser -- it reaches TanStack's SSR path, which lands
   * on `node:stream/web` -- and has no business in a client bundle either.
   * Dropping it entirely would mean such a package can never be layered, so it
   * is layered for the side that can use it, and the builder rejects a client
   * import of it by name.
   */
  workerOnly: Array<string>;
  /**
   * Why each `workerOnly` specifier failed its browser build.
   *
   * Reporting only, and deliberately not part of what a publish sends: the
   * builder needs to know a dependency is server-only, not why. But without
   * this the diagnosis stopped at "it could not be built for the browser",
   * which does not tell you whether to move the import or fix the package.
   */
  workerOnlyReasons: Record<string, string>;
  /**
   * Specifiers that could not be built, with the reason.
   *
   * Dropped rather than fatal, because a manifest lists things the app never
   * imports -- build plugins especially. `@tailwindcss/vite` is in the starter
   * template's `dependencies` and pulls a native `.node` binary; failing the
   * whole publish over a Vite plugin the isolate will never load would be
   * wrong. Anything the app *does* import still fails, at the verify gate,
   * naming the specifier.
   */
  skipped: Array<{ specifier: string; reason: string }>;
  /** Specifier -> chunk name, which is what the builder resolves imports with. */
  modules: Record<string, string>;
  /** Module-map entries for the isolate, keyed `pvendor/<file>`. */
  worker: Record<string, string>;
  /** Browser chunks, served under `/_pvendor/<rev>/`. */
  browser: Record<string, string>;
}

/** Digest of the dependency stylesheets, for the layer revision. */
const cssRev = (css: Record<string, string>) => {
  const entries = Object.entries(css).sort();
  if (entries.length === 0) return "";
  const digest = createHash("sha256");
  for (const [specifier, text] of entries) {
    digest.update(specifier);
    digest.update(text);
  }
  return digest.digest("hex").slice(0, 8);
};

/** Rolldown's errors run to dozens of lines of code frame; the first is enough. */
const firstLine = (message: string) =>
  message
    .split("\n")
    // An ANSI escape IS a control character; stripping them is the point.
    // eslint-disable-next-line no-control-regex
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim())
    .filter((line) => line && !/^[╭│╰─]/.test(line))
    .slice(0, 2)
    .join(" ")
    .slice(0, 220);

/**
 * A throwaway build, used only to find out whether a set of entries compiles.
 *
 * Worker target only: it is the stricter of the two (neutral platform, workerd
 * conditions), so anything that survives it is very unlikely to fail the
 * browser build for a reason worth attributing separately.
 */
async function buildTargets(
  names: Array<string> | { worker: Array<string>; browser: Array<string> },
  input: Record<string, string>,
  outRoot: string,
  quiet: boolean,
  platform: VendorPlatform,
) {
  const out: {
    worker: Record<string, string>;
    browser: Record<string, string>;
  } = {
    worker: {},
    browser: {},
  };
  const digest = createHash("sha256");

  for (const target of targetsFor(platform)) {
    const forTarget = Array.isArray(names) ? names : names[target.name];
    // Nothing for this side: a dependency can be server-only, and building an
    // empty bundle is both pointless and an error.
    if (forTarget.length === 0) continue;
    const dir = join(outRoot, target.name);
    /*
     * Cleared first, because this function EMITS WHATEVER IT FINDS HERE.
     *
     * `buildVendorLayer` calls it twice against the same directory: once with
     * every dependency, and again with the survivors when that fails and the
     * per-dependency probe has worked out which to drop. rolldown writes
     * before the import audit runs, so a first pass that fails IN THE AUDIT
     * has already left chunks on disk -- including the chunk for the
     * dependency about to be dropped.
     *
     * Left in place, the `readdir` below picks that chunk up again, so the
     * retry re-audits the very thing it exists to exclude and fails the same
     * way; and where the first pass failed for some other reason, the dropped
     * dependency's code is shipped and folded into `rev`. rolldown has no
     * `emptyOutDir`, so nothing else clears it.
     */
    await rm(dir, { recursive: true, force: true });
    // Before the build rather than inside the plugin list: the factory asks
    // Node what each builtin exports, which is async, and a plugin's own hooks
    // have to stay synchronous.
    const shims = await nodeShims(target.name === "worker");
    await build({
      input: Object.fromEntries(forTarget.map((name) => [name, input[name]!])),
      platform: target.platform,
      plugins: [
        externaliseBase(target.baseFrom, platform),
        pinPlatformTanstack(platform),
        stubStartEntries(),
        stubServerEntries(target.name === "browser"),
        // Worker only: a browser has no Node builtins to bridge to, and a
        // package reaching for one there is a real error rather than a missing
        // runtime.
        shims,
      ],
      transform: {
        define: {
          "process.env.NODE_ENV": JSON.stringify("production"),
          // CJS scope variables a bundled CommonJS package can reference at
          // module scope. The TypeScript compiler reads `__filename` while
          // deciding what host it is on, and an undefined reference there is a
          // startup crash rather than a failed feature check.
          //
          // `import.meta.url` is the same problem one module system along, and
          // it is worse because it kills the isolate rather than a feature
          // check: prettier's ESM build opens with `createRequire(import.
          // meta.url)` at module scope, and `createRequire(undefined)` throws
          // `The argument 'path' must be a file URL object...`. The isolate
          // then refuses to start and the request 500s, naming node:module and
          // a minified offset rather than the package.
          //
          // A URL rather than a path, because that is what the name promises
          // and what `createRequire` accepts. Nothing resolves against it --
          // there is no filesystem -- but a package that only wants a require
          // for a lazy optional dependency gets to load.
          ...(target.name === "worker"
            ? {
                __filename: JSON.stringify("/worker.js"),
                __dirname: JSON.stringify("/"),
                "import.meta.url": JSON.stringify("file:///worker.js"),
                /*
                 * There is no disk in here, and Val is the one dependency that
                 * assumes there is.
                 *
                 * It picks its storage mode by inference -- a content service
                 * when it finds an api key, the local filesystem otherwise --
                 * and the third mode, where the HOST hands over the source,
                 * cannot be inferred at all: it is chosen by passing
                 * `sourceFiles`, which only the app's own server file can do.
                 * `wireUp` writes that file, so a project the platform wired is
                 * already in the right mode.
                 *
                 * A project that brings its OWN server file is not, and the
                 * failure was `patch-error /bundle/.val/patches.lock: EPERM` --
                 * the isolate's read-only filesystem, named two layers below
                 * the decision that led there.
                 *
                 * So this says where the code is running and lets Val decide
                 * what that implies, rather than naming a Val mode. Which mode
                 * an isolate with no disk needs is Val's to know; that it IS an
                 * isolate with no disk is the only part the platform can
                 * actually vouch for, and the part that stays true if the modes
                 * are ever renamed or split. Harmless to every other
                 * dependency, and to a Val too old to look.
                 */
                "process.env.VAL_ENV": JSON.stringify("app"),
              }
            : {}),
        },
      },
      resolve: {
        conditionNames: target.conditions,
        ...("mainFields" in target ? { mainFields: target.mainFields } : {}),
      },
      output: {
        dir,
        format: "esm",
        entryFileNames: "[name].js",
        chunkFileNames: "_p-[hash].js",
        minify: true,
      },
      onLog(level, log, handler) {
        // Quiet during the attribution probes: they are *expected* to fail, and
        // the failures are reported afterwards with the specifier attached.
        if (quiet) return;
        // `__ns.default ?? __ns` warns for every package with no default
        // export, which is the case the fallback exists for -- see stubSource.
        if (log.code === "IMPORT_IS_UNDEFINED") return;
        /*
         * "use client" in a package being bundled for the worker.
         *
         * Every React package that ships the directive warns, once per module,
         * and TanStack's router alone accounts for a dozen. They are expected
         * and they are not actionable: this build has no client boundary to
         * preserve, the shell owns that split, and nothing here reads the
         * directive.
         *
         * Silenced because the noise did real harm. A successful publish ended
         * with twenty of these and the reader took it for a failed one -- the
         * line that says `published <project> @ <hash>` was the last of about
         * two hundred, and everything above it looked like an error.
         */
        if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
        /*
         * NOT silenced: UNRESOLVED_IMPORT. rolldown downgrades it to a warning
         * and externalises the specifier, which is how an unresolvable bare
         * import reaches the isolate and refuses to start. The audit below is
         * what turns it into an error, and the warning is worth seeing.
         */
        handler(level, log);
      },
    });

    for (const file of (await readdir(dir)).sort()) {
      const code = await readFile(join(dir, file), "utf8");
      // Part of the build, not a step after it. rolldown downgrades an
      // unresolved import to a *warning* and externalises it, so without this
      // a probe passes on a dependency the real build then rejects -- which is
      // how `prettier` (importing `node:module`) got as far as the audit.
      await auditImports(target, file, code, platform);
      // Worker entries are module-map keys and carry the directory; browser
      // entries are served under `/_pvendor/<rev>/` and do not.
      out[target.name][target.name === "worker" ? `pvendor/${file}` : file] =
        code;
      digest.update(`${target.name}/${file}`);
      digest.update(code);
    }
  }

  return { ...out, rev: digest.digest("hex").slice(0, 16) };
}

/**
 * Start's per-project `imports` subpaths, stubbed for the project layer.
 *
 * `@tanstack/start-server-core` dynamically imports the app's router and server
 * entry through these, and Start's Vite plugin fills them in per project. It is
 * not in the base layer -- the shell needs its own copy, with those resolved
 * for real -- so a project dependency that merely *reaches* start-server-core
 * has nothing to resolve them to and cannot be built at all.
 *
 * Stubbed here rather than left unresolved, because the dependency almost
 * certainly wants a request helper or the storage context, not a second Start
 * handler. If one really does create a handler, this throws with a message
 * saying so instead of failing the layer build with a bare specifier.
 */
const START_ENTRY_STUB = `
export function getRouter() {
  throw new Error(
    'A project dependency tried to create a TanStack Start handler. The platform ' +
      'shell is the handler here, so a dependency cannot create a second one.',
  )
}
export default { getRouter }
`;

const PER_PROJECT_ENTRIES = ["#tanstack-router-entry", "#tanstack-start-entry"];

/**
 * TanStack Start's server entries, for the BROWSER side of a project layer.
 *
 * Reaching these from a browser bundle is never right, and one real package
 * does it by accident. `@valbuild/tanstack`'s root entry -- the one its
 * components come from -- has, inside a server-only helper:
 *
 *     async function isValEnabled() {
 *       try {
 *         const { getCookie } = await import('@tanstack/react-start/server')
 *         ...
 *       } catch { return false }
 *     }
 *
 * At runtime in a browser that is already correct: the import fails, the catch
 * returns false, which is what the function's own documentation says it does
 * anywhere but a server. A bundler cannot know that. It follows the dynamic
 * import, pulls in Start's whole SSR path, lands on `node:stream`, and the
 * import audit rejects the chunk -- so the package is layered for the worker
 * only and every component that imports it fails PLATFORM404.
 *
 * Stubbing restores the runtime truth at build time. The module throws when
 * evaluated, so `await import(...)` rejects into the catch that is already
 * there, and a STATIC import of it -- which no correct browser code has --
 * fails loudly at load rather than silently shipping a server bundle.
 */
const SERVER_ENTRIES = [
  "@tanstack/react-start/server",
  "@tanstack/react-start-server",
  "@tanstack/start-server-core",
];

const SERVER_ENTRY_STUB = `
throw new Error(
  'TanStack Start\\'s server entry is not available in the browser. A project ' +
    'dependency reached it from client code; on this platform the shell owns ' +
    'the server side. If this came from a server-only branch guarded by ' +
    'try/catch, this is the failure it expects.',
)
`;

function stubServerEntries(browser: boolean) {
  const prefix = "\0platform:server-entry:";
  return {
    name: "platform:server-entries",
    resolveId(source: string) {
      if (!browser) return null;
      return SERVER_ENTRIES.includes(source) ? prefix + source : null;
    },
    load(id: string) {
      return id.startsWith(prefix) ? SERVER_ENTRY_STUB : null;
    },
  };
}

function stubStartEntries() {
  const prefix = "\0platform:start-entry:";
  return {
    name: "platform:start-entries",
    resolveId(source: string) {
      return PER_PROJECT_ENTRIES.includes(source) ? prefix + source : null;
    },
    load(id: string) {
      return id.startsWith(prefix) ? START_ENTRY_STUB : null;
    },
  };
}

/**
 * TanStack is the PLATFORM'S, all of it -- not just the half in the base layer.
 *
 * `externaliseBase` sends the specifiers in VENDOR_MODULES to the base chunks,
 * so a project's own `@tanstack/react-router` is already ignored. What it does
 * not cover is the rest of the family: `@tanstack/start-server-core` is
 * deliberately NOT vendored (it holds `createStartHandler`, which dynamically
 * imports the app's own entry -- see externals.js), so the project layer
 * bundled the PROJECT's copy of it, while that copy's imports of
 * `@tanstack/start-client-core` went to the base layer.
 *
 * TanStack ships those two in lockstep. Splitting the pair across two layers
 * pinned at different versions is a link error, and it is a link error in the
 * worst available place: the module is reached through
 * `await import('@tanstack/react-start/server')`, so nothing loads it until
 * something asks. The isolate starts, every page renders, and the first
 * request that touches a request helper answers
 *
 *     SyntaxError: The requested module '../vendor/tanstack-start-client-core.js'
 *     does not provide an export named 'getSerovalPlugins'
 *
 * from inside a Dynamic Worker, whose console reaches no tail stream. What a
 * user saw was a 500 on signing in and nothing else wrong with the site. The
 * project was two patch versions ahead of the base layer: start-server-core
 * 1.169.37 against start-client-core 1.170.30.
 *
 * So every `@tanstack/*` specifier the platform can resolve is resolved HERE,
 * from `@valbuild/vendor`'s own node_modules, and the project's copy is not
 * consulted. That is the contract PINS.md already states -- "the platform pins
 * these versions, so a project has to use the ones carried here" -- applied
 * rather than hoped for, and it is the same trade already made for react and
 * the router, extended to the packages that have to agree with them.
 *
 * What is NOT pinned falls through to the project, which is the common case
 * and the point: `@tanstack/react-devtools` and `@tanstack/react-router-devtools`
 * are ordinary project dependencies the platform does not carry, and they layer
 * from the project's node_modules exactly as any other dependency does.
 *
 * Ordered AFTER `externaliseBase`, which is what keeps the base set external:
 * rolldown takes the first plugin that answers, and a base specifier resolved
 * to a real file here would be bundled into the project layer instead -- a
 * second React, which is the one failure this whole architecture exists to
 * prevent.
 */
function pinPlatformTanstack(platform: VendorPlatform) {
  // Memoised because rolldown asks for the same specifier once per importer,
  // and resolution walks the filesystem.
  const resolved = new Map<string, string | null>();
  return {
    name: "platform:pin-platform-tanstack",
    resolveId(source: string) {
      if (!source.startsWith("@tanstack/")) return null;
      if (!resolved.has(source))
        resolved.set(source, platform.resolvePlatformModule(source));
      const id = resolved.get(source);
      // Null is the ordinary answer for a package the platform does not carry:
      // fall through, and the project's own copy is layered as usual.
      return id ? { id } : null;
    },
  };
}

/** Externalise every base-layer specifier to its chunk in the base layer. */
function externaliseBase(baseFrom: string, platform: VendorPlatform) {
  const { modules } = platform.base;
  return {
    name: "platform:externalise-base",
    resolveId(source: string) {
      // One line, and deliberately: `resolveVendor` in the platform's own
      // externals.js says exactly this. The RULE stays with the side that owns
      // the chunks; what crosses the wire is the map it reads.
      const chunk = modules[source];
      return chunk ? { id: `${baseFrom}${chunk}.js`, external: true } : null;
    },
  };
}

/**
 * Node builtins the Worker runtime provides.
 *
 * The isolate runs with node compat (implied by its compatibility date), so
 * these resolve at runtime and leaving them external is correct rather than a
 * hole. Without this the audit rejects them, and a dependency that touches
 * streams -- which on the server is most of them -- cannot be layered at all.
 *
 * A list rather than "anything starting with node:", because the point of the
 * audit is to catch specifiers that will *not* resolve. Both spellings: bare
 * `stream` and `node:stream` both occur in real packages, and node compat
 * accepts either.
 *
 * DO NOT EDIT THIS BY HAND FROM MEMORY. It is a claim about someone else's
 * runtime, and it was wrong for months in the expensive direction: it listed
 * twenty names, so `fs`, `os`, `vm`, `module`, `http` and `https` read as
 * unavailable, `@valbuild/tanstack/server` could not be layered, and the answer
 * looked like `--node-shims` -- a whole memory filesystem bundled into every
 * project to supply builtins the isolate already had. Ask the runtime instead:
 *
 *     curl -s localhost:8787/__api/builtins | jq .both
 *
 * That endpoint loads a Dynamic Worker at the loader's compatibility date and
 * imports each name, so its answer is the audit's ground truth. Re-run it when
 * the compatibility date moves.
 *
 * Resolving is not the same as working: workerd's `node:fs` has no disk behind
 * it and its calls fail at runtime. That is the right line for this audit all
 * the same -- it exists to catch an import that breaks the isolate at STARTUP,
 * which a resolvable builtin does not, and a dependency that genuinely needs a
 * filesystem is a problem no import list can catch.
 */
const RUNTIME_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

const isRuntimeBuiltin = (specifier: string) =>
  RUNTIME_BUILTINS.has(specifier.replace(/^node:/, ""));

/**
 * Every import a project chunk emits has to resolve inside the isolate: into
 * the base layer, at a sibling chunk, or at a Node builtin the runtime
 * provides. Anything else is a bare specifier with no module-map entry, and it
 * fails at *startup* rather than at build time -- so it is checked here, where
 * the cause is still in view.
 *
 * Parsed, not matched. This used to scan the emitted text with
 * `/from\s*["']([^"']+)["']/`, which also matches inside string literals -- and
 * TypeScript's diagnostic messages contain
 * `Consider using 'import * as ns from "mod"'`. So bundling the TypeScript
 * compiler was rejected for importing a package called `mod`, which does not
 * exist and which nothing imported. `prettier` was rejected the same way. Both
 * looked exactly like a genuine unresolvable dependency.
 */
interface AuditableImport {
  /** The specifier, exactly as emitted. */
  source: string;
  /**
   * The names taken from it, as the OTHER module has to export them.
   *
   * `import { a as b }` and `export { a as b } from` both want `a`. A default
   * import wants `default`. A namespace import wants nothing in particular, so
   * it contributes no names -- and `export * from` cannot be checked this way
   * either, which is fine: neither can fail to link.
   */
  names: Array<string>;
}

interface ModuleStatement {
  type: string;
  source?: { value?: unknown } | null;
  specifiers?: Array<{
    type: string;
    imported?: { type?: string; name?: string; value?: unknown } | null;
    local?: { type?: string; name?: string } | null;
    exported?: { type?: string; name?: string } | null;
  }>;
  declaration?: {
    type?: string;
    id?: { name?: string } | null;
    declarations?: Array<{ id?: { type?: string; name?: string } | null }>;
  } | null;
}

const nameOf = (node: { name?: string; value?: unknown } | null | undefined) =>
  typeof node?.name === "string"
    ? node.name
    : typeof node?.value === "string"
      ? // `import { "a-b" as c } from` -- a string module-export-name.
        node.value
      : null;

const parseModule = async (code: string, file: string) =>
  (await parseAstAsync(code, { lang: "js" }, file)) as unknown as {
    body: Array<ModuleStatement>;
  };

/** Every import and re-export a chunk emits, with the names it takes. */
export async function auditableImports(
  code: string,
  file: string,
): Promise<Array<AuditableImport>> {
  const ast = await parseModule(code, file);
  const imports: Array<AuditableImport> = [];
  for (const statement of ast.body) {
    if (
      statement.type !== "ImportDeclaration" &&
      statement.type !== "ExportNamedDeclaration" &&
      statement.type !== "ExportAllDeclaration"
    ) {
      continue;
    }
    const source = statement.source?.value;
    if (typeof source !== "string") continue;
    const names: Array<string> = [];
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type === "ImportDefaultSpecifier") names.push("default");
      else if (specifier.type === "ImportSpecifier") {
        const name = nameOf(specifier.imported);
        if (name) names.push(name);
      } else if (specifier.type === "ExportSpecifier") {
        // Re-export: the name wanted from the OTHER module is the local one.
        const name = nameOf(specifier.local);
        if (name) names.push(name);
      }
      // ImportNamespaceSpecifier contributes nothing: a namespace object links
      // whatever is there.
    }
    imports.push({ source, names });
  }
  return imports;
}

export async function auditableSpecifiers(
  code: string,
  file: string,
): Promise<Array<string>> {
  return (await auditableImports(code, file)).map((entry) => entry.source);
}

/**
 * What a BASE-layer chunk actually exports.
 *
 * Null means "could not be determined, do not check" -- the artifacts are not
 * built, or the chunk re-exports from somewhere this does not follow. A check
 * that cannot be made has to say so rather than report an empty set, which
 * would fail every import into that chunk.
 */
async function baseChunkExports(
  target: Target,
  specifier: string,
  platform: VendorPlatform,
): Promise<Set<string> | null> {
  const dist = platform.baseLayerDir;
  if (!dist) return null;
  const file = join(
    dist,
    target.name,
    "vendor",
    specifier.slice(target.baseFrom.length),
  );
  let code: string;
  try {
    code = await readFile(file, "utf8");
  } catch {
    return null;
  }
  const ast = await parseModule(code, file);
  const exported = new Set<string>();
  for (const statement of ast.body) {
    if (statement.type === "ExportAllDeclaration") {
      // `export * from` somewhere this does not follow: anything could be in
      // there, so checking would produce false refusals.
      return null;
    }
    if (statement.type === "ExportDefaultDeclaration") {
      exported.add("default");
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") continue;
    for (const specifierNode of statement.specifiers ?? []) {
      const name = nameOf(specifierNode.exported);
      if (name) exported.add(name);
    }
    // `export const x = ...` / `export function x() {}`, which a hand-written
    // chunk can carry even though a bundled one usually does not.
    const declaration = statement.declaration;
    if (declaration?.id?.name) exported.add(declaration.id.name);
    for (const declarator of declaration?.declarations ?? []) {
      if (declarator.id?.type === "Identifier" && declarator.id.name) {
        exported.add(declarator.id.name);
      }
    }
  }
  return exported;
}

async function auditImports(
  target: Target,
  file: string,
  code: string,
  platform: VendorPlatform,
) {
  for (const { source: specifier, names } of await auditableImports(
    code,
    file,
  )) {
    const intoBase = specifier.startsWith(target.baseFrom);
    const intoSelf =
      specifier.startsWith("./") || specifier.startsWith("../pvendor/");
    // Only the worker target: a browser has no Node builtins, and a chunk that
    // reached for one there is a genuine error rather than a runtime import.
    const builtin = target.name === "worker" && isRuntimeBuiltin(specifier);
    if (!intoBase && !intoSelf && !builtin) {
      throw new Error(
        `${target.name}/${file} imports '${specifier}', which is neither a base-layer chunk, ` +
          `a sibling, nor a Node builtin the runtime provides. It would be an unresolvable ` +
          `bare specifier in the isolate.`,
      );
    }
    if (intoBase && names.length) {
      await auditBaseExports(target, file, specifier, names, platform);
    }
  }
}

/**
 * RESOLVING IS NOT LINKING, and the gap between them cost a day.
 *
 * The check above asks whether a specifier will resolve. A base chunk always
 * does -- it is in the module map by construction -- so an import into the
 * base layer used to be waved through whatever it asked for. But an ES module
 * links by NAME, and the base layer is built from the platform's pinned
 * versions while a project's chunks are built from the project's: ask for an
 * export the platform's copy does not have and the isolate throws
 *
 *     SyntaxError: The requested module '../vendor/tanstack-start-client-core.js'
 *     does not provide an export named 'getSerovalPlugins'
 *
 * at the moment that module is first imported. `pinPlatformTanstack` closes
 * the case that produced that line, and this closes the CLASS: it holds for
 * any package pair the base layer splits, for a project that reaches a vendored
 * package directly, and for the next version of this that nobody has thought
 * of. PINS.md records the same failure once before, on
 * `createServerHistory` -- both would have been refused here.
 *
 * It matters most where it is least visible. A statically imported chunk fails
 * at isolate STARTUP, which is loud. A chunk behind `await import(...)` --
 * which is how `@valbuild/tanstack` reaches TanStack's server half -- fails on
 * whichever request first touches it, so the site serves every page, and one
 * endpoint answers 500 forever.
 */
async function auditBaseExports(
  target: Target,
  file: string,
  specifier: string,
  names: Array<string>,
  platform: VendorPlatform,
) {
  const exported = await baseChunkExports(target, specifier, platform);
  if (!exported) return;
  const missing = names.filter((name) => !exported.has(name));
  if (missing.length === 0) return;
  throw new Error(
    `${target.name}/${file} imports ${missing.map((name) => `'${name}'`).join(", ")} from ` +
      `'${specifier}', which the base layer does not export. The base layer is built from the ` +
      `platform's pinned versions (packages/vendor/package.json, and PINS.md for why they are ` +
      `exact), so this is a project resolving a version of that package which disagrees with ` +
      `the platform's. It would link in the isolate only until something imported it, and then ` +
      `throw "does not provide an export named '${missing[0]}'".`,
  );
}

/** Bare specifiers that point at a stylesheet rather than a module. */
export function cssSpecifiersOf(files: Record<string, string>) {
  const found = new Set<string>();
  for (const [path, code] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) continue;
    for (const match of code.matchAll(
      /(?:from|import)\s*["']([^"'.][^"']*\.css)["']/g,
    )) {
      found.add(match[1]!);
    }
  }
  return [...found];
}

/** The package a bare specifier belongs to. `@scope/pkg/sub` -> `@scope/pkg`. */
export function packageOf(specifier: string) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/** Bare specifiers imported anywhere in the project's own source. */
function importedSpecifiers(files: Record<string, string>) {
  const found = new Set<string>();
  // A regex rather than a parse: this runs over every file in the project and
  // only needs the specifier, which is unambiguous in both forms. A false
  // positive costs one unused chunk; the builder's own resolver is what
  // actually decides, and it reports anything this missed.
  const IMPORT =
    /(?:from|import)\s*["']([^"'.][^"']*)["']|import\s*\(\s*["']([^"'.][^"']*)["']/g;
  for (const [path, code] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) continue;
    for (const match of code.matchAll(IMPORT)) {
      const specifier = match[1] ?? match[2];
      if (specifier && !specifier.startsWith("#")) found.add(specifier);
    }
  }
  return found;
}

/**
 * What the layer has to carry: every specifier the project imports, not every
 * package it declares.
 *
 * Specifiers rather than package names, because a subpath is a different entry
 * point with a different module graph -- the starter template imports
 * `@valbuild/tanstack`, `@valbuild/tanstack/client` *and*
 * `@valbuild/tanstack/server`, and a layer built from package names alone
 * resolves one of the three.
 *
 * Intersected with the manifest, so a typo'd import does not silently become a
 * layer entry and an undeclared dependency still fails the verify gate.
 */
export function layerDepsOf(
  manifest: { dependencies?: Record<string, string> },
  files: Record<string, string> = {},
): Array<string> {
  // Declared dependencies only: a devDependency is tooling, and bundling it
  // into what the isolate loads would be both wasteful and surprising.
  const declared = new Set(
    Object.keys(manifest.dependencies ?? {}).filter(
      (name) => !BASE_PROVIDED.has(name),
    ),
  );

  const specifiers = new Set<string>();
  // Packages reached only for a stylesheet. Those are collected as text by
  // collectDependencyCss; building them as code entries fails, because a
  // package like that may have no JS entry point at all.
  const cssOnly = new Set<string>();

  for (const specifier of importedSpecifiers(files)) {
    const pkg = packageOf(specifier);
    if (!declared.has(pkg) || BASE_PROVIDED.has(pkg)) continue;
    if (specifier.endsWith(".css")) {
      cssOnly.add(pkg);
      continue;
    }
    specifiers.add(specifier);
  }

  // A declared dependency nothing imports still gets an entry, so that a
  // project can add one and import it from the studio without a CI round-trip.
  for (const name of declared) {
    if (cssOnly.has(name)) continue;
    if (![...specifiers].some((specifier) => packageOf(specifier) === name))
      specifiers.add(name);
  }

  return [...specifiers].sort();
}

/**
 * Scratch directory for the entry stubs.
 *
 * Inside the project, not in the system temp dir, and that is load-bearing
 * rather than tidy: a stub is resolved from where it sits, so one in /tmp finds
 * no node_modules at all and every dependency is silently left external. The
 * import audit turns that into an error, but the fix is to put the stubs where
 * the project's own installed versions are -- which is also the only correct
 * place, since the layer is meant to carry exactly what the project resolves.
 */
const STUB_DIR = ".platform-vendor-stubs";

/**
 * Builds the layer, from the dependencies installed in `dir`.
 *
 * Returns `null` when the project declares nothing beyond the base set, which
 * is the same thing as having no layer -- not an empty one, because the head
 * pointer distinguishes "no layer" from "a layer that is missing".
 */
/**
 * Reads the stylesheets a project imports from its dependencies.
 *
 * Separate from the code build: these are not bundled, they are concatenated
 * into the project's stylesheet by the builder's CSS pass. Resolution is the
 * project's own, so the version matches whatever its lockfile pinned.
 */
export async function collectDependencyCss(
  dir: string,
  specifiers: Array<string>,
) {
  if (specifiers.length === 0) return {};
  const require = createRequire(join(resolve(dir), "package.json"));

  const css: Record<string, string> = {};
  for (const specifier of specifiers) {
    try {
      css[specifier] = await readFile(require.resolve(specifier), "utf8");
    } catch {
      // Left out rather than fatal: the builder reports the unresolved import
      // itself, naming the specifier, which is the better error.
    }
  }
  return css;
}

export async function buildVendorLayer(
  dir: string,
  deps: Array<string>,
  css: Record<string, string>,
  platform: VendorPlatform,
): Promise<VendorLayer | null> {
  if (deps.length === 0 && Object.keys(css).length === 0) return null;

  // Stylesheets but no code: a project can depend on a package for its CSS
  // alone. There is nothing to bundle, but the layer still has to exist so the
  // browser build has the text.
  if (deps.length === 0) {
    return {
      rev: cssRev(css),
      modules: {},
      worker: {},
      browser: {},
      css,
      skipped: [],
      workerOnly: [],
      workerOnlyReasons: {},
    };
  }
  const modules: Record<string, string> = {};
  for (const specifier of deps) {
    const name = chunkNameFor(specifier);
    const clash = Object.entries(modules).find(
      ([, existing]) => existing === name,
    );
    if (clash) {
      throw new Error(
        `'${specifier}' and '${clash[0]}' both map to the chunk name '${name}'. ` +
          `Rename is not an option, so this needs chunkNameFor to disambiguate.`,
      );
    }
    modules[specifier] = name;
  }

  // `resolve` rather than `join`, and the CLI's own default argument is why.
  //
  // A stub's path becomes a rolldown entry, and rolldown resolves a relative
  // entry against its own working directory rather than this one. `platform-
  // publish .` -- the usage line in cli.ts, and the natural thing to type --
  // made every entry `.platform-vendor-stubs/<name>.js`, which resolved
  // nowhere, so EVERY dependency failed with UNRESOLVED_ENTRY and the project
  // was reported as declaring nothing beyond the base set. The per-dependency
  // retry then repeated the same failure once per dependency, which reads as
  // nine unrelated problems rather than one.
  //
  // Nothing caught it because every caller that existed passed an absolute
  // path: the suites all build in a mkdtemp. The one caller that does not is
  // the one a person uses.
  const stubs = join(resolve(dir), STUB_DIR);
  await rm(stubs, { recursive: true, force: true });
  await mkdir(stubs, { recursive: true });
  try {
    const input: Record<string, string> = {};
    for (const [specifier, name] of Object.entries(modules)) {
      const file = join(stubs, `${name}.js`);
      await writeFile(file, stubSource(specifier));
      input[name] = file;
    }

    // Fast path: one build with every entry, so shared code is shared. When it
    // fails, rolldown reports against a file deep inside a package rather than
    // against the entry that pulled it in, so the only way to learn *which*
    // dependency is at fault is to try them one at a time.
    const skipped: Array<{ specifier: string; reason: string }> = [];
    /** Built for the worker but not the browser: server-only dependencies. */
    const workerOnly: Array<string> = [];
    /** Why each of those failed its browser build. Reporting only. */
    const workerOnlyReasons: Record<string, string> = {};
    const specifierOf = (chunk: string) =>
      Object.entries(modules).find(([, name]) => name === chunk)![0];

    let usable = Object.values(modules);
    let built = await buildTargets(
      usable,
      input,
      join(stubs, "out"),
      false,
      platform,
    ).catch(() => null);

    if (!built) {
      usable = [];
      for (const name of Object.values(modules)) {
        // Probed per target, because the two sides are not the same question.
        // `@valbuild/tanstack/server` cannot build for a browser -- it reaches
        // TanStack's SSR path, which lands on `node:stream/web` -- and it has no
        // business being in a browser bundle either. Failing it outright would
        // mean a server-only dependency can never be layered at all, so a
        // package that builds for the worker and not the browser is kept as
        // server-only, and importing it from client code is rejected later by
        // the builder, naming it.
        const worked: Record<string, boolean> = {};
        const reasons: Array<string> = [];
        for (const target of targetsFor(platform)) {
          try {
            await buildTargets(
              {
                worker: target.name === "worker" ? [name] : [],
                browser: target.name === "browser" ? [name] : [],
              },
              input,
              join(stubs, "probe", target.name, name),
              true,
              platform,
            );
            worked[target.name] = true;
          } catch (error) {
            worked[target.name] = false;
            reasons.push(firstLine(String((error as Error)?.message ?? error)));
          }
        }
        if (worked.worker && worked.browser) usable.push(name);
        else if (worked.worker) {
          usable.push(name);
          workerOnly.push(specifierOf(name));
          // Kept, because throwing it away is what made this class of failure
          // undebuggable. `workerOnly` says a dependency is server-only and
          // PLATFORM404 says importing it from a component is an error, and
          // between them they never said WHY it could not be built for a
          // browser -- which is the only thing that tells you whether to change
          // the import or fix the package.
          if (reasons[0]) workerOnlyReasons[specifierOf(name)] = reasons[0];
        } else {
          skipped.push({
            specifier: specifierOf(name),
            reason: reasons[0] ?? "build failed",
          });
        }
      }
      for (const [specifier, name] of Object.entries(modules)) {
        if (!usable.includes(name)) delete modules[specifier];
      }
      // Everything failed: a layer with no entries is the same as no layer, and
      // the skip list is what the caller reports.
      if (usable.length === 0) {
        return {
          rev: "none",
          modules: {},
          worker: {},
          browser: {},
          css,
          skipped,
          workerOnly,
          workerOnlyReasons,
        };
      }
      built = await buildTargets(
        {
          worker: usable,
          browser: usable.filter(
            (name) => !workerOnly.includes(specifierOf(name)),
          ),
        },
        input,
        join(stubs, "out"),
        false,
        platform,
      );
    }

    // The revision covers the stylesheets too: changing one is a different
    // dependency set, and the build hash folds in the revision rather than the
    // contents.
    return {
      rev: `${built.rev}${cssRev(css) ? `-${cssRev(css)}` : ""}`,
      modules,
      worker: built.worker,
      browser: built.browser,
      css,
      skipped,
      workerOnly,
      workerOnlyReasons,
    };
  } finally {
    await rm(stubs, { recursive: true, force: true });
  }
}
