import {
  Internal,
  type Json,
  type ModuleFilePath,
  type PatchId,
} from "@valbuild/core";
import type { SerializedSchema } from "@valbuild/core";
import type { JSONValue, ReadonlyJSONValue } from "@valbuild/core/patch";
import {
  EMPTY_CHAIN,
  applyPatchRecord,
  baseModuleContent,
  bundleTier,
  engineWork,
  entryState,
  extendChain,
  memoryTier,
  moduleKey,
  parseModuleKey,
  resolveEntry,
  tiered,
  type EntryState,
  type EntryVersion,
  type MemoryTier,
  type MemoryTierStats,
  type ModuleContent,
  type ModuleTier,
  type ModuleVersion,
  type PatchRecord,
  type ProjectVersion,
  type StoredModule,
} from "@valbuild/shared/internal";
import type {
  GenericErrorMessage,
  OrderedPatches,
  PatchAnalysis,
  ValOps,
} from "./ValOps";
import { draftOverlay } from "./draftOverlay";

/*
 * THE HEAD: the content at the newest chain, in the module store. See
 * `docs/plans/one-content-model.md`, "One runtime per process, and the head".
 *
 * One per data layer (`ValOps`), and so one per process for a project
 * (`valRuntime`): the API route, the draft readers and MCP read through the
 * same one, so a save moves every reader, and one head serves every editor --
 * draft content is not per user; the session only decides who may see it.
 *
 * In a 128 MB isolate it grows only with what was edited:
 *
 * 1. An unpatched module costs nothing: the bundle tier answers with the
 *    bundle's own object, which the process holds for every visitor anyway.
 * 2. A module is materialized when it is read and has patches, never all at
 *    once, and the next version of its chain is EXTENDED from the one before
 *    by the new patches alone.
 * 3. A discard replays one module from its base through its own patches.
 * 4. The memory tier's byte budget ({@link HEAD_BUDGET_BYTES}) lets go of the
 *    least recently read module, which is made again on its next read; and
 *    it keeps the last {@link HEAD_VERSIONS_PER_MODULE} versions of each.
 * 5. No validation and no previews on the read path. They are their own
 *    requests (`/validate`, the Studio's own previews).
 *
 * "Has the chain moved?" is `seq` alone (`ValOps.chainSeq`): a counter in fs
 * and memory mode, one small read of the content service in http mode. The
 * chain is fetched only when it moved.
 */

/**
 * What the head may hold beyond what the build holds anyway: 16 MB, about
 * where a deployed isolate beside 64 MB of other heap stopped outliving a
 * validated whole-tree draft read (`scenarios/measure/results.md`, "The
 * deployed isolate").
 */
export const HEAD_BUDGET_BYTES = 16 * 1024 * 1024;

/** The current version of each module and the one before it. */
export const HEAD_VERSIONS_PER_MODULE = 2;

/**
 * Counted work, in this process, for every head: never reset, so two readers
 * of it cannot disturb each other. A test takes it before and after.
 */
const counted = {
  /** "Has the chain moved?" asked. */
  seqReads: 0,
  /** The chain fetched, because it had. */
  chainReads: 0,
  /** Modules made from a base or an older version. */
  materialized: 0,
  /** Of those, made by extending the version before by the new patches. */
  extended: 0,
};

/** See {@link counted}. */
export function headWork(): Readonly<typeof counted> {
  return { ...counted };
}

/** The chain, as the head last read it. */
export type HeadChain = {
  /** The `seq` it was read at, when the store keeps one; `null`: always re-read. */
  readonly seq: number | null;
  /** The base it is relative to (`sourcesSha`): a publish moves it. */
  readonly base: string;
  readonly project: ProjectVersion;
  /** As fetched, ops and all. */
  readonly fetched: OrderedPatches;
  /** What a draft applies, in chain order (`draftOverlay`). */
  readonly overlay: OrderedPatches["patches"];
  readonly byModule: ReadonlyMap<ModuleFilePath, readonly PatchRecord[]>;
  /** Every module's version at the whole of its chain. */
  readonly versions: Readonly<Record<ModuleFilePath, ModuleVersion>>;
  readonly analysis: PatchAnalysis;
};

