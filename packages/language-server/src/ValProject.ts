import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import type {
  Json,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import type { SchemaSourceSnapshot } from "@valbuild/shared/internal";
import {
  createService,
  fixHandlers,
  type FixHandlerResult,
  type IValRemote,
  type Service,
  type ValidationError,
} from "@valbuild/server";
import { createEditorFsHost, type OpenDocuments } from "./EditorFsHost";

/**
 * A single Val root, and everything needed to evaluate its modules.
 *
 * One of these per Val root — never one shared across roots. Different roots in
 * a monorepo can pin different versions of Val, and each gets its own
 * `Service` (and therefore its own evaluated `val.modules` and module cache).
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
    options?: { validate: boolean },
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
  /**
   * Run the `val validate --fix` handler for one validation error and report
   * what it found, without applying anything (`fix: false`).
   *
   * The handlers are the precondition layer in `@valbuild/server`: they read the
   * file, check the directory, look across modules. Running them here rather
   * than reimplementing their checks is what keeps an editor's verdict and the
   * CLI's identical. Exposed as a method because the handlers need the
   * `Service` and the fs host, and both stay private to this module.
   *
   * Resolves to `undefined` when the project could not be evaluated, or when no
   * handler is registered for the error's fixes.
   */
  runFixHandler(args: {
    moduleFilePath: ModuleFilePath;
    sourcePath: SourcePath;
    validationError: ValidationError;
  }): Promise<FixHandlerResult | undefined>;
  /** Drop cached results. Pass a path to invalidate one module. */
  invalidate(moduleFilePath?: ModuleFilePath): void;
  /** Number of cached module results — for tests and diagnostics. */
  cacheSize(): number;
  dispose(): Promise<void>;
};

/**
 * A remote that refuses to do anything.
 *
 * The handlers that need a remote (upload) are not reachable through
 * {@link ValProject.runFixHandler}, which reports rather than applies. Passing a
 * refusing stub keeps the context type honest instead of asserting the field
 * away, and turns any future miswiring into a message rather than a crash.
 */
const reportOnlyRemote: IValRemote = {
  remoteHost: "",
  getSettings: () =>
    Promise.resolve({
      success: false,
      message: "The language server does not upload while reporting.",
    }),
  uploadFile: () =>
    Promise.resolve({
      success: false,
      error: "The language server does not upload while reporting.",
    }),
};

