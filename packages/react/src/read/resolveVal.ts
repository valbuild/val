import {
  Internal,
  type ModuleFilePath,
  type ResolvableModule,
  type SelectorSource,
  type SourceObject,
  type ValModule,
} from "@valbuild/core";
import type { ContentSource, ModuleVersion } from "@valbuild/shared/internal";
import {
  getModuleIds,
  stegaEncode,
  type JsonEntryContentOf,
  type Resolvable,
  type ResolvedVal,
} from "../stega/stegaEncode";
import { getJsonEntryStegaRoot, isJsonValuesRecordSchema } from "./jsonValues";
import { layered, type SchemaRule } from "./layered";
import { bundleSource } from "./sources";

/**
 * Everything a read needs that is not the selector: where content comes from
 * and whether it carries edit tags. Built once per request on the server and
 * once per render in a component; the only thing the readers differ in.
 *
 * `encode` is decided ONCE, from draft mode (and, on TanStack, hydration and
 * analytics): there is no second encode on an error path to forget it.
 */
export type ReadEnv = {
  /** In order; the bundle is put after them by every read. */
  readonly sources: readonly ContentSource[];
  readonly encode: boolean;
  /**
   * The version of the schema the reader's own code has for a module, for
   * {@link SchemaRule}. Absent: no source this env reads carries versions.
   */
  readonly schemaVersionOf?: (
    module: ValModule<SelectorSource>,
  ) => string | null;
  readonly codeChanged?: SchemaRule["codeChanged"];
  readonly schemaChecked?: SchemaRule["schemaChecked"];
};

/** Which source a module was read from, and the version of what it read. */
export type ReadOf = {
  path: ModuleFilePath;
  /** `overlay`, `server-draft`, `snapshot` or `bundle`. */
  from: string;
  version: ModuleVersion | null;
};

/** What a read is: a value with the reads it was made of, or a wait. */
export type Resolution<T> =
  | { status: "ready"; value: T; reads: readonly ReadOf[] }
  | {
      status: "pending";
      /** What to wait on before reading again: the first wait. */
      ready: Promise<void>;
      /** Every wait this read met, all started: a server awaits them together. */
      waits: readonly Promise<void>[];
    };

/**
 * What a read of `selector` reads: every module it names (`getModuleIds`),
 * the module objects it carries -- whose `.jsonValues()` entries the bundle
 * imports -- and the whole `.jsonValues()` record it is, if it is one.
 */
export type ReadPlan = {
  readonly modules: readonly ModuleFilePath[];
  readonly own: ReadonlyMap<ModuleFilePath, ValModule<SelectorSource>>;
  readonly record: ModuleFilePath | null;
};

const plans = new WeakMap<object, ReadPlan>();

/**
 * The plan of a read: see {@link ReadPlan}. Kept per selector object, like
 * `getModuleIds`: a module is a module-level constant, so its plan is made
 * once for the life of the process.
 */
/** A module id `getModuleIds` collected: a module's path. */
function isModuleFilePath(id: string): id is ModuleFilePath {
  return id.startsWith("/");
}

export function planOf(selector: unknown): ReadPlan {
  const root: unknown = Internal.viewHandleModule(selector) ?? selector;
  const cacheable = typeof root === "object" && root !== null;
  if (cacheable) {
    const cached = plans.get(root);
    if (cached !== undefined) return cached;
  }
  // The ids `getModuleIds` collects are module paths, as `useVal`
  // subscribed to them.
  const modules = getModuleIds(root).filter(isModuleFilePath);
  const own = new Map<ModuleFilePath, ValModule<SelectorSource>>();
  let record: ModuleFilePath | null = null;
  const rootPath = Internal.isValModule(root)
    ? Internal.getValPath(root)
    : undefined;
  if (Internal.isValModule(root) && rootPath !== undefined) {
    const [path] = Internal.splitModuleFilePathAndModulePath(rootPath);
    own.set(path, root);
    if (isJsonValuesRecordSchema(Internal.getSchema(root))) {
      record = path;
    }
  }
  const plan: ReadPlan = { modules, own, record };
  if (cacheable) plans.set(root, plan);
  return plan;
}