export type HeadError = {
  message: string;
  unauthorized?: boolean;
  networkError?: boolean;
};

export type HeadResult<T> = { ok: T } | { error: HeadError };

/** What the head knows about a module it made, beside its content. */
type ModuleFacts = {
  /** The patch its chain stopped at: it and every later one did not apply. */
  failed: { patchId: PatchId; message: string } | null;
  /** How many of the module's patches applied. */
  applied: number;
  /**
   * Per `.jsonValues()` entry, the chain of the patches that touched it; a
   * key not here was touched by none, or only by a write of the whole
   * record ({@link wholeChain}).
   */
  entryChains: ReadonlyMap<string, string>;
  wholeChain: string;
  /** Entries resolved on this version, by key: made once. */
  resolved: Map<string, ResolvedEntry>;
  /** The draft a reader gets of this version, made once. */
  draft: Draft | null;
};

type ResolvedEntry =
  | { kind: "content"; content: ReadonlyJSONValue }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/** A module as the head answers it. */
export type HeadModule = {
  readonly module: StoredModule;
  /** The version at the whole chain: what was asked for. */
  readonly asked: ModuleVersion;
  readonly failed: { patchId: PatchId; message: string } | null;
  readonly applied: number;
  /** The module's patches in the chain, applied or not. */
  readonly records: readonly PatchRecord[];
};

/**
 * What a draft reader is given for a module: the bundle's own (read the
 * bundle), or the head's source in its wire shape -- `.jsonValues()` markers
 * without their `import()`, and the entries the draft changes in place of
 * theirs.
 */
export type Draft =
  | { kind: "bundle"; version: ModuleVersion }
  | {
      kind: "draft";
      version: ModuleVersion;
      source: Json;
      /**
       * Whether a draft changes it: a patch in its chain, or an entry a
       * publish wrote that the bundle does not have yet. A module that is
       * neither and still not the bundle's is a content version's or a
       * proposal's base.
       */
      changed: boolean;
      /** The entries it changes could not all be read: `source` has markers. */
      entriesFailed: boolean;
    };

/** One entry, as `/json` and the draft readers answer it. */
export type HeadEntries = {
  entries: { key: string; content: ReadonlyJSONValue | null }[];
  missing: string[];
  errors: { key: string; message: string }[];
  total: number;
  version: ModuleVersion;
  /** Each read entry's own version. */
  entryVersions: Record<string, EntryVersion>;
};

export class ValHead {
  private readonly memory: MemoryTier;
  private readonly store: ModuleTier;
  private readonly facts = new WeakMap<StoredModule, ModuleFacts>();
  private chain: HeadChain | null = null;
  private fetching: {
    seq: number;
    promise: Promise<HeadResult<HeadChain>>;
  } | null = null;
  private serialized: Promise<
    Record<ModuleFilePath, SerializedSchema | undefined>
  > | null = null;
  private wholeTree: {
    chain: HeadChain;
    promise: Promise<HeadResult<HeadTree>>;
  } | null = null;

  constructor(
    private readonly ops: ValOps,
    opts: { budgetBytes?: number; lastPerModule?: number } = {},
  ) {
    this.memory = memoryTier({
      budgetBytes: opts.budgetBytes ?? HEAD_BUDGET_BYTES,
      lastPerModule: opts.lastPerModule ?? HEAD_VERSIONS_PER_MODULE,
    });
    this.store = tiered([
      this.memory,
      bundleTier((path) => this.ops.bundleModule(path)),
      // What the build serves where it is not the bundle: a content version,
      // a proposal's saves, a publish adopted in this process.
      bundleTier((path) => this.ops.baseModule(path), "base"),
    ]);
  }

  /** What the head holds now. */
  stats(): MemoryTierStats {
    return this.memory.stats();
  }

  // #region the chain

