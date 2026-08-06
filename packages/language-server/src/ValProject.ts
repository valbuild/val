import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import type { Json, ModuleFilePath, ModulePath } from "@valbuild/core";
import type { SchemaSourceSnapshot } from "@valbuild/shared/internal";
import { createService, type Service } from "@valbuild/server";
import { createEditorFsHost, type OpenDocuments } from "./EditorFsHost";

/**
 * A single Val root, and everything needed to evaluate its modules.
 *
 * One of these per Val root — never one shared across roots. Different roots in
 * a monorepo can pin different versions of Val, and each gets its own
 * `Service` (and therefore its own QuickJS runtime and module cache).
 */

/** What `Service.get` returns; re-declared to avoid depending on an internal type. */
export type ValModuleContent = Awaited<ReturnType<Service["get"]>>;

export type ValProjectInitError = {
  /**
   * - `no-config`    — no tsconfig.json/jsconfig.json at the Val root.
   * - `missing-core` — `@valbuild/core` is not resolvable from the Val root.
   * - `service-failed` — anything else that stopped the service starting.
   */
  code: "no-config" | "missing-core" | "service-failed";
  message: string;
};

export type ValProject = {
  readonly valRoot: string;
  /**
   * Evaluate a module and return its schema, source and validation errors.
   * Resolves to an init error instead of throwing if the project could not be
   * set up at all.
   */
  getModule(
    moduleFilePath: ModuleFilePath,
    options?: { validate: boolean; source: boolean; schema: boolean },
  ): Promise<
    | { status: "ok"; content: ValModuleContent; cached: boolean }
    | { status: "error"; error: ValProjectInitError }
  >;
  /**
   * Schemas and sources for every Val module in the project.
   *
   * Needed for anything that has to look across modules: resolving `keyOf` and
   * `route` validation, and offering route/key completions. Built once and then
   * updated per module, so an edit costs one re-evaluation rather than N.
   */
  getSnapshot(): Promise<
    | { status: "ok"; snapshot: SchemaSourceSnapshot }
    | { status: "error"; error: ValProjectInitError }
  >;
  /** Val module file paths found under the Val root. */
  listModuleFilePaths(): ModuleFilePath[];
  /** Drop cached results. Pass a path to invalidate one module. */
  invalidate(moduleFilePath?: ModuleFilePath): void;
  /** Number of cached module results — for tests and diagnostics. */
  cacheSize(): number;
  dispose(): Promise<void>;
};

const DEFAULT_OPTIONS = { validate: true, source: true, schema: true };

/** Cheap cache key. Not security-sensitive, so sha1 over the source is fine. */
function fingerprint(content: string | undefined): string {
  return content === undefined
    ? "<missing>"
    : crypto.createHash("sha1").update(content).digest("hex");
}

/**
 * Whether `@valbuild/core` is resolvable from a Val root.
 *
 * Injectable because jest's module registry intercepts `createRequire` and
 * resolves against the repo regardless of the base path given, so the real
 * implementation always reports success under test.
 */
export type CoreResolver = (valRoot: string) => boolean;