let resolves = 0;
let encodes = 0;

/**
 * Counted work, for the scenarios' budgets (`read:resolve`, `read:encode`):
 * how many times a reader resolved, and how many of those encoded a value.
 * A render resolves once per selector unless something it waited on is in;
 * a server read resolves once per wait, plus the one that is ready.
 */
export function readWork(): { resolve: number; encode: number } {
  return { resolve: resolves, encode: encodes };
}

/** How a read is made, beyond its env. */
export type ResolveOptions = {
  /**
   * `false` leaves a `.jsonValues()` record's entries as they are: a reader
   * that only needs the record's keys (`useValRouteUrl`) imports none.
   */
  entries?: boolean;
  /** Waits already over: see `layered`. */
  settled?: ReadonlySet<Promise<void>>;
};

function viewOf(
  env: ReadEnv,
  plan: ReadPlan,
  settled?: ReadonlySet<Promise<void>>,
) {
  const schemaVersionOf = env.schemaVersionOf;
  return layered(
    [...env.sources, bundleSource(plan.own)],
    schemaVersionOf
      ? {
          schemaOf: (path) => {
            const module = plan.own.get(path);
            return module === undefined ? null : schemaVersionOf(module);
          },
          ...(env.codeChanged ? { codeChanged: env.codeChanged } : {}),
          ...(env.schemaChecked ? { schemaChecked: env.schemaChecked } : {}),
        }
      : undefined,
    settled,
  );
}

function pending<T>(waits: Promise<void>[]): Resolution<T> | null {
  const [first] = waits;
  return first === undefined
    ? null
    : { status: "pending", ready: first, waits };
}

/**
 * Resolve `selector` against `env`: read the modules {@link planOf} names
 * from the sources (the first that does not pass wins: `layered`), fill a
 * whole `.jsonValues()` record's entries, and -- once nothing is pending --
 * encode the value. Every reader of a value goes through this: `fetchVal`,
 * `useVal`, and the route readers' modules.
 */
export function resolveVal<T extends Resolvable>(
  selector: T,
  env: ReadEnv,
  opts?: ResolveOptions,
): Resolution<ResolvedVal<T>> {
  resolves++;
  const plan = planOf(selector);
  const view = viewOf(env, plan, opts?.settled);
  const answers = new Map<string, unknown>();
  const reads: ReadOf[] = [];
  const waits: Promise<void>[] = [];
  for (const path of plan.modules) {
    const { read, at } = view.module(path);
    if (read.status === "pending") {
      waits.push(read.ready);
      continue;
    }
    if (read.status === "ready") {
      answers.set(path, read.source);
      reads.push({ path, from: read.from, version: read.version });
    } else {
      reads.push({ path, from: "bundle", version: null });
    }
    if (path === plan.record && opts?.entries !== false) {
      const own = plan.own.get(path);
      const filled = fillRecord(
        view,
        path,
        answers.get(path) ?? (own && Internal.getSource(own)),
        at,
        waits,
      );
      if (filled !== undefined) answers.set(path, filled);
    }
  }
  const wait = pending<ResolvedVal<T>>(waits);
  if (wait !== null) return wait;
  encodes++;
  return {
    status: "ready",
    value: stegaEncode(selector, {
      disabled: !env.encode,
      getModule: (moduleId) => answers.get(moduleId),
    }),
    reads,
  };
}

/**
 * A whole `.jsonValues()` record, with its entries' content: its own source
 * holds a lazy marker per entry, so a reader that encodes that source renders
 * every entry empty. An entry that is still a marker where the record was
 * read is taken from a later source that has its content, ending at the
 * bundle's import; one whose import failed keeps its marker, which is what a
 * failed read rendered before.
 *
 * `undefined` when there is nothing to fill: the record is not an object (a
 * nullable record that is null), or holds no marker.
 */