  /**
   * The chain, re-read only when `seq` moved (or the base did: a publish
   * adopted). A read that finds a fetch already under way at the `seq` it
   * saw joins it: that fetch reads at that `seq` or later.
   */
  async sync(): Promise<HeadResult<HeadChain>> {
    counted.seqReads++;
    const [seq, base] = await Promise.all([
      this.ops.chainSeq(),
      this.ops.getSourcesSha(),
    ]);
    const held = this.chain;
    if (
      held !== null &&
      seq !== null &&
      held.seq === seq &&
      held.base === base
    ) {
      return { ok: held };
    }
    if (seq !== null && this.fetching !== null && this.fetching.seq === seq) {
      return this.fetching.promise;
    }
    const promise = this.fetchChain(seq, base);
    if (seq !== null) {
      this.fetching = { seq, promise };
      void promise.finally(() => {
        if (this.fetching?.promise === promise) this.fetching = null;
      });
    }
    return promise;
  }

  private async fetchChain(
    seq: number | null,
    base: string,
  ): Promise<HeadResult<HeadChain>> {
    counted.chainReads++;
    const before = await this.ops.projectVersion();
    const fetched = await this.ops.fetchPatches({ excludePatchOps: false });
    if (fetched.error) {
      return {
        error: {
          message: fetched.error.message,
          ...(fetched.unauthorized ? { unauthorized: true } : {}),
          ...(fetched.networkError ? { networkError: true } : {}),
        },
      };
    }
    const overlay = draftOverlay(fetched.patches, fetched.commits);
    const byModule = new Map<ModuleFilePath, PatchRecord[]>();
    for (const patch of overlay) {
      const records = byModule.get(patch.path);
      if (records === undefined) byModule.set(patch.path, [patch]);
      else records.push(patch);
    }
    const versions = await this.ops.moduleVersions(overlay);
    const project: ProjectVersion =
      fetched.headVersion !== undefined
        ? { build: before.build, seq: fetched.headVersion }
        : before;
    const chain: HeadChain = {
      seq: fetched.headVersion ?? seq,
      base,
      project,
      fetched,
      overlay,
      byModule,
      versions,
      analysis: this.ops.analyzePatches(overlay),
    };
    // Never put back an older chain over a newer one read meanwhile.
    if (
      this.chain === null ||
      this.chain.base !== base ||
      this.chain.project.seq <= project.seq
    ) {
      this.chain = chain;
    }
    return { ok: chain };
  }

  /**
   * Every module's serialized schema, serialized once per data layer (a new
   * build is a new one): what the engine reads `.jsonValues()` records from,
   * and MCP's tools their schemas.
   */
  serializedSchemas(): Promise<
    Record<ModuleFilePath, SerializedSchema | undefined>
  > {
    this.serialized ??= this.ops.getSchemas().then((schemas) => {
      const serialized: Record<ModuleFilePath, SerializedSchema | undefined> =
        {};
      for (const [path, schema] of Object.entries(schemas)) {
        try {
          serialized[path as ModuleFilePath] = schema["executeSerialize"]();
        } catch {
          // Reported elsewhere; read as "no schema", as the engine does.
          serialized[path as ModuleFilePath] = undefined;
        }
      }
      return serialized;
    });
    return this.serialized;
  }

  // #region modules

  /** A module at the newest chain, or `null` when there is no such module. */
  async module(path: ModuleFilePath): Promise<HeadResult<HeadModule | null>> {
    const synced = await this.sync();
    if ("error" in synced) return synced;
    return { ok: await this.moduleIn(synced.ok, path) };
  }

  private async moduleIn(
    chain: HeadChain,
    path: ModuleFilePath,
  ): Promise<HeadModule | null> {
    const asked = chain.versions[path];
    if (asked === undefined) return null;
    const records = chain.byModule.get(path) ?? [];
    const key = moduleKey(path, asked);
    const found = await this.store.get(key);
    if (found !== null) {
      const facts = this.factsOf(found);
      return {
        module: found,
        asked,
        failed: facts.failed,
        applied: facts.applied,
        records,
      };
    }
    const made = await this.make(path, asked, records);
    this.memory.put(key, made, made.bytes);
    const facts = this.factsOf(made);
    return {
      module: made,
      asked,
      failed: facts.failed,
      applied: facts.applied,
      records,
    };
  }

