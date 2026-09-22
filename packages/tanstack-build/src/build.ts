import { build } from "@rolldown/browser";
import type { BuildTarget } from "./contract";
import { ENTRY } from "./projectPaths";
import { dirname, resolve, resolveInFiles } from "./paths";
import {
  REGISTRY_ID,
  REGISTRY_REEXPORT,
  REGISTRY_SOURCE,
  rscEntrySource,
  transformServerFns,
} from "./serverFns";
import { collectCss, isCss } from "./css";
import { cssModuleExports, isCssModule } from "./cssModules";
import {
  compileTailwind,
  usesTailwind,
  type CssModuleLoader,
} from "./tailwind";
import { assetModule, isAsset, resolveAsset } from "./assets";
import { sha256Hex } from "./hash";
import { transformEnvMarkers } from "./envTransforms";
import { transformRouteNodes } from "./routeNodes";
import { aliasMap, type AliasMap } from "./tsconfigPaths";
import {
  isRouteFile,
  parseSplitRequest,
  type RouteSplitter,
} from "./routeSplit";
import {
  clientModuleRegistry,
  clientReferenceStub,
  collectClientModules,
  type ClientModule,
} from "./clientRefs";

// Re-exported so a caller that gathers a project's files knows which of them
// are assets, without duplicating the list.
export { isAsset, INLINE_LIMIT, base64Bytes } from "./assets";
export {
  fetchBuildTarget,
  fetchBuildTargetRev,
  type BuildTargetRequest,
} from "./buildTarget";
// Re-exported because `BuildInput.target` is one: a caller that has to build
// the parameter should not have to depend on a second package to name its
// type.
export type { BuildTarget, BuildTargetRev } from "./contract";
export type { CssModuleLoader, LoadedCssModule } from "./tailwind";
export type { RouteSplitter } from "./routeSplit";
/*
 * `src/app.tsx` was declared twice, once here and once in what was
 * `@valbuild/wire/paths`, because the builder and the wiring were separate
 * packages that both had to name it. They are one package now, so there is one
 * declaration -- and the one that is not the builder's, because the fact is a
 * property of the PROJECT layout rather than of the build.
 */
export { ENTRY, ROUTES_DIR, TREE } from "./projectPaths";

/**
 * Filename of the entry chunk, in every target.
 *
 * Fixed rather than hashed because it is addressed by name from outside the
 * build: `app.js` in the isolate's module map, `/_app/app.js` from the shell's
 * client half. Everything the build splits off is content-addressed instead.
 */
export const ENTRY_CHUNK = "app.js";

/**
 * The RSC build's entry, which is not the app's.
 *
 * See `rscEntrySource`: the rsc environment exists to host server functions,
 * and compiling the route tree under `react-server` breaks on the first
 * component that uses a hook or a context.
 */
const RSC_ENTRY_ID = "\0platform:rsc-entry";

/** The shared vendor layer, as seen from `rsc/app.js` one directory down. */
/**
 * The platform's externalisation rules, as DATA rather than as an import.
 *
 * This module used to read `@valbuild/vendor/externals` at compile time, which
 * meant a builder could only ever be built in the same repository as the
 * vendor package it read. It now gets the same facts from the `BuildTarget`
 * the caller hands it -- `GET /__api/build-target` on the loader, or
 * `GET /v1/build-target` on content -- which is what makes the builder
 * movable, and is the whole point of the `build-target` chunk.
 *
 * The resolvers are one line each, deliberately: the RULE stays with the side
 * that owns the chunks (`resolveVendor` in externals.js says the same thing),
 * and what crosses the wire is the map it reads. A function cannot cross a
 * wire; a `Record<string, string>` can.
 */
function vendorRules(target: BuildTarget) {
  const { modules, rscModules, paths } = target.base;
  const chunk = (
    map: Record<string, string>,
    specifier: string,
    base: string,
  ) => (map[specifier] ? `${base}${map[specifier]}.js` : null);
  return {
    paths,
    isBase: (specifier: string) => specifier in modules,
    isRsc: (specifier: string) => specifier in rscModules,
    base: (specifier: string, from: string) => chunk(modules, specifier, from),
    rsc: (specifier: string, from: string) =>
      chunk(rscModules, specifier, from),
    /** Everything externalised, which the build lists as `external`. */
    specifiers: Object.keys(modules),
    rscSpecifiers: Object.keys(rscModules),
  };
}

type VendorRules = ReturnType<typeof vendorRules>;

const BASE_FROM_RSC = "../vendor/";

/**
 * The RSC runtime, as the ssr and client builds see it.
 *
 * A module defining a server function that renders a server component imports
 * the runtime at module scope, and that module is also in the other two graphs
 * -- the route that calls the server function imports it. Only the rsc build
 * can supply the real thing, so the others get stubs.
 *
 * Throwing rather than no-op: under RSC these are never reached, because Start
 * routes every server function call to the rsc environment. If one *is*
 * reached, it means the build was published without `rsc`, and a clear error
 * beats a silent undefined.
 */