export const defaultCoreResolver: CoreResolver = (valRoot) => {
  try {
    createRequire(path.join(valRoot, "package.json")).resolve(
      "@valbuild/core/package.json",
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * Check up front that `@valbuild/core` resolves from the Val root.
 *
 * Val modules import `@valbuild/core`, and so does the program `readValFile`
 * evaluates. When it is not resolvable, every module fails with a fatal
 * "Could not resolve module: '@valbuild/core'" — which reads like a Val bug
 * rather than a missing dependency.
 *
 * This is easy to hit: `@valbuild/core` must be a *direct* dependency (which is
 * what `valbuild-init` enforces), but under pnpm's isolated node_modules a
 * project that only declares `@valbuild/next` has no resolvable core, whereas
 * under npm's hoisting the same project works by accident. Detecting it once
 * here turns N cryptic per-module fatals into one actionable message.
 */
function checkCoreIsResolvable(
  valRoot: string,
  isCoreResolvable: CoreResolver,
): ValProjectInitError | null {
  if (isCoreResolvable(valRoot)) {
    return null;
  }
  return {
    code: "missing-core",
    message:
      `Could not resolve '@valbuild/core' from '${valRoot}'. ` +
      `Val requires @valbuild/core as a direct dependency of your project — ` +
      `add it with your package manager (for example: npm install @valbuild/core).`,
  };
}

/**
 * Find every Val module under the Val root.
 *
 * Globs rather than reading `val.modules`, matching what the CLI does: it is a
 * superset, and it keeps working while `val.modules` is mid-edit or broken.
 */
function findValModuleFilePaths(valRoot: string): ModuleFilePath[] {
  const found: ModuleFilePath[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (/\.val\.(ts|js|tsx|jsx)$/.test(entry.name)) {
        found.push(
          `/${path.relative(valRoot, absolute).split(path.sep).join("/")}` as ModuleFilePath,
        );
      }
    }
  }
  walk(valRoot);
  return found.sort();
}

export function createValProject({
  valRoot,
  open,
  disableCache,
  isCoreResolvable = defaultCoreResolver,
}: {
  valRoot: string;
  open: OpenDocuments;
  /** Disable the transpile cache inside ValModuleLoader. Defaults to enabled. */
  disableCache?: boolean;
  /** Override for tests; see {@link CoreResolver}. */
  isCoreResolvable?: CoreResolver;
}): ValProject {
  const host = createEditorFsHost(open);

  // `createService` calls getCompilerOptions, which THROWS when the Val root has
  // neither tsconfig.json nor jsconfig.json. Initialise lazily and keep the
  // failure as a value so a misconfigured project degrades to "no diagnostics"
  // instead of taking the server down.
  let servicePromise:
    | Promise<
        | { status: "ok"; service: Service }
        | { status: "error"; error: ValProjectInitError }
      >
    | undefined;

  function getService() {
    if (!servicePromise) {
      const coreProblem = checkCoreIsResolvable(valRoot, isCoreResolvable);
      if (coreProblem) {
        servicePromise = Promise.resolve({
          status: "error" as const,
          error: coreProblem,
        });
        return servicePromise;
      }
      servicePromise = createService(
        valRoot,
        { disableCache: disableCache ?? false },
        host,
      )
        .then((service) => ({ status: "ok" as const, service }))
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e);
          return {
            status: "error" as const,
            error: {
              code: /Could not read config from/.test(message)
                ? ("no-config" as const)
                : ("service-failed" as const),
              message,
            },
          };
        });
    }
    return servicePromise;
  }

  const cache = new Map<
    string,
    { fingerprint: string; optionsKey: string; content: ValModuleContent }
  >();

  // Snapshot entries are kept across edits and refreshed individually: a
  // keystroke should cost one module evaluation, not one per module.
  const snapshot: SchemaSourceSnapshot = { schemas: {}, sources: {} };
  let snapshotStale: Set<ModuleFilePath> | undefined;

  return {
    valRoot,

    async getModule(moduleFilePath, options = DEFAULT_OPTIONS) {
      const resolved = await getService();
      if (resolved.status === "error") {
        return { status: "error", error: resolved.error };
      }

      // Cache on the module's own content as seen by the editor. This covers the
      // common case -- repeated requests while the user edits one file -- but
      // NOT edits to a module's imports; `invalidate()` is how the server
      // handles that. Transpilation of imported files is separately cached by
      // ValModuleLoader.
      const absolute = path.join(valRoot, moduleFilePath);
      const current = fingerprint(host.readFile(absolute));
      const optionsKey = `${+options.validate}${+options.source}${+options.schema}`;
      const hit = cache.get(moduleFilePath);
      if (hit && hit.fingerprint === current && hit.optionsKey === optionsKey) {
        return { status: "ok", content: hit.content, cached: true };
      }

      const content = await resolved.service.get(
        moduleFilePath,
        "" as ModulePath,
        options,
      );
      cache.set(moduleFilePath, {
        fingerprint: current,
        optionsKey,
        content,
      });
      return { status: "ok", content, cached: false };
    },

    listModuleFilePaths: () => findValModuleFilePaths(valRoot),

    async getSnapshot() {
      const resolved = await getService();
      if (resolved.status === "error") {
        return { status: "error", error: resolved.error };
      }
      // First call: everything is stale. Later calls: only what changed.
      if (snapshotStale === undefined) {
        snapshotStale = new Set(findValModuleFilePaths(valRoot));
      }
      for (const moduleFilePath of snapshotStale) {
        const content = await resolved.service.get(
          moduleFilePath,
          "" as ModulePath,
          // Validation is not needed to answer "what keys/routes exist", and
          // skipping it keeps the snapshot cheap.
          { source: true, schema: true, validate: false },
        );
        if (content.schema) {
          snapshot.schemas[moduleFilePath] = content.schema;
        } else {
          delete snapshot.schemas[moduleFilePath];
        }
        if (content.source !== undefined) {
          // Same conversion the CLI does when building its snapshot; Source is
          // JSON-shaped once serialized.
          snapshot.sources[moduleFilePath] = content.source as Json;
        } else {
          delete snapshot.sources[moduleFilePath];
        }
      }
      snapshotStale.clear();
      return { status: "ok", snapshot };
    },

    invalidate(moduleFilePath) {
      if (moduleFilePath === undefined) {
        cache.clear();
        snapshotStale = undefined;
        for (const key of Object.keys(snapshot.schemas)) {
          delete snapshot.schemas[key as ModuleFilePath];
        }
        for (const key of Object.keys(snapshot.sources)) {
          delete snapshot.sources[key as ModuleFilePath];
        }
      } else {
        cache.delete(moduleFilePath);
        // Refresh just this module in the snapshot next time it is read.
        if (snapshotStale !== undefined) {
          snapshotStale.add(moduleFilePath);
        }
      }
    },

    cacheSize: () => cache.size,

    async dispose() {
      if (!servicePromise) {
        return;
      }
      const resolved = await servicePromise;
      if (resolved.status === "ok") {
        resolved.service.dispose();
      }
      servicePromise = undefined;
      cache.clear();
    },
  };
}