  /**
   * A module at `asked`, from the newest version held of the same base when
   * its chain is a start of this one (a keystroke: the new patch alone), and
   * from its base otherwise (a discard, a publish, an eviction).
   */
  private async make(
    path: ModuleFilePath,
    asked: ModuleVersion,
    records: readonly PatchRecord[],
  ): Promise<StoredModule> {
    counted.materialized++;
    const schema = (await this.serializedSchemas())[path];
    const isRecord = schema?.type === "record" && schema.jsonValues === true;
    let start: StoredModule | null = null;
    const latest = this.memory.latest(path);
    if (
      latest !== null &&
      latest.version.schema === asked.schema &&
      latest.version.base === asked.base &&
      this.factsOf(latest).failed === null &&
      latest.patches.length <= records.length &&
      latest.patches.every((id, i) => records[i]?.patchId === id)
    ) {
      start = latest;
      counted.extended++;
    }
    if (start === null) {
      start = await this.store.get(
        moduleKey(path, { ...asked, chain: EMPTY_CHAIN }),
      );
    }
    if (start === null) {
      // No base for this version: the module as the build serves it.
      const base = await this.ops.baseModule(path);
      start = {
        path,
        version: { ...asked, chain: EMPTY_CHAIN },
        content: baseModuleContent((base?.source ?? null) as ReadonlyJSONValue),
        patches: [],
        bytes: 0,
      };
    }
    const startFacts = this.factsOf(start);
    let content: ModuleContent = start.content;
    const ids: PatchId[] = [...start.patches];
    let failed: ModuleFacts["failed"] = null;
    let entryChains = startFacts.entryChains;
    let wholeChain = startFacts.wholeChain;
    for (const record of records.slice(start.patches.length)) {
      const res = applyPatchRecord(content, record, schema);
      if (res.status === "failed") {
        failed = { patchId: res.patchId, message: res.message };
        break;
      }
      if (isRecord) {
        const touched = touchedEntries(content, res.module);
        if (touched === "all") {
          wholeChain = extendChain(wholeChain, record.patchId);
          entryChains = new Map();
        } else if (touched.length > 0) {
          const next = new Map(entryChains);
          for (const key of touched) {
            next.set(
              key,
              extendChain(entryChains.get(key) ?? wholeChain, record.patchId),
            );
          }
          entryChains = next;
        }
      }
      content = res.module;
      ids.push(record.patchId);
    }
    const base =
      start.patches.length === 0
        ? start.content.source
        : ((await this.ops.baseModule(path))?.source ?? null);
    const bytes = heldBeyond(base, content.source) + entriesBytes(content);
    const version: ModuleVersion =
      failed === null
        ? asked
        : { ...asked, chain: this.ops.chainAt(path, ids.length) };
    const made: StoredModule = { path, version, content, patches: ids, bytes };
    this.facts.set(made, {
      failed,
      applied: ids.length,
      entryChains,
      wholeChain,
      resolved: new Map(),
      draft: null,
    });
    return made;
  }

  private factsOf(module: StoredModule): ModuleFacts {
    let facts = this.facts.get(module);
    if (facts === undefined) {
      facts = {
        failed: null,
        applied: module.patches.length,
        entryChains: new Map(),
        wholeChain: EMPTY_CHAIN,
        resolved: new Map(),
        draft: null,
      };
      this.facts.set(module, facts);
    }
    return facts;
  }

  // #region entries