const RSC_RUNTIME_STUB_ID = "\0platform:rsc-runtime-stub";

const RSC_RUNTIME_STUB = `
const outsideRsc = (name) => () => {
  throw new Error(
    name + '() needs the React Server Components build. This project was built ' +
      'without it, so there is no rsc bundle for the server function to run in.',
  )
}
export const renderServerComponent = outsideRsc('renderServerComponent')
export const createCompositeComponent = outsideRsc('createCompositeComponent')
export const CompositeComponent = outsideRsc('CompositeComponent')
`;

/**
 * A stylesheet imported from a dependency, as the *JS* graph sees it.
 *
 * It contributes to the page's CSS and nothing to its JavaScript, so the module
 * is empty -- the same treatment a relative `.css` import gets from
 * `moduleTypes`, which matches on extension and so does not cover a bare
 * specifier. Returning an id that still ends in `.css` would make rolldown try
 * to parse the empty module as CSS.
 */
const DEPENDENCY_CSS_ID = "\0platform:dependency-css";

/**
 * Marks a resolved id as a CSS module's name mapping.
 *
 * The id deliberately does NOT end in `.css`. `moduleTypes` picks a module's
 * type by extension, so `\0platform:css-module:card.module.css` is treated as CSS
 * and emptied -- the import then yields `undefined` and the component crashes
 * on `styles.card` at render time, not at build time. An index keeps the
 * extension out of the id entirely.
 */
/**
 * Marks a resolved id as the deferred half of a split route.
 *
 * Targets first and the path last, so the id never ends in `.tsx`:
 * `moduleTypes` picks a module's type by extension and would otherwise decide
 * what this module is. That trap has cost three bugs in this codebase already.
 */
const SPLIT_PREFIX = "\0platform:tsr-split:";

/**
 * The project file a module id came from.
 *
 * A split module's id is virtual, but its *contents* came out of a route file
 * and its relative imports are written relative to that file. Resolving them
 * against the virtual id instead gives a path that is not in the project, and
 * the build fails on every import the deferred half carried with it.
 */
const sourcePathOf = (id: string | undefined) => {
  if (!id) return "";
  if (!id.startsWith(SPLIT_PREFIX)) return id;
  const rest = id.slice(SPLIT_PREFIX.length);
  return rest.slice(rest.indexOf(":") + 1);
};

const CSS_MODULE_PREFIX = "\0platform:css-module:";

/** `./a.module.css?inline` -> `./a.module.css`. */
const withoutCssQuery = (path: string) => path.split("?")[0]!;

/** Marks a resolved id as an asset rather than a source file. */
const ASSET_PREFIX = "\0platform:asset:";

/**
 * Where `import css from './styles.css?url'` resolves to.
 *
 * One URL for the whole project, because the CSS pass concatenates every
 * stylesheet into one -- so whichever sheet is asked for by URL, the answer is
 * the same file. The loader serves it, and skips its own <head> injection when
 * the project links it (see `linksOwnCss` on the build).
 */
const CSS_URL = "/_app/app.css";
const CSS_URL_ID = "\0platform:css-url";

/**
 * Env vars whose names start with this are inlined into the *client* bundle as
 * well as the server one, and are therefore public: anyone can read them from
 * the served JavaScript. Everything else is inlined only server-side.
 *
 * An explicit prefix rather than a separate list, so the exposure of a variable
 * is visible at every use site in the user's code.
 */
/**
 * The project's own source, importable by the app that is made from it.
 *
 * `import { FILES } from 'platform:project-source'` -- how a host hands a CMS its
 * content when there is no filesystem to read it from. Val's in-memory store is
 * the case this exists for.
 *
 * Emitted by the BUILD, from the same record the build is made of, and that is
 * the whole point. It used to be a chunk of the project's VENDOR LAYER, which
 * made it dependency-shaped: the layer changes when `package.json` does, so a
 * publisher reusing a layer by reference -- which is every publish from the
 * studio tab, because a tab cannot build one -- shipped new code beside a
 * frozen copy of the source. The symptom was precise and awful: the edit WAS in
 * the client bundle, so the page hydrated with the new content, while anything
 * read on the SERVER (`head` metadata, a redirect) still saw the source as it
 * was at the last CLI publish.
 *
 * Server-side only. A client bundle carrying every source file of the project
 * would be both a leak and, for a real app, enormous.
 */
export const PROJECT_SOURCE = "platform:project-source";
const PROJECT_SOURCE_ID = "\0platform:project-source";

export const PUBLIC_PREFIX = "PUBLIC_";