const DEFAULT_OPTIONS = { validate: true };

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
 * Val modules import `@valbuild/core`, and so does the `val.modules` file that
 * the service evaluates. When it is not resolvable, every module fails with a fatal
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
  isCoreResolvable = defaultCoreResolver,
}: {
  valRoot: string;
  open: OpenDocuments;
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

  /**
   * Forget the current `Service` so the next request builds a new one.
   *
   * A `Service` evaluates the whole `val.modules` graph when it is created and
   * then answers `get` from that evaluation, so it is a snapshot of the project
   * at one point in time and cannot re-read a single module. Dropping it is what
   * makes the next request see an edit. `Service.dispose()` is a no-op, so the
   * only cost is the re-evaluation itself.
   */
  function discardService(): void {
    servicePromise = undefined;
  }

  function startService(): NonNullable<typeof servicePromise> {
    const coreProblem = checkCoreIsResolvable(valRoot, isCoreResolvable);
    if (coreProblem) {
      return Promise.resolve({ status: "error" as const, error: coreProblem });
    }
    return createService(valRoot, host)
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

  function getService() {
    if (!servicePromise) {
      const attempt = startService();
      servicePromise = attempt;
      // Only a *successful* evaluation is worth keeping. Everything that makes
      // one fail can be fixed without any Val module's content changing -- add a
      // tsconfig, install @valbuild/core, fix the module that throws, fix
      // val.modules -- so memoizing the failure would leave the session
      // permanently broken. Retrying is cheap: a failing evaluation throws early.
      void attempt.then((resolved) => {
        if (resolved.status === "error" && servicePromise === attempt) {
          servicePromise = undefined;
        }
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

  // One in-flight snapshot build, shared by concurrent callers.
  let snapshotPromise:
    | Promise<
        | { status: "ok"; snapshot: SchemaSourceSnapshot }
        | { status: "error"; error: ValProjectInitError }
      >
    | undefined;

  async function buildSnapshot(): Promise<
    | { status: "ok"; snapshot: SchemaSourceSnapshot }
    | { status: "error"; error: ValProjectInitError }
  > {
    // First call: everything is stale. Later calls: only what changed.
    if (snapshotStale === undefined) {
      snapshotStale = new Set(findValModuleFilePaths(valRoot));
    }
    // Claim the work list *before* the first await, and leave a fresh set
    // behind. An `invalidate()` that lands while we are evaluating then lands in
    // that fresh set and is refreshed on the next call, instead of being cleared
    // as though this call had handled it.
    const refreshing = [...snapshotStale];
    snapshotStale = new Set();

    const resolved = await getService();
    if (resolved.status === "error") {
      // Nothing was refreshed, so put the work back — unless a full invalidation
      // landed meanwhile, which re-lists everything anyway.
      if (snapshotStale !== undefined) {
        for (const moduleFilePath of refreshing) {
          snapshotStale.add(moduleFilePath);
        }
      }
      return { status: "error", error: resolved.error };
    }
    for (const moduleFilePath of refreshing) {
      const content = await resolved.service.get(
        moduleFilePath,
        "" as ModulePath,
        // Validation is not needed to answer "what keys/routes exist", and
        // skipping it keeps the snapshot cheap.
        { validate: false },
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
    return { status: "ok", snapshot };
  }

  const project: ValProject = {
    valRoot,

    async getModule(moduleFilePath, options = DEFAULT_OPTIONS) {
      // Cache on the module's own content as seen by the editor. This covers the
      // common case -- repeated requests while the user edits one file -- but
      // NOT edits to a module's imports; `invalidate()` is how the server
      // handles that.
      const absolute = path.join(valRoot, moduleFilePath);
      const current = fingerprint(host.readFile(absolute));
      const optionsKey = `${+options.validate}`;
      const hit = cache.get(moduleFilePath);
      if (hit) {
        if (hit.fingerprint === current && hit.optionsKey === optionsKey) {
          return { status: "ok", content: hit.content, cached: true };
        }
        if (hit.fingerprint !== current) {
          // The content we last evaluated at is gone, so the Service's
          // whole-project evaluation is stale as well. Callers do not have to
          // call `invalidate()` first for this to be correct.
          discardService();
        }
      }

      const resolved = await getService();
      if (resolved.status === "error") {
        return { status: "error", error: resolved.error };
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
    async runFixHandler({ moduleFilePath, sourcePath, validationError }) {
      const handlerName = validationError.fixes?.find(
        (fix) => fixHandlers[fix] !== undefined,
      );
      if (!handlerName) {
        return undefined;
      }
      const resolved = await getService();
      if (resolved.status === "error") {
        return undefined;
      }
      const moduleResult = await project.getModule(moduleFilePath, {
        validate: false,
      });
      if (moduleResult.status === "error") {
        return undefined;
      }
      return fixHandlers[handlerName]({
        sourcePath,
        validationError,
        valModule: moduleResult.content,
        projectRoot: valRoot,
        // Report only. Applying a fix from here would write to disk behind the
        // editor's back; an accepted quick fix travels as a WorkspaceEdit.
        fix: false,
        service: resolved.service,
        valFiles: findValModuleFilePaths(valRoot).map((p) => p.slice(1)),
        moduleFilePath,
        file: moduleFilePath.slice(1),
        fs: host,
        remoteFiles: {},
        remoteFilesCounter: 0,
        remote: reportOnlyRemote,
        project: undefined,
      });
    },

    getSnapshot() {
      // `snapshot` is one shared object handed to every caller, so a second
      // concurrent build must not be allowed to return it half-filled: the
      // in-flight build is shared instead. Without this, two callers see 1 and 6
      // schemas respectively, and a partial snapshot makes keyOf/route resolution
      // report references that are perfectly valid as broken.
      if (!snapshotPromise) {
        const attempt = buildSnapshot();
        snapshotPromise = attempt;
        void attempt.finally(() => {
          if (snapshotPromise === attempt) {
            snapshotPromise = undefined;
          }
        });
      }
      return snapshotPromise;
    },

    invalidate(moduleFilePath) {
      discardService();
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
      discardService();
      cache.clear();
    },
  };
  return project;
}