  /**
   * `.jsonValues()` entries at the newest chain, by key: what the module's
   * chain made of each, and for an entry it holds edits for but nobody has
   * loaded, those edits on the base entry. Made once per entry and version.
   */
  async entries(
    path: ModuleFilePath,
    keys: readonly string[],
  ): Promise<
    | { status: "success"; value: HeadEntries }
    | { status: "not-found"; message: string }
    | { status: "error"; message: string }
  > {
    const synced = await this.sync();
    if ("error" in synced) {
      return { status: "error", message: synced.error.message };
    }
    const chain = synced.ok;
    if (chain.fetched.errors && chain.fetched.errors.length > 0) {
      return {
        status: "error",
        message: `Could not fetch patches: ${JSON.stringify(chain.fetched.errors)}`,
      };
    }
    const base = await this.ops.baseModule(path);
    if (
      base === null ||
      base.source === null ||
      typeof base.source !== "object" ||
      Array.isArray(base.source)
    ) {
      return {
        status: "not-found",
        message:
          base === null || base.source === null
            ? `Module not found: ${path}`
            : `Module is not a record: ${path}`,
      };
    }
    const held = await this.moduleIn(chain, path);
    if (held === null) {
      return { status: "not-found", message: `Module not found: ${path}` };
    }
    const record = base.source as Record<string, unknown>;
    const facts = this.factsOf(held.module);
    const value: HeadEntries = {
      entries: [],
      missing: [],
      errors: [],
      total: Object.keys(record).length,
      version: held.module.version,
      entryVersions: {},
    };
    await Promise.all(
      keys
        .filter((key) => !facts.resolved.has(key))
        .map(async (key) => {
          facts.resolved.set(
            key,
            await this.resolve(path, record, held.module, key),
          );
        }),
    );
    for (const key of keys) {
      const marker = record[key];
      if (marker !== undefined && !Internal.isJson(marker)) {
        // Not a jsonValues entry: the value inlined in the module, as is.
        value.entries.push({ key, content: marker as JSONValue });
        continue;
      }
      const read = facts.resolved.get(key);
      if (read === undefined || read.kind === "missing") {
        value.missing.push(key);
      } else if (read.kind === "error") {
        value.errors.push({ key, message: read.message });
      } else {
        value.entries.push({ key, content: read.content });
        value.entryVersions[key] = {
          ...held.module.version,
          key,
          chain: facts.entryChains.get(key) ?? facts.wholeChain,
        };
      }
    }
    return { status: "success", value };
  }

  private async resolve(
    path: ModuleFilePath,
    baseRecord: Record<string, unknown>,
    module: StoredModule,
    key: string,
  ): Promise<ResolvedEntry> {
    const state: EntryState | undefined = entryState(module.content, key);
    let from: { content: JSONValue | undefined } | { message: string } = {
      content: undefined,
    };
    if (state?.kind === "waiting") {
      from = await this.ops.baseJsonEntry(path, baseRecord, state.from);
      if ("message" in from) return { kind: "error", message: from.message };
    }
    const copiedBefore = engineWork().cloneBytes;
    const read = resolveEntry(key, state, () =>
      "content" in from ? from.content : undefined,
    );
    if (read.kind === "content" && state?.kind === "waiting" && state.ops) {
      // Held edits made a new entry: the head holds it now.
      this.memory.charge(
        moduleKey(path, module.version),
        engineWork().cloneBytes - copiedBefore,
      );
    }
    return read;
  }

  // #region drafts

  /**
   * A module as a draft reader is given it ({@link Draft}): `bundle` when the
   * newest version is the bundle's own -- the reader's bundle answers, and
   * nothing is read -- and otherwise the head's, made once per version.
   */
  async draft(path: ModuleFilePath): Promise<HeadResult<Draft | null>> {
    const synced = await this.sync();
    if ("error" in synced) return synced;
    const chain = synced.ok;
    const asked = chain.versions[path];
    if (asked === undefined) return { ok: null };
    const bundle = await this.ops.bundleModule(path);
    if (
      bundle !== null &&
      asked.chain === EMPTY_CHAIN &&
      bundle.version.schema === asked.schema &&
      bundle.version.base === asked.base
    ) {
      return { ok: { kind: "bundle", version: asked } };
    }
    const held = await this.moduleIn(chain, path);
    if (held === null) return { ok: null };
    const facts = this.factsOf(held.module);
    if (facts.draft === null) {
      facts.draft = await this.makeDraft(path, held);
    }
    return { ok: facts.draft };
  }