const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface BuildInput {
  /** Virtual file tree, keyed by posix path relative to the project root. */
  files: Record<string, string>;
  /**
   * The platform this build targets: its base layer, and this project's.
   *
   * Replaces `vendorRev` and `projectVendor`, which were the same two facts
   * arriving separately -- and which left the third fact, the externalisation
   * rules, to be imported at COMPILE TIME from `@valbuild/vendor/externals`.
   * A builder that reads those can only be built in the platform's own
   * repository. Taking them as a parameter is what lets the Studio carry one.
   *
   * `GET /__api/build-target` on the loader answers this shape, and
   * `GET /v1/build-target` on content proxies it.
   */
  target: BuildTarget;
  /** Project env vars, inlined at build time. See PUBLIC_PREFIX. */
  env?: Record<string, string>;
  /**
   * Files under `public/`, base64-encoded, keyed by project-relative path.
   *
   * Different from `assets` in the way that matters: these are never imported,
   * so nothing in the module graph refers to them and their *path* is the
   * contract. `public/favicon.ico` is requested as `/favicon.ico`, which is why
   * they cannot be content-addressed the way an imported asset is.
   */
  publicFiles?: Record<string, string>;
  /**
   * Binary assets, base64-encoded, keyed by project-relative path.
   *
   * Separate from `files` because that map is text. Small ones become data
   * URIs; larger ones are published and served, which is why the build reports
   * back which it kept.
   */
  assets?: Record<string, string>;
  /**
   * What `platform:project-source` resolves to, when the app imports it.
   *
   * Defaults to {@link files}. Passed separately because `files` may carry
   * GENERATED entries -- a file-based project's route tree and entry shim are
   * added before the build -- and handing those to a CMS as though they were
   * the project's own content is how a generated file ends up published back
   * as source.
   */
  projectSource?: Record<string, string>;
  /**
   * Splits route files: Start's `autoCodeSplitting`.
   *
   * A capability rather than something the builder does, because the split is
   * @babel/core's and does not run in a browser. Absent, routes are not split
   * -- which costs bundle size, not behaviour. See route-split.ts.
   */
  routeSplitter?: RouteSplitter;
  /**
   * Resolves and evaluates a JS module for Tailwind's `@plugin` / `@config`.
   *
   * A capability rather than something the builder can do: it needs real module
   * resolution. `packages/publish` supplies one; a browser build does not, and
   * a project using those directives fails there rather than losing its styles
   * silently.
   */
  loadCssModule?: CssModuleLoader;
  /**
   * Also build for React Server Components.
   *
   * A third pass over the same files, resolving React from the `react-server`
   * layer. Off by default: it costs a build and produces a bundle nothing will
   * load unless the project actually renders server components.
   */
  rsc?: boolean;
}

export interface BuildOutput {
  /** ESM module for the Dynamic Worker module map, at key `app.js`. */
  serverCode: string;
  /** ESM module served as the asset `/_app/app.js`. */
  clientCode: string;
  /**
   * Everything the build split off, keyed by content-addressed filename.
   *
   * Empty for an app with no dynamic imports, which is most of them. The names
   * are what the entry imports, relatively, so they double as module-map keys
   * on the server and as paths under `/_app/` in the browser.
   */
  serverChunks: Record<string, string>;
  clientChunks: Record<string, string>;
  /** As above, for the rsc bundle. Keyed without the `rsc/` prefix. */
  rscChunks?: Record<string, string>;
  /**
   * Files served at the root path, base64, keyed by URL path without the
   * leading slash (`favicon.ico`, `val/logo.svg`).
   */
  publicFiles: Record<string, string>;
  /**
   * Assets too large to inline, base64, keyed by their content-addressed name.
   *
   * Served under `/_app/a/`. Empty for a project whose assets all fit under the
   * inline limit, which for an app with a few icons is usually all of them.
   */
  assetFiles: Record<string, string>;
  /** Concatenated stylesheet, served as `/_app/app.css`. Empty when unused. */
  cssCode: string;
  /**
   * Whether the project imported its stylesheet by URL and links it itself.
   *
   * The loader injects a `<link>` for projects that do not, because with
   * file-based routing the user owns `<head>` and the shell has nowhere to
   * write. A project using `?url` has already done it, and injecting a second
   * one is a duplicate request for the same file.
   */
  linksOwnCss: boolean;
  /** `"use client"` modules found, when `rsc` was requested. */
  clientModules?: Array<{ id: string; path: string; exports: Array<string> }>;
  /**
   * ESM module for the module-map key `rsc/app.js`, when `rsc` was requested.
   *
   * A separate key rather than a variant of `app.js`, because the RSC shell
   * entry lives in `rsc/` and so its `./app.js` resolves there -- the two user
   * builds coexist in one map without either knowing about the other.
   */
  rscCode?: string;
  hash: string;
  vendorRev: string;
  /** Wall-clock milliseconds per phase; the number the whole design lives on. */
  timings: { server: number; client: number; tailwind: number; total: number };
  warnings: Array<string>;
}

/**
 * Resolves the user's file tree and hard-externalises everything else.
 *
 * There is deliberately no node_modules resolution here. Every dependency is a
 * vendor external, so the build graph is exactly the user's own files, which is
 * what keeps this fast enough to run on every publish and why the browser build
 * needs no virtual filesystem at all.
 */