function fillRecord(
  view: ReturnType<typeof layered>,
  path: ModuleFilePath,
  record: unknown,
  at: number,
  waits: Promise<void>[],
): Record<string, unknown> | undefined {
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    return undefined;
  }
  let filled: Record<string, unknown> | null = null;
  for (const [key, entry] of Object.entries(record)) {
    if (!Internal.isJson(entry)) continue;
    let content: unknown = undefined;
    // `gone` from a later source is not this entry gone: the source that
    // answered for the record has it. Ask the next one.
    for (let after = at; after < view.sources.length; ) {
      const read = view.entry(path, key, after);
      if (read.status === "ready") {
        content = read.content;
        break;
      }
      if (read.status === "pending") {
        waits.push(read.ready);
        break;
      }
      if (read.status === "failed") {
        Internal.log.error(
          `could not load the entry '${key}' of ${path}`,
          read.error,
        );
        break;
      }
      if (read.status === "gone") {
        after = sourceIndex(view, read.from, after);
        continue;
      }
      break;
    }
    if (content !== undefined) {
      filled ??= { ...record };
      filled[key] = content;
    }
  }
  return filled === null ? undefined : filled;
}

/** The index of the source named `from`, after `after`. */
function sourceIndex(
  view: ReturnType<typeof layered>,
  from: string,
  after: number,
): number {
  for (let at = after + 1; at < view.sources.length; at++) {
    if (view.sources[at]?.name === from) return at;
  }
  return view.sources.length;
}

/**
 * Resolve ONE `.jsonValues()` entry of `selector` by key: the first source
 * that has an answer, where "the entry is gone" is an answer (a draft that
 * deleted it must not render the published one) and the bundle's import is
 * the last. Loads that entry and no other. `undefined` for an entry that is
 * not there. An entry whose import failed throws, as the import did.
 */
export function resolveValEntry<T extends ResolvableModule>(
  selector: T,
  key: string,
  env: ReadEnv,
  opts?: Pick<ResolveOptions, "settled">,
): Resolution<JsonEntryContentOf<T> | undefined> {
  return resolveModuleEntry(
    Internal.resolveViewedModule<SourceObject>(selector),
    key,
    env,
    opts,
  );
}

/** {@link resolveValEntry}, for a module (a view resolved). */
export function resolveModuleEntry<V>(
  module: ValModule<SelectorSource>,
  key: string,
  env: ReadEnv,
  opts?: Pick<ResolveOptions, "settled">,
): Resolution<V | undefined> {
  resolves++;
  const plan = planOf(module);
  const path = plan.own.keys().next().value;
  if (path === undefined) {
    return { status: "ready", value: undefined, reads: [] };
  }
  const read = viewOf(env, plan, opts?.settled).entry(path, key);
  if (read.status === "pending") {
    return { status: "pending", ready: read.ready, waits: [read.ready] };
  }
  if (read.status === "failed") {
    throw read.error;
  }
  const reads: ReadOf[] = [
    {
      path,
      from: read.status === "pass" ? "bundle" : read.from,
      version: null,
    },
  ];
  if (read.status !== "ready" || read.content === undefined) {
    return { status: "ready", value: undefined, reads };
  }
  encodes++;
  return {
    status: "ready",
    value: stegaEncode(read.content, {
      disabled: !env.encode,
      root: getJsonEntryStegaRoot(module, key),
    }),
    reads,
  };
}

/** A resolution's value, mapped; a wait stays the same wait. */
export function mapResolution<T, U>(
  r: Resolution<T>,
  f: (value: T) => U,
): Resolution<U> {
  return r.status === "ready"
    ? { status: "ready", value: f(r.value), reads: r.reads }
    : r;
}