  private async makeDraft(
    path: ModuleFilePath,
    held: HeadModule,
  ): Promise<Draft> {
    const source = held.module.content.source as Json;
    const version = held.module.version;
    if (!isRecordOfMarkers(source)) {
      return {
        kind: "draft",
        version,
        source,
        changed: held.records.length > 0,
        entriesFailed: false,
      };
    }
    // The entries a draft changes: the ones the chain touched, and the ones
    // a publish wrote that the bundle has not got (a marker with a
    // `patch_id`). Every other one is the bundle's, behind its marker.
    const wire: Record<string, Json> = {};
    const fill: string[] = [];
    const touched = held.module.content.entries;
    let fromServer = false;
    for (const [key, value] of Object.entries(source)) {
      if (Internal.isJson(value)) {
        wire[key] = transportMarker(value);
        const published = Internal.isJsonFromServer(value);
        fromServer ||= published;
        if (published || touched.has(key)) fill.push(key);
      } else {
        wire[key] = value;
      }
    }
    let entriesFailed = false;
    if (fill.length > 0) {
      const read = await this.entries(path, fill);
      if (
        read.status !== "success" ||
        read.value.errors.length > 0 ||
        read.value.missing.length > 0
      ) {
        entriesFailed = true;
      } else {
        for (const { key, content } of read.value.entries) {
          wire[key] = content as Json;
        }
      }
    }
    return {
      kind: "draft",
      version,
      source: entriesFailed ? stripped(source) : wire,
      changed: held.records.length > 0 || fromServer,
      entriesFailed,
    };
  }

  /**
   * The modules a draft changes: a patch in their chain, or an entry a
   * publish wrote that the bundle has not got. What `fetchValDraft` sends.
   */
  async changed(): Promise<HeadResult<ModuleFilePath[]>> {
    const synced = await this.sync();
    if ("error" in synced) return synced;
    const changed = new Set<ModuleFilePath>(synced.ok.byModule.keys());
    for (const path of Object.keys(synced.ok.versions) as ModuleFilePath[]) {
      if (changed.has(path)) continue;
      const base = await this.ops.baseModule(path);
      if (base !== null && hasMarkersFromServer(base.source)) changed.add(path);
    }
    return { ok: [...changed] };
  }

  // #region the whole tree

  /**
   * Every module at the newest chain: the patched ones made (once per
   * version), the rest the base's own objects. What `PUT /sources/~` and
   * MCP read; made once per chain.
   */
  async tree(): Promise<HeadResult<HeadTree>> {
    const synced = await this.sync();
    if ("error" in synced) return synced;
    const chain = synced.ok;
    if (this.wholeTree?.chain !== chain) {
      this.wholeTree = { chain, promise: this.makeTree(chain) };
    }
    return this.wholeTree.promise;
  }

  private async makeTree(chain: HeadChain): Promise<HeadResult<HeadTree>> {
    const base = await this.ops.getBaseSources();
    const sources: Record<ModuleFilePath, Json> = { ...base } as Record<
      ModuleFilePath,
      Json
    >;
    const errors: HeadTree["errors"] = {};
    const stopped: Record<ModuleFilePath, number> = {};
    const versions: Record<ModuleFilePath, ModuleVersion> = {
      ...chain.versions,
    };
    for (const patch of chain.overlay) {
      if (base[patch.path] === undefined && errors[patch.path] === undefined) {
        errors[patch.path] = [];
      }
    }
    for (const [path, records] of chain.byModule) {
      if (base[path] === undefined) {
        Internal.log.error("Module not found", path);
        errors[path] = records.map((record) => ({
          patchId: record.patchId,
          skipped: true,
          error: { message: "Module not found" },
        }));
        continue;
      }
      const held = await this.moduleIn(chain, path);
      if (held === null) continue;
      sources[path] = held.module.content.source as Json;
      versions[path] = held.module.version;
      if (held.failed !== null) {
        Internal.log.error("Could not apply patch", {
          path,
          patchId: held.failed.patchId,
          error: held.failed.message,
        });
        stopped[path] = held.applied;
        errors[path] = [
          {
            patchId: held.failed.patchId,
            skipped: false,
            error: { message: held.failed.message },
          },
          ...records.slice(held.applied + 1).map((record) => ({
            patchId: record.patchId,
            skipped: true,
            error: { message: "Cannot apply patch: previous errors exists" },
          })),
        ];
      }
    }
    for (const [path, list] of Object.entries(errors)) {
      if (list.length === 0) delete errors[path as ModuleFilePath];
    }
    return { ok: { chain, sources, errors, stopped, versions } };
  }