function projectPlugin(
  files: Record<string, string>,
  projectSource: Record<string, string>,
  splitter: RouteSplitter | undefined,
  cssModules: Record<string, Record<string, string>>,
  aliases: AliasMap | null,
  assets: Record<string, string>,
  assetUrls: Map<string, string>,
  vendorBase: string,
  projectVendorBase: string,
  projectVendor:
    | {
        rev: string;
        modules: Record<string, string>;
        css: Record<string, string>;
        workerOnly: Array<string>;
      }
    | undefined,
  vendor: VendorRules,
  warnings: Array<string>,
  target: "server" | "client",
  seenIds: Set<string>,
  clientModules: Array<ClientModule>,
  isRsc: boolean,
) {
  return {
    name: "platform:project",

    resolveId(source: string, importer: string | undefined) {
      if (source === REGISTRY_ID) return REGISTRY_ID;
      if (source === RSC_ENTRY_ID) return RSC_ENTRY_ID;
      if (source === PROJECT_SOURCE) {
        // Refused for the browser rather than emitted and hoped about: this is
        // every source file of the project, and the mistake it prevents -- a
        // component importing it "just to read a title" -- is a leak nothing
        // else would notice.
        if (target === "client") {
          warnings.push(
            `'${PROJECT_SOURCE}' is server-only: it carries the project's entire source. ` +
              `Import it from a server route handler or a createServerFn handler, not from ` +
              `a component or a loader.`,
          );
          return null;
        }
        return PROJECT_SOURCE_ID;
      }
      // Before the vendor sets: this is a bare specifier, but it names a
      // stylesheet rather than a module.
      if (isCss(source) && projectVendor?.css && source in projectVendor.css) {
        return DEPENDENCY_CSS_ID;
      }
      if (source === RSC_RUNTIME_STUB_ID) return RSC_RUNTIME_STUB_ID;

      // The rsc pass has its own vendor set, and the difference is not just
      // which React: it is narrower on purpose. `react-dom/client` is absent
      // because the react-server condition refuses it outright, so importing it
      // from a server component fails here, naming the package, rather than in
      // a cold isolate that will not boot.
      if (isRsc) {
        // The RSC runtime lives in the shell, not in a vendor chunk; see
        // RSC_RUNTIME_PATH. `rsc/app.js` reaches `rsc/runtime.js` as a sibling.
        if (source === vendor.paths.rscRuntimeSpecifier) {
          return { id: vendor.paths.rscRuntimePath, external: true };
        }
        // The react-server layer next: whatever a server component renders
        // with has to come from there, or it gets a React with no hooks.
        if (vendor.isRsc(source)) {
          return { id: vendor.rsc(source, vendorBase)!, external: true };
        }
        // Everything else from the *normal* layer. The rsc bundle's other
        // dependencies -- `createServerFn`, the rpc helpers -- are not
        // rendering code, and their react-server builds pull React rendering
        // machinery that fails at module scope. Pointing at the same chunk the
        // shell uses also keeps it to one instance.
        const shared = vendor.base(source, BASE_FROM_RSC);
        if (shared) return { id: shared, external: true };
      } else {
        // The ssr and client graphs reach the runtime through the module that
        // defines the server function; see RSC_RUNTIME_STUB.
        if (source === vendor.paths.rscRuntimeSpecifier)
          return RSC_RUNTIME_STUB_ID;
        if (vendor.isBase(source)) {
          return { id: vendor.base(source, vendorBase)!, external: true };
        }
      }

      // The project's own layer, resolved exactly like the base one -- an
      // external pointing at a chunk someone else built. The user's module
      // graph is still only their own files.
      const projectChunk = projectVendor?.modules[source];
      if (projectChunk) {
        // Server-only: the layer has a worker chunk for this and no browser
        // one. Saying so here, naming the specifier, beats a 404 for a chunk
        // URL that was never built -- which is what a client bundle importing
        // it would otherwise produce, at runtime, in a tab.
        if (
          target === "client" &&
          projectVendor?.workerOnly?.includes(source)
        ) {
          warnings.push(
            `'${source}' is server-only in this project's vendor layer: it could not be built ` +
              `for the browser. Import it from a server route handler or a createServerFn ` +
              `handler, not from a component or a loader.`,
          );
          return null;
        }
        return { id: `${projectVendorBase}${projectChunk}.js`, external: true };
      }

      // A deferred half of a route file, from the splitter's own rewrite.
      const split = splitter ? parseSplitRequest(source) : null;
      if (split) {
        const path = split.path.startsWith(".")
          ? resolveInFiles(
              resolve(dirname(sourcePathOf(importer)), split.path),
              files,
            )
          : split.path;
        if (path && path in files) {
          return `${SPLIT_PREFIX}${split.targets.join("---")}:${path}`;
        }
      }

      // Everything a project-relative path can turn into, shared by the
      // relative branch below and the tsconfig-alias one after it -- an alias
      // can point at a stylesheet or an image just as easily as a module, and
      // resolving it to a bare file id would skip the asset and CSS-module
      // passes entirely.
      const resolveProjectPath = (base: string) => {
        // Assets are resolved against their own map: they are not text, so they
        // never entered `files`. Checked first because an asset path would not
        // resolve there anyway, and the error would name the wrong thing.
        if (isAsset(base) && base in assets) return ASSET_PREFIX + base;
        // A CSS module's *import* is its name mapping. The stylesheet half was
        // produced by the CSS pass; this is the object the module returns.
        const bareCss = withoutCssQuery(base);
        if (isCssModule(bareCss) && bareCss in cssModules) {
          const paths = Object.keys(cssModules);
          return `${CSS_MODULE_PREFIX}${paths.indexOf(bareCss)}`;
        }
        return resolveInFiles(base, files);
      };

      // Vite's `?url` suffix: "give me the URL, not the contents". On a
      // stylesheet that is how a Start route puts CSS in <head> itself,
      // rather than relying on a bundler to inject a link -- which is what
      // the stock __root.tsx does.
      const [bare, query] = source.split("?");

      if (source.startsWith(".")) {
        if (query === "url" && isCss(bare!)) return CSS_URL_ID;
        const hit = resolveProjectPath(
          resolve(dirname(sourcePathOf(importer)), source),
        );
        if (hit) return hit;
        return null; // let rolldown report the unresolved import with a code frame
      }

      if (source in files) return source;

      // tsconfig `paths`. Deliberately *after* the vendor sets: an alias can
      // never shadow the pinned React, router or start packages, because two
      // React instances is a broken page rather than a resolution preference.
      // A pattern that tries is reported rather than silently dropped.
      if (aliases) {
        const candidates = aliases.candidates(bare!);
        for (const candidate of candidates) {
          if (query === "url" && isCss(candidate)) return CSS_URL_ID;
          const hit = resolveProjectPath(candidate);
          if (hit) return hit;
        }
        // A specifier that matched a pattern but resolved to nothing is a typo
        // or a moved file, not a missing package. Falling through to the
        // dependency error below would print a list of npm packages and tell
        // you to install `@/components/Card`, which does not exist and never
        // will -- so say what was actually tried instead.
        if (candidates.length) {
          warnings.push(
            `'${source}' matched a tsconfig 'paths' alias but no file was found. ` +
              `Tried: ${candidates.join(", ")}.`,
          );
          return null;
        }

        // No pattern matched, so try `baseUrl` on its own. A miss here is not
        // reported as a broken alias: with a baseUrl set, every unknown npm
        // package reaches this line, and they are dependency errors.
        const fromBaseUrl = aliases.baseUrlCandidate(bare!);
        if (fromBaseUrl) {
          const hit = resolveProjectPath(fromBaseUrl);
          if (hit) return hit;
        }
      }

      // A bare specifier outside the vendor set. Failing here rather than at
      // runtime is the point: the user gets a build error naming the package
      // instead of a blank page from a missing module in the isolate.
      const available = [
        ...(isRsc
          ? [
              vendor.paths.rscRuntimeSpecifier,
              ...vendor.rscSpecifiers,
              ...vendor.specifiers,
            ]
          : vendor.specifiers),
        ...Object.keys(projectVendor?.modules ?? {}),
      ];
      warnings.push(
        `'${source}' is not an available dependency. Available: ${available.join(", ")}.`,
      );
      return null;
    },

    load(id: string) {
      if (id === REGISTRY_ID) return REGISTRY_SOURCE;
      if (id === PROJECT_SOURCE_ID)
        return `export const FILES = ${JSON.stringify(projectSource)}\n`;
      if (id === RSC_ENTRY_ID) return rscEntrySource(files);
      if (id === RSC_RUNTIME_STUB_ID) return RSC_RUNTIME_STUB;
      if (id === DEPENDENCY_CSS_ID) return "export {}\n";
      if (id.startsWith(SPLIT_PREFIX)) {
        const rest = id.slice(SPLIT_PREFIX.length);
        const at = rest.indexOf(":");
        const targets = rest.slice(0, at).split("---").filter(Boolean);
        const path = rest.slice(at + 1);
        return splitter!.virtual(path, files[path]!, targets).code;
      }
      if (id.startsWith(CSS_MODULE_PREFIX)) {
        const path =
          Object.keys(cssModules)[Number(id.slice(CSS_MODULE_PREFIX.length))]!;
        return cssModuleExports(cssModules[path]!);
      }
      // Resolved ahead of the build, because `load` cannot be async here and
      // because the URL has to be identical across targets -- see resolveAsset.
      if (id === CSS_URL_ID) return assetModule(CSS_URL);
      if (id.startsWith(ASSET_PREFIX)) {
        return assetModule(assetUrls.get(id.slice(ASSET_PREFIX.length))!);
      }
      if (!(id in files)) return null;

      // A "use client" module is a boundary, and which side of it this build is
      // on decides what the module even is.
      const clientModule = clientModules.find((module) => module.path === id);
      if (clientModule && isRsc)
        return clientReferenceStub(clientModule, vendor.paths.flightServer);

      if (id !== ENTRY) return files[id];
      // The entry carries the registry across the module boundary: the shell
      // reads `__serverFns` off the user app, not off a module it cannot name.
      // The rsc build has no use for the registry: it holds references, not
      // modules.
      return (
        files[id] +
        REGISTRY_REEXPORT +
        (isRsc ? "" : clientModuleRegistry(clientModules))
      );
    },

    /**
     * Runs before rolldown's own oxc pass, so this sees the original TS/JSX.
     * Modules without a `createServerFn` are returned untouched and never
     * parsed.
     */
    async transform(code: string, id: string) {
      if (!(id in files) || isCss(id)) return null;

      // Two passes rather than one shared parse: each bails out on a substring
      // check before parsing, so a module that uses neither -- which is most of
      // them -- is never parsed at all.
      let out = code;
      // First, because it decides what stays in this module at all: the other
      // passes should see the reference half, not code about to move out of it.
      if (splitter && isRouteFile(id)) {
        const reference = splitter.reference(id, out);
        if (reference) out = reference.code;
      }
      const serverFns = await transformServerFns(id, out, target, seenIds);
      if (serverFns) out = serverFns.code;
      const envMarkers = await transformEnvMarkers(id, out, target);
      if (envMarkers) out = envMarkers.code;
      // Client only, and last: it deletes whole route options, so running it
      // before the others would leave them rewriting code about to be removed.
      const routeNodes = await transformRouteNodes(id, out, target);
      if (routeNodes) out = routeNodes.code;

      return out === code ? null : { code: out, map: null };
    },
  };
}

