import type { Json, ModuleFilePath, PatchId } from "@valbuild/core";
import type { ReadonlyJSONValue } from "@valbuild/core/patch";
import { baseModuleContent, type ModuleContent } from "./applyChain";
import { EMPTY_CHAIN, moduleKey, type ModuleVersion } from "./version";

/*
 * The store: modules by address. See `docs/plans/one-content-model.md`,
 * "The store: one address, immutable values, tiers".
 *
 * Content at a version never changes, so a store of modules by `moduleKey`
 * needs no invalidation, only eviction. A base is a version with the empty
 * chain, so the same store holds both. Every place that keeps modules uses
 * the same tiers, in the order that fits it: Val's server keeps
 * `[memoryTier, bundleTier, …]` in front of its head (`ValHead` in
 * `@valbuild/server`), and the Studio's will put an origin tier behind them
 * (phase 7).
 */

/** One module's content at one version, as a tier holds it. */
export type StoredModule = {
  readonly path: ModuleFilePath;
  readonly version: ModuleVersion;
  readonly content: ModuleContent;
  /**
   * The patch ids the version's chain is made of, in chain order: empty for a
   * base. What a newer version of the same chain is extended from, and what a
   * delta between two versions is made of.
   */
  readonly patches: readonly PatchId[];
  /**
   * What holding this costs beyond what is held anyway: the containers the
   * engine copied and the values the patches brought, never the base the
   * build holds for every visitor. Zero for the bundle's own module.
   */
  readonly bytes: number;
};

export interface ModuleTier {
  /** `memory`, `bundle`, `base`, `origin`: goes into counted work and test frames. */
  readonly name: string;
  get(key: string): StoredModule | null | Promise<StoredModule | null>;
  put?(key: string, value: StoredModule, bytes: number): void;
}

// #region counted work

const tierHits = new Map<string, number>();
let tierMisses = 0;

/**
 * What the stores in this process have answered, by tier, and how often
 * none of them had a key: a test takes it before and after. Never reset.
 */
export function storeWork(): {
  hits: Readonly<Record<string, number>>;
  misses: number;
} {
  return { hits: Object.fromEntries(tierHits), misses: tierMisses };
}

// #region tiered

/**
 * Asks each tier in turn; what a slower tier answers is written to the faster
 * ones before it. A tier that answers `null` has no say.
 */
export function tiered(tiers: readonly ModuleTier[]): ModuleTier {
  return {
    name: tiers.map((tier) => tier.name).join(">"),
    async get(key) {
      for (const [index, tier] of tiers.entries()) {
        const found = await tier.get(key);
        if (found === null) continue;
        tierHits.set(tier.name, (tierHits.get(tier.name) ?? 0) + 1);
        for (const faster of tiers.slice(0, index)) {
          faster.put?.(key, found, found.bytes);
        }
        return found;
      }
      tierMisses++;
      return null;
    },
    put(key, value, bytes) {
      tiers[0]?.put?.(key, value, bytes);
    },
  };
}

// #region memory

export type MemoryTier = ModuleTier & {
  put(key: string, value: StoredModule, bytes: number): void;
  /**
   * The newest version held of a module, whatever its key: what the next
   * version of the same chain is extended from rather than replayed.
   */
  latest(path: ModuleFilePath): StoredModule | null;
  /** What it holds now. */
  stats(): MemoryTierStats;
  /**
   * Charge a held key for something added to it after it was put (an entry
   * resolved on it), so the budget sees it.
   */
  charge(key: string, bytes: number): void;
};

export type MemoryTierStats = {
  /** Bytes held, by the measure each value was put with. */
  bytes: number;
  /** Values held. */
  versions: number;
  /** Modules with at least one version held. */
  modules: number;
  /** The most versions held of any one module. */
  mostVersionsOfOneModule: number;
  /** The most bytes held for any one module, all its versions together. */
  mostBytesOfOneModule: number;
  /** Values let go so far, for the budget or the ring. */
  evicted: number;
};

/**
 * Bounded by bytes; keeps the last `lastPerModule` versions per module path,
 * and lets go of the least recently read value when over `budgetBytes`. A
 * value bigger than the whole budget is still held while it is the newest,
 * so the read that made it is answered; the next put lets it go.
 */