  // #region the module endpoint

  /**
   * `GET /modules`: one module at a version. `v` the version wanted (by
   * default the newest); `have` the version the caller holds, from which the
   * answer is a delta -- the patches from it -- when the caller's chain is a
   * start of this one under the same schema and base.
   */
  async answer(
    path: ModuleFilePath,
    opts: { v?: string; have?: string },
  ): Promise<
    HeadResult<
      ModuleAnswer | { kind: "not-held"; current: ModuleVersion } | null
    >
  > {
    const synced = await this.sync();
    if ("error" in synced) return synced;
    const chain = synced.ok;
    const current = await this.moduleIn(chain, path);
    if (current === null) return { ok: null };
    let target: StoredModule = current.module;
    let isCurrent = true;
    if (opts.v !== undefined) {
      const wanted = parseModuleKey(opts.v);
      if (wanted === null || wanted.path !== path) {
        return { ok: { kind: "not-held", current: current.module.version } };
      }
      const currentKeys = [
        moduleKey(path, current.module.version),
        moduleKey(path, current.asked),
      ];
      if (!currentKeys.includes(opts.v)) {
        const held = await this.store.get(opts.v);
        if (held === null) {
          return { ok: { kind: "not-held", current: current.module.version } };
        }
        target = held;
        isCurrent = false;
      }
    }
    const have = opts.have !== undefined ? parseModuleKey(opts.have) : null;
    if (
      isCurrent &&
      have !== null &&
      have.path === path &&
      have.version.schema === target.version.schema &&
      have.version.base === target.version.base
    ) {
      const facts = this.factsOf(target);
      for (let n = facts.applied; n >= 0; n--) {
        if (this.ops.chainAt(path, n) === have.version.chain) {
          return {
            ok: {
              kind: "delta",
              from: have.version,
              to: target.version,
              patches: current.records
                .slice(n, facts.applied)
                .map(({ patchId, patch }) => ({ patchId, patch })),
            },
          };
        }
      }
    }
    const facts = this.factsOf(target);
    const source = target.content.source as Json;
    const entries: ModuleAnswerEntries = {};
    if (isRecordOfMarkers(source)) {
      const baseModule = await this.ops.baseModule(path);
      const baseRecord =
        baseModule !== null &&
        typeof baseModule.source === "object" &&
        baseModule.source !== null &&
        !Array.isArray(baseModule.source)
          ? (baseModule.source as Record<string, unknown>)
          : {};
      for (const key of target.content.entries.keys()) {
        let read = facts.resolved.get(key);
        if (read === undefined) {
          read = await this.resolve(path, baseRecord, target, key);
          facts.resolved.set(key, read);
        }
        const version: EntryVersion = {
          ...target.version,
          key,
          chain: facts.entryChains.get(key) ?? facts.wholeChain,
        };
        entries[key] =
          read.kind === "content"
            ? { content: read.content as Json, version }
            : read.kind === "missing"
              ? { deleted: true, version }
              : { error: read.message, version };
      }
    }
    return {
      ok: {
        kind: "module",
        version: target.version,
        source: isRecordOfMarkers(source) ? stripped(source) : source,
        entries,
        ...(facts.failed !== null ? { failed: facts.failed } : {}),
      },
    };
  }
}

/** What {@link ValHead.tree} answers. */
export type HeadTree = {
  chain: HeadChain;
  sources: Record<ModuleFilePath, Json>;
  errors: Record<
    ModuleFilePath,
    { patchId: PatchId; skipped: boolean; error: GenericErrorMessage }[]
  >;
  /** For a module whose chain stopped: how many of its patches applied. */
  stopped: Record<ModuleFilePath, number>;
  /** Each module's version as answered: where its chain stopped, if it did. */
  versions: Record<ModuleFilePath, ModuleVersion>;
};