/**
 * Build-time env substitution.
 *
 * Values are inlined as literals rather than read at runtime, which is why they
 * cost nothing to use and why changing one produces a new build hash: the
 * output genuinely differs.
 *
 * Non-public keys resolve to `undefined` in the client bundle rather than being
 * left alone. An untouched `import.meta.env.SECRET` would throw in the browser,
 * and a silent `undefined` is both safer and easier to reason about.
 */
function defineFor(
  env: Record<string, string>,
  target: "server" | "client",
  warnings: Array<string>,
) {
  const define: Record<string, string> = {};
  const visible: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (!VALID_KEY.test(key)) {
      warnings.push(
        `env var '${key}' is not a valid identifier and was ignored.`,
      );
      continue;
    }

    const exposed = target === "server" || key.startsWith(PUBLIC_PREFIX);
    const literal = exposed ? JSON.stringify(value) : "undefined";
    define[`import.meta.env.${key}`] = literal;
    define[`process.env.${key}`] = literal;
    if (exposed) visible[key] = value;
  }

  // Always defined, even when empty: it makes `import.meta.env` destructuring
  // work and stops a bare reference from throwing. Specific keys above take
  // precedence over this object.
  define["import.meta.env"] = JSON.stringify(visible);
  return define;
}

async function buildOnce(
  input: BuildInput,
  vendorBase: string,
  projectVendorBase: string,
  target: "server" | "client",
  warnings: Array<string>,
  clientModules: Array<ClientModule> = [],
  isRsc = false,
  assetUrls: Map<string, string> = new Map(),
  cssModules: Record<string, Record<string, string>> = {},
  aliases: AliasMap | null = null,
) {
  const vendor = vendorRules(input.target);
  /*
   * The project's own layer, in the shape the plugin already reads.
   *
   * `BuildTarget.project` is the wire shape and always present; this is the
   * "does it have one at all" question the resolver asks, and `null` keeps
   * that a single check rather than one per field.
   */
  const projectVendor =
    input.target.project.rev === null
      ? undefined
      : {
          rev: input.target.project.rev,
          modules: input.target.project.modules,
          css: input.target.project.css,
          workerOnly: input.target.project.workerOnly,
        };

  // The RSC pass is a server build in every respect the transforms care about:
  // it runs on the server, so server-only code stays and client-only code goes.
  // Only the vendor layer differs.
  const result = await build({
    input: isRsc ? RSC_ENTRY_ID : ENTRY,
    // Required in the browser. rolldown computes `cwd: inputOptions.cwd ??
    // process.cwd()` unguarded, so omitting this throws "process is not
    // defined" from inside the wasm loader -- which surfaces only as a build
    // error with no stack pointing here. The value is inert for us because the
    // project plugin resolves every id itself.
    cwd: "/",
    // rolldown removed CSS bundling (rolldown/rolldown#4271), so a `.css`
    // import is a hard build error unless its module type is declared. 'empty'
    // drops it from the JS graph; the stylesheet itself comes from collectCss.
    moduleTypes: { ".css": "empty" },
    plugins: [
      projectPlugin(
        input.files,
        input.projectSource ?? input.files,
        input.routeSplitter,
        cssModules,
        aliases,
        input.assets ?? {},
        assetUrls,
        vendorBase,
        projectVendorBase,
        projectVendor,
        vendor,
        warnings,
        target,
        new Set(),
        clientModules,
        isRsc,
      ),
    ],
    // oxc handles TS and JSX natively, so there is no separate transform pass
    // and no type-checking on the publish path. Types are the editor's job.
    transform: {
      jsx: { runtime: "automatic", importSource: "react" },
      define: defineFor(input.env ?? {}, target, warnings),
    },
    output: {
      format: "esm",
      minify: false,
      // The entry's name is fixed because both consumers address it by name:
      // the isolate's module map has an `app.js` key, and the shell's client
      // half imports `/_app/app.js`. Split chunks are content-addressed, which
      // is what lets them be served immutable.
      entryFileNames: ENTRY_CHUNK,
      chunkFileNames: "c-[hash].js",
    },
    write: false,
  });

  // A type predicate rather than `(chunk: any)`, which is how this read until
  // the package moved into a repository that type-checks it: an `any`
  // parameter makes the filter non-narrowing, so every `.code` below was
  // reaching for a property that an OutputAsset does not have. Nothing was
  // wrong at runtime -- `type === 'chunk'` was already the check -- but
  // nothing said so either.
  const chunks = result.output.filter(
    (output): output is Extract<typeof output, { type: "chunk" }> =>
      output.type === "chunk",
  );
  const entry = chunks.find((chunk) => chunk.fileName === ENTRY_CHUNK);
  if (!entry) {
    throw new Error(
      `The build produced no ${ENTRY_CHUNK}. Chunks: ${chunks.map((c) => c.fileName).join(", ")}.`,
    );
  }

  // Chunk-to-chunk imports come out relative (`./c-abc.js`), which is exactly
  // what both sides need and why neither gets a base path here: relative to
  // `app.js` in the module map, relative to `/_app/app.js` as a URL.
  const split: Record<string, string> = {};
  for (const chunk of chunks) {
    if (chunk.fileName !== ENTRY_CHUNK) split[chunk.fileName] = chunk.code;
  }
  return { code: entry.code, chunks: split };
}