export function memoryTier(opts: {
  budgetBytes: number;
  lastPerModule: number;
  name?: string;
}): MemoryTier {
  /** In least-recently-read order: a read moves a key to the end. */
  const held = new Map<string, { value: StoredModule; bytes: number }>();
  /** Per module, its keys oldest first. */
  const rings = new Map<ModuleFilePath, string[]>();
  let bytes = 0;
  let evicted = 0;

  const drop = (key: string) => {
    const entry = held.get(key);
    if (entry === undefined) return;
    held.delete(key);
    bytes -= entry.bytes;
    evicted++;
    const ring = rings.get(entry.value.path);
    if (ring !== undefined) {
      const at = ring.indexOf(key);
      if (at >= 0) ring.splice(at, 1);
      if (ring.length === 0) rings.delete(entry.value.path);
    }
  };

  return {
    name: opts.name ?? "memory",
    get(key) {
      const entry = held.get(key);
      if (entry === undefined) return null;
      held.delete(key);
      held.set(key, entry);
      return entry.value;
    },
    put(key, value, valueBytes) {
      if (held.has(key)) {
        drop(key);
        evicted--;
      }
      held.set(key, { value, bytes: valueBytes });
      bytes += valueBytes;
      const ring = rings.get(value.path) ?? [];
      ring.push(key);
      rings.set(value.path, ring);
      while (ring.length > opts.lastPerModule) {
        const oldest = ring[0];
        if (oldest === undefined) break;
        drop(oldest);
      }
      for (const lru of held.keys()) {
        if (bytes <= opts.budgetBytes) break;
        if (lru === key) continue;
        drop(lru);
      }
    },
    charge(key, extra) {
      const entry = held.get(key);
      if (entry === undefined) return;
      entry.bytes += extra;
      bytes += extra;
    },
    latest(path) {
      const ring = rings.get(path);
      const newest = ring?.[ring.length - 1];
      return newest === undefined ? null : (held.get(newest)?.value ?? null);
    },
    stats() {
      let mostVersions = 0;
      let mostBytes = 0;
      for (const ring of rings.values()) {
        mostVersions = Math.max(mostVersions, ring.length);
        let moduleBytes = 0;
        for (const key of ring) moduleBytes += held.get(key)?.bytes ?? 0;
        mostBytes = Math.max(mostBytes, moduleBytes);
      }
      return {
        bytes,
        versions: held.size,
        modules: rings.size,
        mostVersionsOfOneModule: mostVersions,
        mostBytesOfOneModule: mostBytes,
        evicted,
      };
    },
  };
}

// #region bundle

/**
 * The build's own modules, free: answers only a key whose version is the
 * bundle's -- its schema, its base and the empty chain -- with the bundle's
 * own object, which the process holds for every visitor anyway. `bundle`
 * says what the build evaluated each module to; `null` for a module the
 * build does not have.
 */
export function bundleTier(
  bundle: (
    path: ModuleFilePath,
  ) =>
    | { version: ModuleVersion; source: Json }
    | null
    | Promise<{ version: ModuleVersion; source: Json } | null>,
  name: string = "bundle",
): ModuleTier {
  return {
    name,
    async get(key) {
      const path = pathOfModuleKey(key);
      if (path === null) return null;
      const own = await bundle(path);
      if (own === null) return null;
      const version: ModuleVersion = { ...own.version, chain: EMPTY_CHAIN };
      if (moduleKey(path, version) !== key) return null;
      return {
        path,
        version,
        content: baseModuleContent(own.source as ReadonlyJSONValue),
        patches: [],
        bytes: 0,
      };
    },
  };
}

/** The module a {@link moduleKey} is the address of, or `null` for none. */
export function pathOfModuleKey(key: string): ModuleFilePath | null {
  const at = key.lastIndexOf("@");
  return at <= 0 ? null : (key.slice(0, at) as ModuleFilePath);
}

/**
 * The version a {@link moduleKey} names, or `null` when it is not one. The
 * three parts are hex or empty, so the split is unambiguous.
 */
export function parseModuleKey(
  key: string,
): { path: ModuleFilePath; version: ModuleVersion } | null {
  const path = pathOfModuleKey(key);
  if (path === null) return null;
  const parts = key.slice(path.length + 1).split(".");
  const [schema, base, chain] = parts;
  if (
    parts.length !== 3 ||
    schema === undefined ||
    base === undefined ||
    chain === undefined
  ) {
    return null;
  }
  return { path, version: { schema, base, chain } };
}

// #region entries

/**
 * A `.jsonValues()` entry's version: the record's schema and base, the
 * entry's key, and the chain of the record's patches that touched THIS
 * entry -- so an entry no patch touched keeps its version while the record's
 * chain grows, and two reads at one entry version are the same content.
 * Entries are stored on their own, so a large record is not copied because
 * one entry changed.
 */
export type EntryVersion = ModuleVersion & { key: string };

/** The address of an entry's content. Never changes meaning. */
export function entryAddress(path: ModuleFilePath, v: EntryVersion): string {
  return `${moduleKey(path, v)}#${v.key}`;
}

/** Whether two entry versions name the same content. */
export function sameEntryVersion(a: EntryVersion, b: EntryVersion): boolean {
  return (
    a.key === b.key &&
    a.schema === b.schema &&
    a.base === b.base &&
    a.chain === b.chain
  );
}