export type ModuleAnswerEntries = Record<
  string,
  | { content: Json; version: EntryVersion }
  | { deleted: true; version: EntryVersion }
  | { error: string; version: EntryVersion }
>;

/** What `GET /modules` answers: see `ModuleAnswer` in the plan. */
export type ModuleAnswer =
  | {
      kind: "module";
      version: ModuleVersion;
      /** `.jsonValues()` markers without their `import()`. */
      source: Json;
      /** The entries its chain touched, read. Every other entry is the base's. */
      entries: ModuleAnswerEntries;
      /** Where its chain stopped, when a patch did not apply. */
      failed?: { patchId: PatchId; message: string };
    }
  | {
      kind: "delta";
      from: ModuleVersion;
      to: ModuleVersion;
      patches: PatchRecord[];
    };

/**
 * The entries a patch touched: the ones whose state it replaced, or `all`
 * when it replaced the record (every entry went, or the map was reset).
 */
function touchedEntries(
  before: ModuleContent,
  after: ModuleContent,
): string[] | "all" {
  if (after.entries === before.entries) return [];
  if (after.entries.size < before.entries.size) return "all";
  const touched: string[] = [];
  for (const [key, state] of after.entries) {
    if (before.entries.get(key) !== state) touched.push(key);
  }
  return touched;
}

/**
 * What `next` holds that `base` does not: every container copy-on-write made
 * (8 bytes a slot, as the engine counts them) and every string a patch
 * brought, walking only where the two differ -- a subtree the patches did not
 * touch is the base's own object, which the build holds anyway. A child that
 * is one of the base container's own children (moved, or shifted by an
 * insert) costs nothing. What the head's byte budget is measured in.
 */
export function heldBeyond(base: unknown, next: unknown): number {
  if (base === next) return 0;
  if (typeof next === "string") return next.length;
  if (typeof next !== "object" || next === null) return 8;
  const shared = new Set<unknown>(
    typeof base === "object" && base !== null ? Object.values(base) : [],
  );
  let bytes = 0;
  if (Array.isArray(next)) {
    bytes += 8 * next.length;
    for (const [index, child] of next.entries()) {
      if (shared.has(child)) continue;
      bytes += heldBeyond(Array.isArray(base) ? base[index] : undefined, child);
    }
    return bytes;
  }
  const record = base as Record<string, unknown> | null | undefined;
  for (const [key, child] of Object.entries(next)) {
    bytes += 8;
    if (shared.has(child)) continue;
    bytes += heldBeyond(
      typeof record === "object" && record !== null && !Array.isArray(record)
        ? record[key]
        : undefined,
      child,
    );
  }
  return bytes;
}

/** What the entries a chain wrote hold: their content, which patches brought. */
function entriesBytes(content: ModuleContent): number {
  let bytes = 8 * content.entries.size;
  for (const state of content.entries.values()) {
    if (state.kind === "content") bytes += heldBeyond(undefined, state.content);
  }
  return bytes;
}

function isRecordOfMarkers(source: unknown): source is Record<string, Json> {
  return (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    Object.values(source).some((value) => Internal.isJson(value))
  );
}

function hasMarkersFromServer(source: unknown): boolean {
  return (
    isRecordOfMarkers(source) &&
    Object.values(source).some((value) => Internal.isJsonFromServer(value))
  );
}

/** A marker as it travels: without the `import()` only this process can run. */
function transportMarker(marker: Json): Json {
  if (typeof marker !== "object" || marker === null || Array.isArray(marker)) {
    return marker;
  }
  const copy: Record<string, Json> = {};
  for (const [key, value] of Object.entries(marker)) {
    if (typeof value !== "function") copy[key] = value as Json;
  }
  return copy;
}

/** A record of markers, as it travels. */
function stripped(source: Record<string, Json>): Json {
  const wire: Record<string, Json> = {};
  for (const [key, value] of Object.entries(source)) {
    wire[key] = Internal.isJson(value) ? transportMarker(value) : value;
  }
  return wire;
}