export async function buildUserApp(input: BuildInput): Promise<BuildOutput> {
  const warnings: Array<string> = [];
  const started = performance.now();

  // Server and client differ in two ways: how vendor imports are addressed
  // (module-map keys vs asset URLs), and which env vars are visible.
  // The project layer is addressed differently per target for the same reason
  // the base layer is: module-map keys inside the isolate, asset URLs in the
  // browser. The client path carries the layer's revision so it can be cached
  // immutably.
  const rev = input.target.project.rev ?? "";

  // Found once and used by all three passes, because the ids have to agree:
  // the rsc build writes them into the flight payload and the others write them
  // into the lookup map.
  const clientModules = input.rsc
    ? await collectClientModules(input.files)
    : [];

  // Resolved once, before any target builds, for two reasons: `load` cannot be
  // async, and every target has to emit the *same* URL -- a server bundle that
  // disagreed with the client one would be a hydration mismatch on every image.
  const assetUrls = new Map<string, string>();
  const assetFiles: Record<string, string> = {};
  for (const [path, base64] of Object.entries(input.assets ?? {})) {
    const resolved = await resolveAsset(path, base64);
    assetUrls.set(path, resolved.url);
    if (resolved.file) assetFiles[resolved.file.name] = resolved.file.base64;
  }

  // Collected once rather than per target: the stylesheet is the same either
  // way, and only the client ever uses it. Whether a build produced one is
  // recorded in the head pointer at publish time, because the loader -- not the
  // shell -- injects the link.
  // Parsed once for the whole build rather than per target or per import:
  // reading tsconfig.json on every resolveId call would be the hot path in a
  // build whose whole point is that it takes a second. Both the CSS walk and
  // the resolver get the same map -- two resolvers disagreeing about what
  // `@/components/Card` means is how the alias support broke on its first real
  // use, so they are given it from one place.
  const aliases = aliasMap(input.files, (message) => warnings.push(message));

  const css = await collectCss(
    input.files,
    ENTRY,
    input.target.project.css,
    aliases,
  );

  // Tailwind runs over the *concatenated* stylesheet, so the project's own
  // rules and its `@import "tailwindcss"` compile together and the cascade
  // order the CSS pass derived is preserved. Skipped entirely when the project
  // does not ask for it, which keeps the cost off every other build.
  let styles = css.code;
  let tailwindMs = 0;
  warnings.push(...css.warnings);
  if (usesTailwind(styles)) {
    const compiled = await compileTailwind(
      styles,
      input.files,
      input.loadCssModule,
    );
    styles = compiled.css;
    tailwindMs = compiled.ms;
    warnings.push(...compiled.warnings);
  }

  const serverStarted = performance.now();
  const serverBuild = await buildOnce(
    input,
    "./vendor/",
    "./pvendor/",
    "server",
    warnings,
    clientModules,
    false,
    assetUrls,
    css.modules,
    aliases,
  );
  const server = performance.now() - serverStarted;

  const clientStarted = performance.now();
  const clientBuild = await buildOnce(
    input,
    "/_vendor/",
    `/_pvendor/${rev}/`,
    "client",
    warnings,
    clientModules,
    false,
    assetUrls,
    css.modules,
    aliases,
  );
  const client = performance.now() - clientStarted;

  // Paths are relative to `rsc/app.js`, one directory down, so both layers are
  // addressed with a leading `../`. Getting this wrong does not fail the build;
  // the cold isolate simply refuses to boot.
  const rscBuild = input.rsc
    ? await buildOnce(
        // `../pvendor/`, with no revision segment: the revision belongs in the
        // browser URL, where it buys immutable caching. Inside the module map
        // there is exactly one layer and the key is `pvendor/<name>.js`, so a
        // revision here is a path segment that does not exist -- and the cold
        // isolate is where you would find that out.
        input,
        "../vendor-rsc/",
        "../pvendor/",
        "server",
        warnings,
        clientModules,
        true,
        assetUrls,
        css.modules,
        aliases,
      )
    : undefined;

  // Stripped of the `public/` prefix here rather than at every consumer: the
  // prefix is a convention of the project layout, and what the loader needs is
  // the URL path.
  const publicFiles: Record<string, string> = {};
  for (const [path, base64] of Object.entries(input.publicFiles ?? {})) {
    publicFiles[path.replace(/^public\//, "")] = base64;
  }

  return {
    serverCode: serverBuild.code,
    clientCode: clientBuild.code,
    serverChunks: serverBuild.chunks,
    clientChunks: clientBuild.chunks,
    assetFiles,
    publicFiles,
    cssCode: styles,
    // Detected from the source rather than tracked through the build: the
    // plugin's resolveId runs once per target, and this is a property of the
    // project, not of a build.
    linksOwnCss: Object.values(input.files).some((code) =>
      /\.css\?url/.test(code),
    ),
    rscCode: rscBuild?.code,
    rscChunks: rscBuild?.chunks,
    clientModules: input.rsc ? clientModules : undefined,
    vendorRev: input.target.base.rev,
    // The project vendor revision has to be in here. Without it, changing a
    // dependency produces the same hash, and a warm isolate keeps serving the
    // previous dependency set -- the same trap as the shell revision in the
    // loader's cache id, one layer down.
    // Every emitted byte, not just the entries: a change confined to a split
    // chunk is still a different build, and a warm isolate keyed on an
    // unchanged entry hash would keep serving the previous one.
    hash: (
      await sha256Hex(
        [
          input.target.base.rev,
          rev,
          styles,
          ...Object.entries(assetFiles).flat(),
          ...Object.entries(publicFiles).flat(),
          ...[serverBuild, clientBuild, rscBuild].flatMap((built) =>
            built ? [built.code, ...Object.entries(built.chunks).flat()] : [],
          ),
        ].join("\u0000"),
      )
    ).slice(0, 32),
    timings: {
      server,
      client,
      tailwind: tailwindMs,
      total: performance.now() - started,
    },
    warnings: [...new Set(warnings)],
  };
}

/**
 * Exactly what `POST /__api/publish` expects, from a build.
 *
 * A function rather than "spread the whole build", because BuildOutput also
 * carries things the loader has no use for -- timings, warnings, the client
 * module list -- and rather than a hand-written literal at every call site,
 * because split chunks were the third output to be added and the third time
 * every publisher had to be found and edited.
 */
export function publishPayload(
  build: BuildOutput,
  extra?: {
    projectVendor?: {
      rev: string;
      worker: Record<string, string>;
      browser: Record<string, string>;
    };
    /**
     * Keep using the layer already stored under this revision.
     *
     * For a publisher that did not build the dependency layer and cannot: the
     * layer is a rolldown pass over `node_modules`, and the studio tab has
     * neither. Sending nothing at all is NOT the same thing -- the loader would
     * read the head's layer as absent and the next render would lose every
     * dependency.
     */
    projectVendorRev?: string;
    /**
     * The source this build was made from, stored so the next editor can start
     * from what is live rather than re-importing the repository.
     */
    projectSource?: Record<string, string>;
    /**
     * The commit this build was made from.
     *
     * Required by a project whose pointer is configured, and the CLAIM that
     * pointer checks: the loader reads the branch head itself and links the
     * build only if the two agree, so a publisher naming a stale commit is
     * refused rather than believed.
     */
    commit?: string;
    /**
     * The git tree of that commit's source.
     *
     * Optional, and a publisher that cannot honestly produce one must LEAVE IT
     * OUT rather than approximate it. The loader compares it against the tree
     * the commit actually holds, so a value that is nearly right refuses every
     * publish -- which is worse than not checking, because it looks like the
     * platform being broken. A checkout has it for free; a tab whose record has
     * been modified since the checkout (this platform wires `val.server.ts`
     * before building) does not.
     */
    sourceHash?: string;
    /** A browser tab or a repository's CI. Defaults to `client` at the loader. */
    origin?: "client" | "repo";
  },
) {
  return {
    serverCode: build.serverCode,
    clientCode: build.clientCode,
    serverChunks: build.serverChunks,
    clientChunks: build.clientChunks,
    cssCode: build.cssCode,
    linksOwnCss: build.linksOwnCss,
    rscCode: build.rscCode,
    rscChunks: build.rscChunks,
    assetFiles: build.assetFiles,
    publicFiles: build.publicFiles,
    hash: build.hash,
    vendorRev: build.vendorRev,
    ...extra,
  };
}
