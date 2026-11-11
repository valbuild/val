import {
  Internal,
  type Json,
  type ModuleFilePath,
  type PatchId,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import { deepClone, type JSONValue } from "@valbuild/core/patch";
import {
  baseVersionOf,
  JSON_ENTRIES_BATCH_MAX,
  engineWork,
  entryState,
  schemaVersionOf,
  versionHashCount,
  type ModuleContent,
  type ModuleVersion,
} from "@valbuild/shared/internal";
import { StoreBus } from "./StoreBus";
import { touchesPath, type ChangedPath } from "./pathMatch";
import type {
  FieldEvent,
  PatchOrigin,
  PatchRecord,
  Revision,
  SourceRead,
  SystemEvent,
} from "./types";
import type { SchemaStore } from "./SchemaStore";
import { APPLIED_ELSEWHERE_SHA, type PatchStore } from "./PatchStore";
import { noopActivity, type ActivitySink } from "./activity";
import {
  JSON_ENTRY_KEYS_PER_REQUEST,
  chunkJsonEntryKeys,
  type FetchJsonEntries,
  type JsonEntryResult,
} from "./react/jsonEntriesBatch";
import { yieldToMain } from "./yieldToMain";
import {
  VersionRing,
  applyOnBase,
  baseAt,
  chainTouches,
  engineSchemaKey,
  fetchKeyOf,
  isJsonObject,
  resolveAt,
  extendBy,
  serverAt,
  viewOf,
  withLocalEdits,
  type ModuleAt,
  type ModuleInputs,
  type ModuleView,
  type ResolvedEntries,
} from "./studioView";
import type { OriginModule } from "./originTier";

/**
 * Fetch one `.jsonValues()` entry's content (`GET /json` in the app), as the
 * BASE has it: without patches, which the Studio applies itself.
 *
 * Injected like the other seams. Absent means this system cannot read INTO an
 * entry — the read reports an error rather than pretending the path is absent,
 * because "not there" and "nobody can fetch it" are different facts.
 */
export type FetchJsonEntry = (
  moduleFilePath: ModuleFilePath,
  key: string,
) => Promise<
  { status: "ok"; content: Json } | { status: "error"; message: string }
>;

/**
 * What `peek` says, without loading anything.
 *
 * `peek` exists because `get` has a SIDE EFFECT: it triggers an entry fetch. The
 * moment a read can cause work, anything that merely wants to look — a nav menu
 * counting entries, a badge, a progress indicator — becomes a fetch storm. So the
 * two are a pair: `get` asks for content and accepts the cost, `peek` observes
 * and cannot cost anything.
 *
 * ## `ready` carries the value
 *
 * This IS the synchronous read: a field's `getSnapshot` peeks, which renders
 * once; a field that peeks and is told `entry-missing` calls `get`, which
 * fetches. **`peek` to render, `get` to demand.**
 *
 * `get` stays async regardless: a `.jsonValues()` entry fetch is a real network
 * round trip and no signature can pretend otherwise.
 */
export type SourcePeek =
  | {
      status: "ready";
      revision: Revision;
      /**
       * The value at the path. A reference into the store's own content, not a
       * copy. Callers must not mutate it — the same contract every other
       * in-realm read in this system has.
       */
      data: Json;
    }
  | { status: "absent"; revision: Revision }
  /** The module itself has not arrived. Nothing a read could do about it. */
  | { status: "module-loading" }
  /** Inside a `.jsonValues()` entry whose content has not been fetched. */
  | { status: "entry-missing"; key: string }
  /** Inside an entry whose fetch is in flight. */
  | { status: "entry-loading"; key: string }
  /**
   * Inside an entry whose last fetch FAILED, or that an edit in the chain does
   * not fit.
   *
   * Distinct from `entry-missing` because the two demand opposite things of a
   * caller: missing means "ask for it", failed means "stop asking and say so".
   * Collapsing them is how a failed entry becomes a spinner that never resolves.
   */
  | { status: "entry-failed"; key: string; message: string };

/**
 * How a batch of patches arrives at the source store.
 *
 * Three variants, and the difference between them is exactly one thing: who is
 * woken when the source moves. A reader of {@link SourceStore.intake} can see
 * the whole rule at once, and a fourth way for a patch to arrive has to say
 * which of these it behaves like.
 */
export type PatchIntake =
  /**
   * Made HERE, by a field instance in this session.
   *
   * `creatorOf` is asked per patch rather than passed as one id, because a
   * batch can carry patches from different instances. The instance that made a
   * patch is left asleep when it lands; everyone else on the path, including a
   * second instance rendering the same path, is woken.
   */
  | {
      kind: "local";
      records: PatchRecord[];
      creatorOf: (patchId: PatchId) => string | undefined;
    }
  /** Made elsewhere — another tab, another editor, the CLI. */
  | { kind: "foreign"; records: PatchRecord[] }
  /**
   * Gone: refused by the server, discarded, or dropped as unapplicable.
   *
   * The module is computed again from its base and what survives — the
   * version before the newest patch, when that is the one that went, is kept
   * ({@link VersionRing}). Everyone whose value moved is woken, INCLUDING the
   * author: the field that typed the value is exactly the one now showing
   * something that does not exist anywhere.
   */
  | {
      kind: "revoked";
      patchIds: readonly PatchId[];
      modules: readonly ModuleFilePath[];
      /**
       * Gone for a reason this tab cannot tell (`patch:drop`'s `vanished`):
       * the `.jsonValues()` entries they wrote into are read again rather
       * than kept as they were loaded. See `forgetEntriesOf`.
       */
      vanished: boolean;
    };

/** The shape {@link SourceStore.entriesStatus} answers with. */
type EntriesStatus = {
  status: "complete" | "incomplete" | "error";
  errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
};

/**
 * Are two entry statuses the same answer? Compared field by field: the error
 * list is small and ordered by the walk.
 */
function sameEntriesStatus(a: EntriesStatus, b: EntriesStatus): boolean {
  if (a.status !== b.status || a.errors.length !== b.errors.length) {
    return false;
  }
  for (let index = 0; index < a.errors.length; index++) {
    const left = a.errors[index];
    const right = b.errors[index];
    if (
      left.moduleFilePath !== right.moduleFilePath ||
      left.key !== right.key ||
      left.message !== right.message
    ) {
      return false;
    }
  }
  return true;
}

/** One patch in a module's chain, and who made it. */
type ChainEntry = {
  record: PatchRecord;
  origin: PatchOrigin;
  creatorFieldId?: string;
};

/**
 * Has this patch shipped?
 *
 * `appliedAt` is `null` for a patch the server knows about and has not
 * committed, and `undefined` for one created locally, which by definition has
 * not — so BOTH mean "still pending" and only a commit sha means shipped.
 */
function isApplied(record: PatchRecord): boolean {
  return record.appliedAt !== null && record.appliedAt !== undefined;
}

/** A module's view, and what it was made from. */
/** See {@link SourceStore.rowStates}. */
export type EntryRowStates = {
  unloadedKeys: ReadonlySet<string>;
  errorByKey: ReadonlyMap<string, string>;
};
const NO_ROW_STATES: EntryRowStates = {
  unloadedKeys: new Set(),
  errorByKey: new Map(),
};

type Viewed = {
  view: ModuleView;
  /** The base entries it read, by their epoch. */
  entriesEpoch: number;
};

/** What a `peek` answered, and what it was answered at. */
type Peeked = {
  view: ModuleView | undefined;
  schema: SerializedSchema | undefined;
  n: number;
  fetchEpoch: number;
  peek: SourcePeek;
};

/** The schema version of a module with none: nothing reads it. */
const NO_SCHEMA = "";

/**
 * `decidedAt` of a module no manifest has decided anything about: the
 * bundle's base before the first one, or a base new code moved here since.
 * Every patch of its chain is shown on top.
 */
const NOTHING_DECIDED = -1;

/** How many computed chains are remembered per module: see `SourceStore.knownChain`. */
const CHAINS_KEPT = 64;

/** The server's version below a module's view, as `withLocalEdits` reads it. */
type Below = {
  /** The patch ids it is made of. */
  readonly tried: readonly PatchId[];
  /** Its content, made only when the kept versions do not extend it. */
  readonly at: () => ModuleAt;
  readonly decidedAt: number;
};

/** A module at the version the server named for it. See `SourceStore.adoptServer`. */
export type ServerBelow = {
  /** As the server names it: its schema, which may not be this Studio's. */
  readonly version: ModuleVersion;
  /** The patch ids its chain is made of, in chain order. */
  readonly applied: readonly PatchId[];
  /**
   * Its content, under this Studio's schema. `null` for a version this
   * Studio computed itself on the way to what it shows (its own edits, a
   * save confirmed while it typed on): what it shows extends it, so its
   * content is made only if something needs it on its own -- a discard
   * of what came after it.
   */
  at: ModuleAt | null;
  /**
   * The manifest that decided it (`PatchStore.nextManifestEpoch`): a patch
   * this Studio held before that manifest was asked for, and that this
   * version does not have, is gone.
   */
  readonly decidedAt: number;
};

/**
 * Owns the patched source, and owns "who is listening where".
 *
 * Both in one store on purpose: because the same code computes the module and
 * decides who to tell, the invariant *"if an event went out, the source behind
 * it is already computed"* holds by construction rather than by convention. A
 * field woken by an event can read immediately and cannot get a pre-patch
 * value.
 *
 * ## What it holds, and what it reads through
 *
 * It holds each module's BASE (the source as authored or as the server sent
 * it, `.jsonValues()` entries as markers), the base content of the entries it
 * has read, the module at the version the SERVER names for it (the manifest's,
 * `manifestSource.ts`; the bundle's until one has been adopted), and the
 * module's CHAIN. Everything a field reads is the Studio's view of those
 * (`studioView.ts`): {@link withLocalEdits} -- the chain's patches the
 * server's version does not have -- over the server's module, through THE
 * engine (`applyPatchRecord` in `@valbuild/shared`, which Val's server applies
 * patches with), at a version computed here ({@link versionOf}). There are no patch rules of its own here
 * any more: where a file's `patch_id` lands, what an edit inside an entry does,
 * what a whole entry added does -- the engine's, so the Studio and the server
 * cannot disagree about them.
 */
export class SourceStore {
  readonly events = new StoreBus<SystemEvent>();

  /**
   * The source as authored, before any patch: what each module's chain is
   * applied to. `.jsonValues()` entries are markers here.
   */
  private baseSources: Record<ModuleFilePath, Json> = {};

  /** Each base's version, by the object it was hashed from. */
  private baseVersions = new Map<
    ModuleFilePath,
    { source: Json; version: string }
  >();

  /** Each serialized schema's version, and what the engine reads of it. */
  private schemaVersions = new WeakMap<
    object,
    { version: string; engine: string }
  >();

  /**
   * What {@link receive} was last handed for each module, as given (not the
   * clone it keeps), and the base's revision once it had it: how the next
   * intake tells a module that came along unchanged from one that moved.
   */
  private receivedSources = new Map<
    ModuleFilePath,
    { source: Json; baseRevision: number | undefined }
  >();

  /**
   * Every patch this store has seen for a module, in order, whether or not it
   * applied.
   *
   * Retained so that a module arriving late, or arriving AGAIN with new base
   * text (HMR, `PUT /sources/~`), can be computed as base + chain. Without it a
   * patch announced before its module loaded was dropped and could never land,
   * and re-intake silently discarded the user's pending edits.
   */
  private chains = new Map<ModuleFilePath, ChainEntry[]>();

  /**
   * Whether the project's modules have arrived. Intake is the whole project at
   * once, so after it a module that is not loaded is a module the project does
   * not have. Before it, the same thing only means "not yet".
   */
  private intakeSeen = false;

  /**
   * How far each module's source has moved. THE comparator for reads, bumped
   * wherever a module's view is replaced by one that reads differently, and
   * where an entry's failure is forgotten.
   */
  private revisions = new Map<ModuleFilePath, number>();

  /** Each module's view: what every read walks. See `studioView.ts`. */
  private views = new Map<ModuleFilePath, Viewed>();

  /** The last two versions of each module (risk 9: the heap guard). */
  private ring = new VersionRing();

  /** Held entry edits, resolved: see {@link ResolvedEntries}. */
  private resolvedEntries: ResolvedEntries = new WeakMap();

  /**
   * The last answer {@link peek} gave per path, with what it was answered at.
   *
   * Reference-stable BY KEY: the same view of the module, the same schema, the
   * same revision and the same entry fetches give the same object back,
   * without the answer being worked out again. Every way the answer can move
   * replaces one of those four, in one place each -- the view in
   * {@link refresh}, the revision in {@link bump}, the fetches in
   * {@link fetchMoved}, the schema in `SchemaStore` -- so nothing has to
   * remember to invalidate it.
   *
   * Grows with the number of DISTINCT paths anything has peeked, which is
   * bounded by the project.
   */
  private peeked = new Map<SourcePath, Peeked>();
  /** The same, for {@link peekBase}. Separate map: different question, same path. */
  private peekedBase = new Map<SourcePath, Peeked>();

  /**
   * The BASE content of `.jsonValues()` entries this store has read, by module
   * then entry key: what the server answered for them without patches. Not
   * part of a version: entries get versions of their own in the plan's phase 6.
   * Mutated in place, with {@link baseEntriesEpoch} moved each time.
   */
  private baseJsonEntries = new Map<ModuleFilePath, Map<string, Json>>();
  private baseEntriesEpoch = new Map<ModuleFilePath, number>();
  /**
   * Per module, which base its `.jsonValues()` entries are being read on:
   * moved whenever the base moves under them ({@link entryBaseMoved}). A
   * `GET /json` carries the one it was asked on, and an answer that comes
   * back to another is asked for again rather than applied -- it is the old
   * base's content, and applied it would be the new base's for good, since
   * nothing asks for an entry that is already here.
   */
  private entryBases = new Map<ModuleFilePath, number>();

  /**
   * The published realm (see {@link publishedView}) of a module whose chain
   * holds shipped patches, and what it was computed from.
   */
  private published = new Map<
    ModuleFilePath,
    {
      base: Json;
      entriesEpoch: number;
      schema: SerializedSchema | undefined;
      applied: string;
      view: ModuleView;
    }
  >();
  /**
   * How far each module's BASE realm has moved: `baseSources` or
   * `baseJsonEntries` written. Not `revisions`, which moves on every pending
   * keystroke as well.
   */
  private baseRevisions = new Map<ModuleFilePath, number>();
  /**
   * Each module's shipped chain entries, so {@link peekBase} — called once per
   * subscribed path — does not scan the whole chain on every call.
   */
  private shippedCache = new Map<
    ModuleFilePath,
    {
      chain: readonly unknown[];
      length: number;
      appliedVersion: number;
      shipped: { record: PatchRecord }[];
      applied: string;
    }
  >();
  /** Per module, so a publish in one does not invalidate every other's cache. */
  private appliedVersions = new Map<ModuleFilePath, number>();
  /**
   * In-flight entry fetches, by base key, so N readers of one entry cause ONE
   * fetch. Settled when the batch that brought the entry has been applied.
   */
  private loadingEntries = new Map<
    string,
    { promise: Promise<void>; settle: () => void }
  >();
  /**
   * Entries whose last fetch FAILED, and why, by base key. Kept because `peek`
   * has to be able to say so: without it a failed entry renders a spinner
   * forever while the effect that would retry sees nothing new to do. Cleared
   * on a successful fetch and on a fresh attempt.
   */
  private entryFailures = new CountedMap<string, string>();
  /**
   * What {@link markersOf} and {@link entriesProgress} found in a module's
   * view, kept per view object and read again only when the view or a fetch's
   * outcome moved.
   *
   * Every progress hook asks on every render, and a keystroke re-renders them
   * all: counted afresh, a `.jsonValues()` record of 10,000 posts was walked a
   * few times per keystroke in a module nobody had edited -- most of a
   * second's freeze per character on a page that only pointed at it.
   */
  private entriesCounted = new WeakMap<
    ModuleView,
    {
      failureWrites: number;
      markers: { key: string; failure: string | undefined }[];
      progress?: { total: number; loaded: number; failed: number };
    }
  >();
  /** Moved whenever a module's entry fetches start, finish or fail: for {@link peek}. */
  private fetchEpochs = new Map<ModuleFilePath, number>();
  /** Patches an entry's error has been reported for, so it is reported once. */
  private reportedEntryErrors = new Set<PatchId>();
  /**
   * Each module at the version the server names for it: what
   * {@link withLocalEdits} goes over. Absent: the bundle's base, before a
   * manifest named one. See {@link adoptServer}.
   */
  private server = new Map<ModuleFilePath, ServerBelow>();

  /**
   * Whether a manifest has said a patch is gone: it is not in the server's
   * version of its module, the manifest that named that version was asked for
   * after this Studio held the patch (`decidedAt`), and it is not one of this
   * Studio's own unsaved ones. From `PatchStore.decidedGone`. Such a patch is
   * not applied on top: the server's version is the truth about it.
   */
  private decidedGone: (patchId: PatchId, decidedAt: number) => boolean = () =>
    false;

  /**
   * One `EventTarget` per REGISTERED path, not per module.
   *
   * This is the registry that makes "no messages" a guarantee: a listener on a
   * path the patch did not touch is never invoked at all, so it costs nothing
   * and cannot be woken by a sibling's keystroke.
   */
  private listenerTargets = new Map<
    SourcePath,
    Map<string, { target: EventTarget; count: number }>
  >();

  /**
   * The registered paths, grouped by module. Redundant with `listenerTargets`
   * on purpose: `listenedPaths(module)` is asked once per render refresh, and
   * walking every registered path made a mount O(fields x modules).
   */
  private listenersByModule = new Map<ModuleFilePath, Set<SourcePath>>();

  constructor(
    private readonly schemaStore: SchemaStore,
    private readonly activity: ActivitySink = noopActivity,
    private readonly fetchJsonEntries?: FetchJsonEntries,
  ) {}

  /**
   * A counter over EVERY module, moved by every `bump`. For a whole-project
   * reader — "all sources", the nav tree, search — whose snapshot has to be a
   * stable value that changes when anything could have.
   */
  private globalRevision = 0;

  /** Record that the base realm of this module was written. See {@link baseRevisions}. */
  private bumpBase(moduleFilePath: ModuleFilePath): void {
    this.baseRevisions.set(
      moduleFilePath,
      (this.baseRevisions.get(moduleFilePath) ?? 0) + 1,
    );
  }

  private bump(moduleFilePath: ModuleFilePath): void {
    this.revisions.set(
      moduleFilePath,
      (this.revisions.get(moduleFilePath) ?? 0) + 1,
    );
    this.globalRevision++;
    this.allSourcesAt = null;
    // The one place a revision moves is the one place this is announced. See
    // `source:change` in `types.ts`.
    this.events.emit({ type: "source:change", moduleFilePath });
  }

  /**
   * Where `globalRevision` stood when {@link allSources} was last built, or
   * `null` if it must be rebuilt. Cleared by `bump`.
   */
  private allSourcesAt: {
    n: number;
    sources: Record<ModuleFilePath, Json>;
  } | null = null;

  /** Moved by every source change, anywhere. See {@link globalRevision}. */
  sourcesVersion(): number {
    return this.globalRevision;
  }

  /**
   * Every loaded module's source, as a read would see it: `.jsonValues()`
   * content that has been fetched is present, so a whole-project consumer sees
   * the same values a field does.
   *
   * Reference-stable across an unchanged `globalRevision`, because this is a
   * `useSyncExternalStore` snapshot too.
   */
  allSources(): Record<ModuleFilePath, Json> {
    const cached = this.allSourcesAt;
    if (cached !== null && cached.n === this.globalRevision) {
      return cached.sources;
    }
    const sources: Record<ModuleFilePath, Json> = {};
    for (const [moduleFilePath, { view }] of this.views) {
      sources[moduleFilePath] = view.source;
    }
    this.allSourcesAt = { n: this.globalRevision, sources };
    return sources;
  }

  /**
   * `.jsonValues()` entries across the whole project: how many there are, how
   * many are here, how many failed. Summed from {@link entriesProgress}.
   */
  allEntriesProgress(): { total: number; loaded: number; failed: number } {
    let total = 0;
    let loaded = 0;
    let failed = 0;
    for (const moduleFilePath of this.views.keys()) {
      const at = this.entriesProgress(moduleFilePath);
      total += at.total;
      loaded += at.loaded;
      failed += at.failed;
    }
    const next = { total, loaded, failed };
    // Stable for the same reason as `entriesStatus`: a progress hook reads
    // this on every render.
    const previous = this.allEntriesProgressCache;
    if (
      previous !== null &&
      previous.total === next.total &&
      previous.loaded === next.loaded &&
      previous.failed === next.failed
    ) {
      return previous;
    }
    this.allEntriesProgressCache = next;
    return next;
  }

  private allEntriesProgressCache: {
    total: number;
    loaded: number;
    failed: number;
  } | null = null;

  // #region versions and the view

  /**
   * Work done for this module, attributed to this store: the engine's
   * (`engine:clone-bytes`) and the versions it hashed (`version:hash`). The
   * engine counts per process, and Val's server runs in the same one in the
   * scenarios, so the Studio says what was its own.
   */
  private counted<T>(moduleFilePath: ModuleFilePath, fn: () => T): T {
    const hashes = versionHashCount();
    const bytes = engineWork().cloneBytes;
    try {
      return fn();
    } finally {
      const hashed = versionHashCount() - hashes;
      if (hashed > 0) {
        this.activity.work("version:hash", moduleFilePath, hashed);
      }
      const copied = engineWork().cloneBytes - bytes;
      if (copied > 0) {
        this.activity.work("engine:clone-bytes", moduleFilePath, copied);
      }
    }
  }

  /** A schema's version, hashed once per schema object: when it arrives. */
  private schemaVersionFor(schema: SerializedSchema | undefined): {
    version: string;
    engine: string;
  } {
    if (schema === undefined) return { version: NO_SCHEMA, engine: "" };
    const known = this.schemaVersions.get(schema);
    if (known !== undefined) return known;
    const computed = {
      version: schemaVersionOf(schema),
      engine: engineSchemaKey(schema),
    };
    this.schemaVersions.set(schema, computed);
    return computed;
  }

  /** The base's version, hashed once per base object: when it arrives. */
  private baseVersionFor(moduleFilePath: ModuleFilePath, base: Json): string {
    const known = this.baseVersions.get(moduleFilePath);
    if (known !== undefined && known.source === base) return known.version;
    const version = baseVersionOf(base);
    this.baseVersions.set(moduleFilePath, { source: base, version });
    return version;
  }

  private inputsOf(
    moduleFilePath: ModuleFilePath,
    base: Json,
    schema: SerializedSchema | undefined,
  ): ModuleInputs {
    const schemaVersion = this.schemaVersionFor(schema);
    return {
      schema,
      schemaVersion: schemaVersion.version,
      engineKey: schemaVersion.engine,
      base,
      baseVersion: this.baseVersionFor(moduleFilePath, base),
      onApply: (patchId) => this.activity.work("source:apply-patch", patchId),
    };
  }

  /**
   * The module at the server's version, under this Studio's schema: the
   * manifest's, or the bundle's base before one named it.
   */
  private belowOf(moduleFilePath: ModuleFilePath, inputs: ModuleInputs): Below {
    const below = this.server.get(moduleFilePath);
    if (below === undefined || below.version.base !== inputs.baseVersion) {
      return {
        tried: [],
        at: () => baseAt(inputs),
        decidedAt: NOTHING_DECIDED,
      };
    }
    return {
      tried: below.applied,
      at: () => this.materializeBelow(moduleFilePath, below, inputs),
      decidedAt: below.decidedAt,
    };
  }

  /**
   * The content of the server's version below, under this Studio's schema:
   * as held, or -- for a version known only by its patches, one this Studio
   * computed -- the kept version of exactly those patches, or else the base
   * with them applied (counted). Kept once made.
   */
  private materializeBelow(
    moduleFilePath: ModuleFilePath,
    below: ServerBelow,
    inputs: ModuleInputs,
  ): ModuleAt {
    let at = below.at;
    if (at === null) {
      const kept = this.ring.longestPrefix(
        moduleFilePath,
        inputs,
        below.applied,
        below.applied.length,
      );
      if (kept !== null && kept.tried.length === below.applied.length) {
        at = kept;
      } else {
        const byId = new Map<PatchId, PatchRecord>();
        for (const { record } of this.chains.get(moduleFilePath) ?? []) {
          byId.set(record.patchId, record);
        }
        const records: PatchRecord[] = [];
        for (const patchId of below.applied) {
          const record = byId.get(patchId);
          if (record !== undefined) records.push(record);
        }
        at = applyOnBase(inputs, records);
      }
      below.at = at;
    }
    return at.engine === inputs.engineKey &&
      at.version.schema === inputs.schemaVersion
      ? at
      : {
          ...at,
          engine: inputs.engineKey,
          version: { ...at.version, schema: inputs.schemaVersion },
        };
  }

  /**
   * The module's patches the server's version below does not have, in chain
   * order: what this Studio shows on top (`withLocalEdits`). Its OWN edits,
   * unless a manifest said they are gone -- another editor's patch is shown
   * once the server's version has it, never replayed here. All of the chain
   * when nothing below has been decided: before the first manifest, after
   * new code moved the base here, on a module new code put this Studio ahead
   * on, or with no server to ask.
   */
  private localOf(moduleFilePath: ModuleFilePath, below: Below): PatchRecord[] {
    const chain = this.chains.get(moduleFilePath) ?? [];
    if (chain.length === 0) return [];
    const inBelow = new Set<PatchId>(below.tried);
    const local: PatchRecord[] = [];
    for (const { record, origin } of chain) {
      if (inBelow.has(record.patchId)) continue;
      if (
        below.decidedAt !== NOTHING_DECIDED &&
        (origin === "external" ||
          this.decidedGone(record.patchId, below.decidedAt))
      ) {
        continue;
      }
      local.push(record);
    }
    return local;
  }

  /**
   * Compute this module's view again from its base, its chain and the base
   * entries read, and keep it: THE place a view is made. Extends the last
   * version where it can, so a keystroke is one engine apply.
   *
   * Returns the view it replaced, for the caller to announce and wake.
   */
  private refresh(moduleFilePath: ModuleFilePath): {
    before: ModuleView | undefined;
    after: ModuleView | undefined;
  } {
    const before = this.views.get(moduleFilePath)?.view;
    const base = this.baseSources[moduleFilePath];
    if (base === undefined) {
      this.views.delete(moduleFilePath);
      this.ring.forget(moduleFilePath);
      return { before, after: undefined };
    }
    const schema = this.schemaStore.get(moduleFilePath);
    const inputs = this.inputsOf(moduleFilePath, base, schema);
    const below = this.belowOf(moduleFilePath, inputs);
    const at = this.counted(moduleFilePath, () =>
      withLocalEdits(
        moduleFilePath,
        below,
        this.localOf(moduleFilePath, below),
        inputs,
        this.ring,
      ),
    );
    this.rememberChain(moduleFilePath, at);
    return { before, after: this.viewAt(moduleFilePath, at, schema) };
  }

  /**
   * The chains this Studio computed for each module, by the version's chain:
   * the patches each is made of. What a manifest naming one of them is
   * answered from when the version's content is no longer kept -- a save
   * confirmed while the editor typed on names a version the Studio passed
   * through, and nothing has to be fetched or applied for it
   * ({@link knownChain}). The last {@link CHAINS_KEPT} per module.
   */
  private computedChains = new Map<
    ModuleFilePath,
    Map<string, { base: string; engine: string; applied: readonly PatchId[] }>
  >();

  private rememberChain(moduleFilePath: ModuleFilePath, at: ModuleAt): void {
    let chains = this.computedChains.get(moduleFilePath);
    if (chains === undefined) {
      chains = new Map();
      this.computedChains.set(moduleFilePath, chains);
    }
    if (chains.has(at.version.chain)) return;
    chains.set(at.version.chain, {
      base: at.version.base,
      engine: at.engine,
      applied: at.applied,
    });
    if (chains.size > CHAINS_KEPT) {
      const oldest = chains.keys().next();
      if (oldest.done !== true) chains.delete(oldest.value);
    }
  }

  /** The view of `at`, kept: the same object while nothing it reads moved. */
  private viewAt(
    moduleFilePath: ModuleFilePath,
    at: ModuleAt,
    schema: SerializedSchema | undefined,
  ): ModuleView {
    const entriesEpoch = this.baseEntriesEpoch.get(moduleFilePath) ?? 0;
    const kept = this.views.get(moduleFilePath);
    if (
      kept !== undefined &&
      kept.view.at === at &&
      kept.view.schema === schema &&
      kept.entriesEpoch === entriesEpoch
    ) {
      return kept.view;
    }
    const view = this.counted(moduleFilePath, () =>
      viewOf(
        at,
        this.baseJsonEntries.get(moduleFilePath),
        schema,
        this.resolvedEntries,
      ),
    );
    this.views.set(moduleFilePath, { view, entriesEpoch });
    return view;
  }

  /** The view again, for a change that moved only the base entries read. */
  private refreshEntries(moduleFilePath: ModuleFilePath): {
    before: ModuleView | undefined;
    after: ModuleView | undefined;
  } {
    const kept = this.views.get(moduleFilePath);
    if (kept === undefined) return this.refresh(moduleFilePath);
    return {
      before: kept.view,
      after: this.viewAt(moduleFilePath, kept.view.at, kept.view.schema),
    };
  }

  /**
   * Whether the module's SOURCE moved in `after`: the value, or what stands
   * behind a marker -- what `source:change` announces. Not the version alone:
   * a publish moves the base, and a code change the schema, under a value
   * that does not move, and neither may repaint. (Readers of a module whose
   * schema arrived or changed are woken by {@link wakeChanged} all the same.)
   */
  private static moved(
    before: ModuleView | undefined,
    after: ModuleView | undefined,
  ): boolean {
    if (before === undefined || after === undefined) return before !== after;
    return (
      before.source !== after.source ||
      before.entryErrors.size !== after.entryErrors.size
    );
  }

  /**
   * The version the Studio shows this module at: the schema it holds, the base
   * its chain is applied to, and the chain of the patches that applied --
   * unconfirmed ones included, so it is the server's version for the same
   * chain once the server has it. Computed when the module changes, never here
   * (risk 3 in the plan).
   */
  versionOf(moduleFilePath: ModuleFilePath): ModuleVersion | undefined {
    return this.views.get(moduleFilePath)?.view.at.version;
  }

  /**
   * The version of the schema this Studio reads the module with, or
   * `undefined` for a module it has no schema for. The same hash the server
   * names a module's schema by, kept per schema object, so asking costs
   * nothing. Where new code moved it ahead of the server's, the manifest's
   * version of the module is not moved to: see `ManifestSource.codeMoved`.
   */
  schemaVersionOfModule(moduleFilePath: ModuleFilePath): string | undefined {
    const schema = this.schemaStore.get(moduleFilePath);
    if (schema === undefined) return undefined;
    return this.schemaVersionFor(schema).version;
  }

  /** How many versions of this module are kept: at most two (the heap guard). */
  retainedVersions(moduleFilePath: ModuleFilePath): number {
    return this.ring.size(moduleFilePath);
  }

  /**
   * The entries that must be read before this module goes to a page: the ones
   * whose content in this view differs from what a page's bundle has -- every
   * entry the chain wrote or edited, and every one whose marker says the
   * bundle's copy is not current (`Internal.isJsonFromServer`: a publish wrote
   * it, on a host that has not rebuilt). Exactly the entries the server's
   * draft read fills for a page (`ValHead.draft` in `@valbuild/server`).
   * The ones still a marker here, by entry key.
   */
  entriesToRelay(moduleFilePath: ModuleFilePath): string[] {
    const view = this.views.get(moduleFilePath)?.view;
    if (view === undefined || !isJsonObject(view.source)) return [];
    const keys: string[] = [];
    for (const [key, value] of Object.entries(view.source)) {
      if (!Internal.isJson(value)) continue;
      if (chainTouches(view, key) || Internal.isJsonFromServer(value)) {
        keys.push(key);
      }
    }
    return keys;
  }

  // #region entries

  /**
   * Deliver one entry's BASE content -- what the server has for it without
   * patches (the Studio reads entries with `apply_patches: false`). The chain's
   * edits into it apply on read (`studioView.ts`): an edit made while the
   * entry was not loaded was held by the engine for exactly this moment.
   */
  receiveJsonEntry(
    moduleFilePath: ModuleFilePath,
    key: string,
    content: Json,
  ): void {
    this.receiveJsonEntries(moduleFilePath, [[key, content]]);
  }

  /**
   * Deliver many entries' base content at once: ONE view of the module, one
   * revision, one wake and one announcement for all of them.
   *
   * Per entry, a record of N entries loaded whole was quadratic: the view of
   * the record (its root of N keys copied, every loaded entry filled in) was
   * rebuilt for each arriving entry -- about 44 s for 10,000 (phase 10). A
   * batch is what a request brought, or what several brought by the time the
   * store got to them, so a full load rebuilds the view once per batch.
   */
  receiveJsonEntries(
    moduleFilePath: ModuleFilePath,
    entries: readonly (readonly [key: string, content: Json])[],
  ): void {
    if (entries.length === 0) return;
    let byKey = this.baseJsonEntries.get(moduleFilePath);
    if (byKey === undefined) {
      byKey = new Map();
      this.baseJsonEntries.set(moduleFilePath, byKey);
    }
    for (const [key, content] of entries) {
      byKey.set(key, content);
      this.activity.work("source:receive-json-entry", moduleFilePath);
    }
    this.entriesMoved(moduleFilePath);
    this.activity.work(
      "source:apply-json-entries",
      moduleFilePath,
      entries.length,
    );
    const { before, after } = this.refreshEntries(moduleFilePath);
    this.bump(moduleFilePath);
    const failed = this.entryErrorsOf(moduleFilePath, after);
    if (failed.length > 0) {
      this.events.emit({
        type: "source:patch-apply",
        success: [],
        failed,
        withoutModule: [],
        modules: [moduleFilePath],
      });
    }
    this.wakeChanged(moduleFilePath, before);
    this.events.emit({
      type: "source:patch-apply",
      success: [],
      failed: [],
      withoutModule: [],
      modules: [moduleFilePath],
    });
  }

  /** The base entries this module has read moved. */
  private entriesMoved(moduleFilePath: ModuleFilePath): void {
    this.baseEntriesEpoch.set(
      moduleFilePath,
      (this.baseEntriesEpoch.get(moduleFilePath) ?? 0) + 1,
    );
    this.bumpBase(moduleFilePath);
  }

  /** An entry fetch of this module started, finished or failed. */
  private fetchMoved(moduleFilePath: ModuleFilePath): void {
    this.fetchEpochs.set(
      moduleFilePath,
      (this.fetchEpochs.get(moduleFilePath) ?? 0) + 1,
    );
  }

  /**
   * The base this module's entries are read on moved: what is in flight, or
   * has landed and is not applied, was read on the one before. See
   * {@link entryBases}.
   */
  private entryBaseMoved(moduleFilePath: ModuleFilePath): void {
    this.entryBases.set(
      moduleFilePath,
      (this.entryBases.get(moduleFilePath) ?? 0) + 1,
    );
  }

  /**
   * The patches an entry's held edits do not fit, newly found in `view`: the
   * engine could not know, because the entry's base was not loaded when they
   * were applied. Reported as failed like any patch that does not apply, so
   * the editor's change that cannot land is discarded rather than kept.
   */
  private entryErrorsOf(
    moduleFilePath: ModuleFilePath,
    view: ModuleView | undefined,
  ): { patchId: PatchId; message: string }[] {
    if (view === undefined || view.entryErrors.size === 0) return [];
    const inChain = new Set(
      (this.chains.get(moduleFilePath) ?? []).map(
        (entry) => entry.record.patchId,
      ),
    );
    const failed: { patchId: PatchId; message: string }[] = [];
    for (const { patchId, message } of view.entryErrors.values()) {
      if (patchId === undefined || !inChain.has(patchId)) continue;
      if (this.reportedEntryErrors.has(patchId)) continue;
      this.reportedEntryErrors.add(patchId);
      failed.push({ patchId, message });
    }
    return failed;
  }

  /**
   * Forget the loaded `.jsonValues()` entries a VANISHED patch wrote into, so
   * the next read asks the server again.
   *
   * A patch vanishes when another tab discarded it -- or published it, which
   * no sha says when only an entry changed: the module's source is its
   * markers either way. Kept as it was loaded, the entry went back to its
   * content from BEFORE the publish, on every page the overlay relays to. Read
   * again, it is right in both cases.
   */
  private forgetEntriesOf(record: PatchRecord): void {
    const base = this.baseJsonEntries.get(record.moduleFilePath);
    let forgot = false;
    let inFlight = false;
    for (const op of record.patch) {
      const keys = [op.path[0]];
      if (op.op === "move" || op.op === "copy") keys.push(op.from[0]);
      for (const key of keys) {
        if (typeof key !== "string") continue;
        forgot = (base?.delete(key) ?? false) || forgot;
        inFlight =
          inFlight ||
          this.loadingEntries.has(entryKey(record.moduleFilePath, key));
      }
    }
    // One on its way was read before the patch went: as stale as one here.
    if (inFlight) this.entryBaseMoved(record.moduleFilePath);
    if (forgot) this.entriesMoved(record.moduleFilePath);
  }

  /**
   * Drop this module's loaded entry content.
   *
   * For `jsonEntriesSha` moving: an entry file changed on disk, and no other sha
   * can see it — the module's source is markers and the content sits behind a
   * thunk `JSON.stringify` drops. Coarse by necessity (the fingerprint cannot say
   * WHICH entry) and cheap because of it: dropping content causes no fetches,
   * only the next read of an entry does. See `openquestions.md` item 9b.
   */
  markJsonEntriesStale(moduleFilePath: ModuleFilePath): void {
    /**
     * A recorded FAILURE is stale news too, and clearing it is the whole point:
     * `peek` reports `entry-failed` so that readers stop asking, and nothing
     * asks again except an explicit `retryEntry`.
     */
    const clearedFailures = this.clearEntryFailures(moduleFilePath);
    // An answer on its way was read from the files as they were.
    this.entryBaseMoved(moduleFilePath);
    if (!this.baseJsonEntries.has(moduleFilePath)) {
      if (clearedFailures) this.bump(moduleFilePath);
      return;
    }
    this.baseJsonEntries.delete(moduleFilePath);
    this.entriesMoved(moduleFilePath);
    const { before } = this.refreshEntries(moduleFilePath);
    this.bump(moduleFilePath);
    this.wakeChanged(moduleFilePath, before);
  }

  /**
   * Forget what this module's entries failed with. Returns whether any did.
   * Called from the two places that are new evidence about the content: the
   * file changing on disk and the server resending the module.
   */
  private clearEntryFailures(moduleFilePath: ModuleFilePath): boolean {
    if (this.entryFailures.size === 0) return false;
    const prefix = `${moduleFilePath}\0`;
    let cleared = false;
    for (const key of [...this.entryFailures.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.entryFailures.delete(key);
      cleared = true;
    }
    if (cleared) this.fetchMoved(moduleFilePath);
    return cleared;
  }

  /**
   * The base entry a read of the entry at `key` waits for: its own key, or
   * the one a rename moved it from. `undefined` when no fetch can fill it --
   * it is here, or it is content the chain wrote, or an error.
   */
  private fetchKey(view: ModuleView, key: string): string | undefined {
    if (!isJsonObject(view.source)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(view.source, key)) {
      return undefined;
    }
    if (!Internal.isJson(view.source[key])) return undefined;
    if (view.entryErrors.has(key)) return undefined;
    return fetchKeyOf(view, key);
  }

  /**
   * Load these `.jsonValues()` entries, and only the ones not already here.
   *
   * For a caller that knows WHICH entries it is about to need — a virtualized
   * record list scrolling a window of rows into view. Silent on failure by
   * design: a failed entry is recorded and reported by `peek` as
   * `entry-failed`, which is where a row shows it.
   *
   * Asked for at once, and coalesced per module per tick with every other
   * read of this tick (a record's rows each `get` their own entry in one
   * render pass) into as few `GET /json` as the URL allows
   * (`chunkJsonEntryKeys`): one request for a window of rows, not one per
   * row. What a request brings is applied as one batch
   * ({@link receiveJsonEntries}) as soon as it lands.
   *
   * ## An entry that FAILED is not asked for again
   *
   * `ValOverlayEmitter` asks for the entries a module needs on every
   * `source:change` burst, so one entry the server cannot resolve produced a
   * `GET /json` every 200ms for as long as the tab was open. {@link retryEntry}
   * stays the one door back in.
   */
  async loadEntries(
    moduleFilePath: ModuleFilePath,
    keys: readonly string[],
  ): Promise<void> {
    if (this.fetchJsonEntries === undefined) return;
    await Promise.all(
      this.requestEntries(
        moduleFilePath,
        this.wantedEntries(moduleFilePath, keys),
      ),
    );
  }

  /**
   * Every `.jsonValues()` entry this module has, loaded. The deliberate
   * exception to demand-driven reading, for the callers that genuinely need
   * the whole module: search, a reference scan ("used by", a rename guard), a
   * compare view.
   *
   * ## In batches, in the background, and never in one long task
   *
   * A record of 10,000 entries cannot be one request, and its entries cannot
   * be applied one at a time (each rebuilt the record's view: quadratic, 44 s
   * at 10,000). So the keys go out {@link BULK_KEYS_PER_REQUEST} to a request,
   * at most {@link BULK_REQUESTS_IN_FLIGHT} requests at a time across the
   * whole store -- the browser has six connections to a host, and the rest
   * are for what the editor does meanwhile -- and what has arrived is applied
   * as ONE batch per module, after a {@link yieldToMain}: a click, a keystroke
   * or a frame gets a turn between two batches, so the Studio stays usable
   * while it loads. The progress is `entriesProgress`, counted from the view.
   *
   * Lower priority than a read: an entry someone opens while this runs is
   * asked for at once (`get`, {@link loadEntries}), not after the batches
   * queued before it. The batches are formed as they go out, so it is not
   * asked for twice.
   *
   * One load per module: a second caller joins the one running. `signal`
   * says the caller has stopped waiting (search closed, the inspector left):
   * when no caller is left, the batches not yet sent are dropped, and those
   * in flight land as usual. A caller without one waits for the end.
   *
   * Resolves when every entry is here or has failed (`entriesStatus` says
   * which), or when the load was given up.
   */
  async loadAllEntries(
    moduleFilePath: ModuleFilePath,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    if (this.fetchJsonEntries === undefined) return;
    const { signal } = options;
    if (signal?.aborted === true) return;
    let job = this.bulkLoads.get(moduleFilePath);
    if (job === undefined) {
      const keys = this.wantedEntries(
        moduleFilePath,
        this.markerKeys(moduleFilePath),
      );
      let finish: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      job = {
        keys,
        next: 0,
        inFlight: 0,
        interest: 0,
        shared: [],
        done,
        finish,
      };
      this.bulkLoads.set(moduleFilePath, job);
    }
    const joined = job;
    joined.interest++;
    signal?.addEventListener(
      "abort",
      () => {
        joined.interest--;
        if (
          joined.interest > 0 ||
          this.bulkLoads.get(moduleFilePath) !== joined
        )
          return;
        // Nobody is waiting: what has not gone out does not go.
        joined.next = joined.keys.length;
        this.settleBulkLoad(moduleFilePath, joined);
      },
      { once: true },
    );
    this.settleBulkLoad(moduleFilePath, joined);
    this.pumpBulkLoads();
    await joined.done;
  }

  /**
   * Ask again for these entries, whose fetches failed: the "Try again" of a
   * load that could not finish. The failures are forgotten first (or the load
   * would skip them, see {@link loadEntries}); a few go out at once, many go
   * the way {@link loadAllEntries} sends them, so a server that was down for
   * a while is not answered with a request per entry, all at once.
   */
  async retryEntries(
    moduleFilePath: ModuleFilePath,
    keys: readonly string[],
  ): Promise<void> {
    const view = this.views.get(moduleFilePath)?.view;
    let cleared = false;
    for (const key of keys) {
      const fetchKey =
        view === undefined ? key : (fetchKeyOf(view, key) ?? key);
      cleared =
        this.entryFailures.delete(entryKey(moduleFilePath, fetchKey)) ||
        cleared;
    }
    if (cleared) {
      this.fetchMoved(moduleFilePath);
      // From "failed" to "loading" for whoever shows it, now rather than when
      // the first answer lands.
      this.bump(moduleFilePath);
    }
    if (keys.length <= JSON_ENTRY_KEYS_PER_REQUEST) {
      await this.loadEntries(moduleFilePath, keys);
    } else {
      await this.loadAllEntries(moduleFilePath);
    }
  }

  /** The keys of this module's view that are still markers. */
  private markerKeys(moduleFilePath: ModuleFilePath): string[] {
    const view = this.views.get(moduleFilePath)?.view;
    if (view === undefined || !isJsonObject(view.source)) return [];
    const keys: string[] = [];
    for (const key of Object.keys(view.source)) {
      if (Internal.isJson(view.source[key])) keys.push(key);
    }
    return keys;
  }

  /**
   * The base entries reading `keys` needs and nobody has: not read, not
   * failed (see {@link loadEntries}). By the key they are fetched by.
   */
  private wantedEntries(
    moduleFilePath: ModuleFilePath,
    keys: Iterable<string>,
  ): string[] {
    const view = this.views.get(moduleFilePath)?.view;
    if (view === undefined) return [];
    const read = this.baseJsonEntries.get(moduleFilePath);
    const wanted = new Set<string>();
    for (const key of keys) {
      const fetchKey = this.fetchKey(view, key);
      if (fetchKey === undefined) continue;
      if (read?.has(fetchKey) === true) continue;
      if (this.entryFailures.has(entryKey(moduleFilePath, fetchKey))) continue;
      wanted.add(fetchKey);
    }
    return [...wanted];
  }

  /**
   * Fetch these base entries now, or wait for the fetch already carrying
   * them: N readers of one entry cause ONE fetch. One promise per key, settled
   * when its batch has been applied (or has failed).
   */
  private requestEntries(
    moduleFilePath: ModuleFilePath,
    fetchKeys: readonly string[],
  ): Promise<void>[] {
    const waits: Promise<void>[] = [];
    const started: string[] = [];
    for (const key of fetchKeys) {
      const inFlight = this.loadingEntries.get(entryKey(moduleFilePath, key));
      if (inFlight !== undefined) {
        this.activity.work("source:share-json-entry-load", moduleFilePath);
        waits.push(inFlight.promise);
        continue;
      }
      waits.push(this.startLoading(moduleFilePath, key));
      started.push(key);
    }
    if (started.length === 0) return waits;
    this.queueReads(moduleFilePath, started);
    return waits;
  }

  /**
   * Send these keys, already marked loading, with this tick's other reads of
   * the module.
   */
  private queueReads(
    moduleFilePath: ModuleFilePath,
    keys: readonly string[],
  ): void {
    this.fetchMoved(moduleFilePath);
    let queued = this.readsThisTick.get(moduleFilePath);
    if (queued === undefined) {
      queued = [];
      this.readsThisTick.set(moduleFilePath, queued);
      /**
       * Coalesced per module per tick. Load-bearing for more than request
       * count: a virtualized `.jsonValues()` record asks for the window it is
       * showing, and every arrival re-renders those rows, which moves the
       * window, which asks again. One batch per tick is what lets that settle.
       */
      queueMicrotask(() => {
        const keys = this.readsThisTick.get(moduleFilePath) ?? [];
        this.readsThisTick.delete(moduleFilePath);
        for (const chunk of chunkJsonEntryKeys(keys)) {
          void this.fetchEntries(moduleFilePath, chunk, "read");
        }
      });
    }
    queued.push(...keys);
  }

  /** This entry is being fetched from now on: `peek` says `entry-loading`. */
  private startLoading(moduleFilePath: ModuleFilePath, key: string) {
    const cacheKey = entryKey(moduleFilePath, key);
    // Cleared before the attempt, so a retry is not reported as failed while
    // it is in flight.
    this.entryFailures.delete(cacheKey);
    let settle: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.loadingEntries.set(cacheKey, { promise, settle });
    return promise;
  }

  /**
   * One `GET /json` for these keys, and what it brought handed to
   * {@link arrive}. A read's batch is applied as it lands; a bulk load's
   * after a yield, with whatever else has landed by then.
   */
  private async fetchEntries(
    moduleFilePath: ModuleFilePath,
    keys: string[],
    kind: "read" | "bulk",
  ): Promise<void> {
    this.activity.work(
      "source:fetch-json-entries",
      moduleFilePath,
      keys.length,
    );
    for (let i = 0; i < keys.length; i++) {
      this.activity.work("source:load-json-entry", moduleFilePath);
    }
    const on = this.entryBases.get(moduleFilePath) ?? 0;
    let results: Record<string, JsonEntryResult>;
    try {
      // `loadEntries` and `loadAllEntries` start nothing without the seam.
      results = await this.fetchJsonEntries!(moduleFilePath, keys);
    } catch (err) {
      // A throwing seam must not leave readers awaiting forever: a read that
      // never settles is the one shape a field can neither render nor retry.
      const message =
        err instanceof Error ? err.message : "Unknown error reading entries";
      results = {};
      for (const key of keys) results[key] = { status: "error", message };
    }
    let landed = this.landed.get(moduleFilePath);
    if (landed === undefined) {
      landed = [];
      this.landed.set(moduleFilePath, landed);
    }
    landed.push({ keys, results, bulk: kind === "bulk", on });
    if (kind === "read") {
      this.applyLanded(moduleFilePath);
      return;
    }
    if (!this.bulkBatchIsDue(moduleFilePath, landed)) return;
    if (this.applyScheduled.has(moduleFilePath)) return;
    this.applyScheduled.add(moduleFilePath);
    void yieldToMain().then(() => {
      this.applyScheduled.delete(moduleFilePath);
      this.applyLanded(moduleFilePath);
    });
  }

  /**
   * Whether what a bulk load has landed is enough to apply: a twentieth of
   * the load (at least {@link MIN_BULK_APPLY} entries), or everything still
   * to come for it.
   *
   * Applied per request, a load of 10,000 was a hundred applies, and each one
   * re-renders whatever reads the whole project -- most of a long task each
   * in the browser. Paced like this it is about twenty however large the
   * record, each with a twentieth of it, and the progress bar moves in
   * twentieths.
   */
  private bulkBatchIsDue(
    moduleFilePath: ModuleFilePath,
    landed: readonly { keys: string[]; bulk: boolean }[],
  ): boolean {
    const job = this.bulkLoads.get(moduleFilePath);
    if (job === undefined) return true;
    let entries = 0;
    let requests = 0;
    for (const answer of landed) {
      if (!answer.bulk) continue;
      entries += answer.keys.length;
      requests++;
    }
    const sending = job.next < job.keys.length;
    if (!sending && requests >= job.inFlight) return true;
    return entries >= Math.max(MIN_BULK_APPLY, Math.ceil(job.keys.length / 20));
  }

  /**
   * Apply every answer that has landed for this module, as ONE batch: one
   * view, one revision, one wake ({@link receiveJsonEntries}). Then the
   * fetches end, so a reader woken by either sees the content.
   */
  private applyLanded(moduleFilePath: ModuleFilePath): void {
    const landed = this.landed.get(moduleFilePath);
    if (landed === undefined || landed.length === 0) return;
    this.landed.delete(moduleFilePath);
    const received: [string, Json][] = [];
    const settled: string[] = [];
    const again: string[] = [];
    const base = this.entryBases.get(moduleFilePath) ?? 0;
    let failed = false;
    let bulk = 0;
    for (const answer of landed) {
      if (answer.bulk) bulk++;
      if (answer.on !== base) {
        // Read on a base this module has moved off: neither its content nor
        // its failures are this base's.
        again.push(...answer.keys);
        continue;
      }
      for (const key of answer.keys) {
        const result: JsonEntryResult = answer.results[key] ?? {
          status: "error",
          message: `Entry not found: ${key} in ${moduleFilePath}`,
        };
        if (result.status === "ok") {
          received.push([key, result.content]);
        } else {
          this.entryFailures.set(entryKey(moduleFilePath, key), result.message);
          failed = true;
        }
        settled.push(key);
      }
    }
    this.receiveJsonEntries(moduleFilePath, received);
    // A failure reads differently too (`entry-failed`, `entriesStatus`), and
    // a whole-project reader has to hear of it even when nothing arrived.
    if (failed && received.length === 0) this.bump(moduleFilePath);
    for (const key of settled) {
      const cacheKey = entryKey(moduleFilePath, key);
      const loading = this.loadingEntries.get(cacheKey);
      this.loadingEntries.delete(cacheKey);
      loading?.settle();
    }
    this.fetchMoved(moduleFilePath);
    const job = this.bulkLoads.get(moduleFilePath);
    if (again.length > 0) this.askAgain(moduleFilePath, again, job);
    if (bulk > 0 && job !== undefined) {
      job.inFlight -= bulk;
      this.settleBulkLoad(moduleFilePath, job);
    }
  }

  /**
   * Ask again, on the base the module is on now, for keys whose answer was
   * read on the one before. Whoever waits for them -- a `get`, a bulk load --
   * goes on waiting for THIS answer: they are still loading, under the
   * promise they had.
   */
  private askAgain(
    moduleFilePath: ModuleFilePath,
    keys: readonly string[],
    job: BulkLoad | undefined,
  ): void {
    const read = this.baseJsonEntries.get(moduleFilePath);
    const resend: string[] = [];
    for (const key of keys) {
      const cacheKey = entryKey(moduleFilePath, key);
      const loading = this.loadingEntries.get(cacheKey);
      if (loading === undefined) continue;
      // Gone with its module, or here already: nothing to ask for.
      if (
        this.views.get(moduleFilePath) === undefined ||
        read?.has(key) === true
      ) {
        this.loadingEntries.delete(cacheKey);
        loading.settle();
        continue;
      }
      job?.shared.push(loading.promise);
      resend.push(key);
    }
    this.activity.work(
      "source:refetch-json-entries",
      moduleFilePath,
      resend.length,
    );
    if (resend.length > 0) this.queueReads(moduleFilePath, resend);
  }

  /**
   * Send the next bulk batches, up to {@link BULK_REQUESTS_IN_FLIGHT}, in the
   * order the loads were asked for.
   */
  private pumpBulkLoads(): void {
    while (this.bulkInFlight < BULK_REQUESTS_IN_FLIGHT) {
      let next: { moduleFilePath: ModuleFilePath; keys: string[] } | null =
        null;
      for (const [moduleFilePath, job] of this.bulkLoads) {
        const keys = this.nextBulkBatch(moduleFilePath, job);
        if (keys.length > 0) {
          job.inFlight++;
          next = { moduleFilePath, keys };
          break;
        }
        this.settleBulkLoad(moduleFilePath, job);
      }
      if (next === null) return;
      for (const key of next.keys) this.startLoading(next.moduleFilePath, key);
      this.fetchMoved(next.moduleFilePath);
      this.bulkInFlight++;
      void this.fetchEntries(next.moduleFilePath, next.keys, "bulk").finally(
        () => {
          this.bulkInFlight--;
          this.pumpBulkLoads();
        },
      );
    }
  }

  /**
   * The next keys of a bulk load that still need a fetch, as many as one
   * request carries. Formed when it goes out, not when the load was asked
   * for, so an entry a read fetched meanwhile is not asked for again; one
   * already in flight is waited for instead.
   */
  private nextBulkBatch(
    moduleFilePath: ModuleFilePath,
    job: BulkLoad,
  ): string[] {
    const read = this.baseJsonEntries.get(moduleFilePath);
    const candidates: string[] = [];
    const at: number[] = [];
    let i = job.next;
    for (
      ;
      i < job.keys.length && candidates.length < BULK_KEYS_PER_REQUEST;
      i++
    ) {
      const key = job.keys[i];
      const cacheKey = entryKey(moduleFilePath, key);
      if (read?.has(key) === true) continue;
      if (this.entryFailures.has(cacheKey)) continue;
      const inFlight = this.loadingEntries.get(cacheKey);
      if (inFlight !== undefined) {
        job.shared.push(inFlight.promise);
        continue;
      }
      candidates.push(key);
      at.push(i);
    }
    const [batch = []] = chunkJsonEntryKeys(candidates, BULK_KEYS_PER_REQUEST);
    // What did not fit in the URL goes in the next one.
    job.next = batch.length < candidates.length ? at[batch.length] : i;
    return batch;
  }

  /**
   * Finish a bulk load whose keys have all gone out and come back. Before it
   * says done, one more look: an entry dropped while it ran (a file changed
   * on disk, `markJsonEntriesStale`) is a marker again, and "every entry" has
   * to mean every entry when somebody is still waiting.
   */
  private settleBulkLoad(moduleFilePath: ModuleFilePath, job: BulkLoad): void {
    if (this.bulkLoads.get(moduleFilePath) !== job) return;
    if (job.next < job.keys.length || job.inFlight > 0) return;
    if (job.interest > 0) {
      const more = this.wantedEntries(
        moduleFilePath,
        this.markerKeys(moduleFilePath),
      ).filter(
        (key) => !this.loadingEntries.has(entryKey(moduleFilePath, key)),
      );
      if (more.length > 0) {
        job.keys = more;
        job.next = 0;
        queueMicrotask(() => this.pumpBulkLoads());
        return;
      }
    }
    this.bulkLoads.delete(moduleFilePath);
    void Promise.all(job.shared).then(job.finish);
  }

  /** Reads of this tick, per module, not yet sent: see {@link requestEntries}. */
  private readsThisTick = new Map<ModuleFilePath, string[]>();
  /** Answers that have landed and are not applied yet, per module. */
  private landed = new Map<
    ModuleFilePath,
    {
      keys: string[];
      results: Record<string, JsonEntryResult>;
      bulk: boolean;
      /** The base it was read on: see {@link entryBases}. */
      on: number;
    }[]
  >();
  /** Modules with an apply waiting for its turn ({@link yieldToMain}). */
  private applyScheduled = new Set<ModuleFilePath>();
  /** The running {@link loadAllEntries}, one per module, in the order asked. */
  private bulkLoads = new Map<ModuleFilePath, BulkLoad>();
  /** Bulk requests in flight, across every module. */
  private bulkInFlight = 0;

  /**
   * The markers a module's view still holds, and what stands behind each: what
   * {@link entriesStatus}, {@link entriesProgress} and {@link hasUnloadedEntries}
   * count. From the view, so "complete" cannot be true while a read would
   * still find a marker.
   */
  private markersOf(
    moduleFilePath: ModuleFilePath,
  ): { key: string; failure: string | undefined }[] | null {
    const view = this.views.get(moduleFilePath)?.view;
    if (view === undefined) return null;
    if (!isJsonObject(view.source)) return [];
    const counted = this.entriesCounted.get(view);
    if (
      counted !== undefined &&
      counted.failureWrites === this.entryFailures.writes
    ) {
      return counted.markers;
    }
    const markers: { key: string; failure: string | undefined }[] = [];
    const keys = Object.keys(view.source);
    this.activity.work("source:count-entries", moduleFilePath, keys.length);
    for (const key of keys) {
      const value = view.source[key];
      if (!Internal.isJson(value)) continue;
      const error = view.entryErrors.get(key);
      const fetchKey = fetchKeyOf(view, key) ?? key;
      markers.push({
        key,
        failure:
          error?.message ??
          this.entryFailures.get(entryKey(moduleFilePath, fetchKey)),
      });
    }
    this.entriesCounted.set(view, {
      failureWrites: this.entryFailures.writes,
      markers,
    });
    return markers;
  }

  /**
   * Are every one of these modules' `.jsonValues()` entries here?
   *
   * For a guard that must not act on a partial view of the project: a reference
   * scan that reports "no referrers" because it never saw half the content is
   * worse than one that says it is still loading. `incomplete` means keep
   * waiting, `error` names the entries that will never arrive without a retry.
   */
  entriesStatus(moduleFilePaths: readonly ModuleFilePath[]): {
    status: "complete" | "incomplete" | "error";
    errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
  } {
    /**
     * Reference-stable BY KEY: the views of the modules asked about and the
     * failures recorded, which is everything the answer is made of. It is
     * read on every render of whatever waits for a full load, so walking the
     * markers per read was a cost per render (a tenth of the busy time of
     * "used by" at 10,000 posts); a view moves once per batch.
     */
    const cacheKey = moduleFilePaths.join("\n");
    const views = moduleFilePaths.map(
      (moduleFilePath) => this.views.get(moduleFilePath)?.view,
    );
    const held = this.entriesStatusCache.get(cacheKey);
    if (
      held !== undefined &&
      held.failureWrites === this.entryFailures.writes &&
      held.views.length === views.length &&
      held.views.every((view, index) => view === views[index])
    ) {
      return held.status;
    }
    this.activity.work("source:entries-status", cacheKey);
    const errors: {
      moduleFilePath: ModuleFilePath;
      key: string;
      message: string;
    }[] = [];
    let incomplete = false;
    for (const moduleFilePath of moduleFilePaths) {
      const markers = this.markersOf(moduleFilePath);
      if (markers === null) {
        // The module's source has not arrived, so its key set is unknown.
        incomplete = true;
        continue;
      }
      for (const { key, failure } of markers) {
        if (failure !== undefined) {
          errors.push({ moduleFilePath, key, message: failure });
          continue;
        }
        incomplete = true;
      }
    }
    const next: EntriesStatus =
      errors.length > 0
        ? { status: "error", errors }
        : { status: incomplete ? "incomplete" : "complete", errors };
    // And kept when a moved view gives the same answer, which it usually
    // does (another batch landed, the load is still incomplete): this is read
    // on a render path, and a fresh object there is a render loop as soon as
    // anything downstream puts it in an effect's dependencies.
    const status =
      held !== undefined && sameEntriesStatus(held.status, next)
        ? held.status
        : next;
    this.entriesStatusCache.set(cacheKey, {
      views,
      failureWrites: this.entryFailures.writes,
      status,
    });
    return status;
  }

  private entriesStatusCache = new Map<
    string,
    {
      views: (ModuleView | undefined)[];
      failureWrites: number;
      status: EntriesStatus;
    }
  >();

  /**
   * Why this entry's last fetch failed, if it did. For a record row, which
   * knows its key and has no path to peek at until the content arrives.
   */
  entryError(moduleFilePath: ModuleFilePath, key: string): string | undefined {
    const view = this.views.get(moduleFilePath)?.view;
    const fetchKey = view === undefined ? key : (fetchKeyOf(view, key) ?? key);
    return (
      view?.entryErrors.get(key)?.message ??
      this.entryFailures.get(entryKey(moduleFilePath, fetchKey))
    );
  }

  /**
   * A record list's rows that have no content yet: the keys still markers,
   * and among them those whose fetch failed, with why.
   *
   * One answer per view of the module (with the failures recorded), the same
   * object while that holds: a record list asks on every render, and deriving
   * it per render asked `entryError` for every key of the record -- at 10,000
   * keys a walk per render of the list while it scrolled.
   */
  rowStates(moduleFilePath: ModuleFilePath): EntryRowStates {
    const markers = this.markersOf(moduleFilePath);
    if (markers === null || markers.length === 0) {
      return NO_ROW_STATES;
    }
    const held = this.rowStatesByMarkers.get(markers);
    if (held !== undefined) {
      return held;
    }
    const unloadedKeys = new Set<string>();
    const errorByKey = new Map<string, string>();
    for (const { key, failure } of markers) {
      if (failure !== undefined) {
        errorByKey.set(key, failure);
      } else {
        unloadedKeys.add(key);
      }
    }
    const states: EntryRowStates = { unloadedKeys, errorByKey };
    this.rowStatesByMarkers.set(markers, states);
    return states;
  }

  private rowStatesByMarkers = new WeakMap<
    { key: string; failure: string | undefined }[],
    EntryRowStates
  >();

  /**
   * Does this module hold `.jsonValues()` markers with no content loaded?
   * Asked by anything that WALKS source and must report its answer as partial.
   */
  hasUnloadedEntries(moduleFilePath: ModuleFilePath): boolean {
    return (this.markersOf(moduleFilePath)?.length ?? 0) > 0;
  }

  /**
   * How many `.jsonValues()` entries a module has, and how many are here. For
   * a progress indicator. Counted rather than tracked, so they cannot disagree
   * with what a read would find.
   */
  entriesProgress(moduleFilePath: ModuleFilePath): {
    total: number;
    loaded: number;
    failed: number;
  } {
    const view = this.views.get(moduleFilePath)?.view;
    if (view === undefined || !isJsonObject(view.at.content.source)) {
      return { total: 0, loaded: 0, failed: 0 };
    }
    const markers = this.markersOf(moduleFilePath) ?? [];
    // `markersOf` just counted this view (or found it counted), so the
    // progress is kept beside its markers and goes stale with them.
    const counted = this.entriesCounted.get(view);
    if (counted?.progress !== undefined) return counted.progress;
    let total = 0;
    const content = view.at.content.source;
    const keys = Object.keys(content);
    this.activity.work("source:count-entries", moduleFilePath, keys.length);
    for (const key of keys) {
      if (!Internal.isJson(content[key])) continue;
      // Content the chain wrote whole (a new entry) is not an entry to load.
      if (entryState(view.at.content, key)?.kind === "content") continue;
      total++;
    }
    const failed = markers.filter((marker) => marker.failure !== undefined);
    const progress = {
      total,
      loaded: total - markers.length,
      failed: failed.length,
    };
    if (counted !== undefined) counted.progress = progress;
    return progress;
  }

  /**
   * Ask again for an entry whose fetch failed. The only way out of
   * `entry-failed`: it clears the failure first, or `loadEntry` would return
   * the recorded error without attempting anything.
   */
  async retryEntry(
    moduleFilePath: ModuleFilePath,
    key: string,
  ): Promise<{ status: "ok" } | { status: "error"; message: string }> {
    const view = this.views.get(moduleFilePath)?.view;
    const fetchKey = view === undefined ? key : (fetchKeyOf(view, key) ?? key);
    if (this.entryFailures.delete(entryKey(moduleFilePath, fetchKey))) {
      this.fetchMoved(moduleFilePath);
    }
    return this.loadEntry(moduleFilePath, fetchKey);
  }

  /** Fetch one BASE entry, by its key, with this tick's other reads. */
  private async loadEntry(
    moduleFilePath: ModuleFilePath,
    key: string,
  ): Promise<{ status: "ok" } | { status: "error"; message: string }> {
    if (this.fetchJsonEntries === undefined) {
      return {
        status: "error",
        message: `Cannot read inside '${key}' of ${moduleFilePath}: no jsonValues fetch is configured. Refusing rather than reporting the path absent.`,
      };
    }
    await Promise.all(this.requestEntries(moduleFilePath, [key]));
    // The fetch's outcome, shared or not, rather than an assumed success. A
    // definite failure, never a promise that never settles.
    const failure = this.entryFailures.get(entryKey(moduleFilePath, key));
    return failure === undefined
      ? { status: "ok" }
      : { status: "error", message: failure };
  }

  // #region reading

  /**
   * Status without side effects. See {@link SourcePeek}: `get` triggers a fetch,
   * so there has to be a way to look that cannot.
   *
   * ## Reference-stable, and that is part of the contract
   *
   * Peeking the same unchanged path twice returns the SAME OBJECT:
   * `useSyncExternalStore` requires a snapshot that only changes when the
   * value does, and a fresh object per call makes React re-render forever.
   *
   * Stable BY KEY (see {@link peeked}): the answer is worked out once per view
   * of the module, schema, revision and entry fetches, and handed back as it
   * was while none of those moved. The view is replaced only where a module
   * is computed ({@link refresh}), and the engine copies along a patch's path
   * and shares the rest, so the value at a path no patch touched is the same
   * object in the next view too.
   */
  peek(path: SourcePath): SourcePeek {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    const view = this.views.get(moduleFilePath)?.view;
    return this.peekIn(this.peeked, path, moduleFilePath, modulePath, view);
  }

  private peekIn(
    cache: Map<SourcePath, Peeked>,
    path: SourcePath,
    moduleFilePath: ModuleFilePath,
    modulePath: string,
    view: ModuleView | undefined,
  ): SourcePeek {
    const schema = this.schemaStore.get(moduleFilePath);
    const n = this.revisions.get(moduleFilePath) ?? 0;
    const fetchEpoch = this.fetchEpochs.get(moduleFilePath) ?? 0;
    const kept = cache.get(path);
    if (
      kept !== undefined &&
      kept.view === view &&
      kept.schema === schema &&
      kept.n === n &&
      kept.fetchEpoch === fetchEpoch
    ) {
      return kept.peek;
    }
    const peek = this.computePeek(moduleFilePath, modulePath, view, schema);
    cache.set(path, { view, schema, n, fetchEpoch, peek });
    return peek;
  }

  private computePeek(
    moduleFilePath: ModuleFilePath,
    modulePath: string,
    view: ModuleView | undefined,
    schema: SerializedSchema | undefined,
  ): SourcePeek {
    if (view === undefined || schema === undefined) {
      return { status: "module-loading" };
    }
    const resolved = resolveAt(view.source, modulePath);
    if (resolved.status === "needs-entry") {
      const error = view.entryErrors.get(resolved.key);
      if (error !== undefined) {
        return {
          status: "entry-failed",
          key: resolved.key,
          message: error.message,
        };
      }
      const fetchKey = fetchKeyOf(view, resolved.key) ?? resolved.key;
      const cacheKey = entryKey(moduleFilePath, fetchKey);
      if (this.loadingEntries.has(cacheKey)) {
        return { status: "entry-loading", key: resolved.key };
      }
      const failed = this.entryFailures.get(cacheKey);
      if (failed !== undefined) {
        // Checked BEFORE reporting `entry-missing`, so a caller that retries
        // on missing does not loop on a fetch that is never going to work.
        return { status: "entry-failed", key: resolved.key, message: failed };
      }
      return { status: "entry-missing", key: resolved.key };
    }
    const revision = this.revisionOf(moduleFilePath);
    if (resolved.status === "found") {
      return { status: "ready", revision, data: resolved.value };
    }
    return { status: "absent", revision };
  }

  /** This module's shipped chain entries, in chain order. See {@link shippedCache}. */
  private shippedEntries(moduleFilePath: ModuleFilePath): {
    shipped: { record: PatchRecord }[];
    applied: string;
  } {
    const chain = this.chains.get(moduleFilePath);
    if (chain === undefined) return { shipped: [], applied: "" };
    const cached = this.shippedCache.get(moduleFilePath);
    const appliedVersion = this.appliedVersions.get(moduleFilePath) ?? 0;
    if (
      cached !== undefined &&
      cached.chain === chain &&
      cached.length === chain.length &&
      cached.appliedVersion === appliedVersion
    ) {
      return cached;
    }
    const shipped = chain.filter((entry) => isApplied(entry.record));
    const applied = shipped.map((entry) => entry.record.patchId).join("\0");
    this.shippedCache.set(moduleFilePath, {
      chain,
      length: chain.length,
      appliedVersion,
      shipped,
      applied,
    });
    return { shipped, applied };
  }

  /**
   * The realm {@link peekBase} reads: the base, with every SHIPPED patch still in
   * the chain applied on top of it, through the same engine.
   *
   * The base alone is not what has been published. In `http` mode a published
   * patch stays in the chain, with `appliedAt` set, until the next deployment
   * moves the base — so between publish and deploy the base is the text from
   * BEFORE the publish. Comparing against it made "A"→"B", publish, "B"→"A"
   * look like nothing to publish.
   *
   * Computed only when its inputs move: the base, the base entries read, the
   * schema, and which of the chain's patches have shipped. Never on a pending
   * edit, which touches none of them.
   */
  private publishedView(
    moduleFilePath: ModuleFilePath,
  ): ModuleView | undefined {
    const base = this.baseSources[moduleFilePath];
    if (base === undefined) return undefined;
    const schema = this.schemaStore.get(moduleFilePath);
    const { shipped, applied } = this.shippedEntries(moduleFilePath);
    const entriesEpoch = this.baseEntriesEpoch.get(moduleFilePath) ?? 0;
    const kept = this.published.get(moduleFilePath);
    if (
      kept !== undefined &&
      kept.base === base &&
      kept.schema === schema &&
      kept.entriesEpoch === entriesEpoch &&
      kept.applied === applied
    ) {
      return kept.view;
    }
    const records = shipped.map((entry) => entry.record);
    const view = this.counted(moduleFilePath, () => {
      const inputs = this.inputsOf(moduleFilePath, base, schema);
      let at =
        records.length === 0 ? baseAt(inputs) : applyOnBase(inputs, records);
      if (at.failed.length > 0) {
        /*
         * The server applied it and this could not. The base is the best
         * answer left, and the next intake replaces it anyway.
         */
        Internal.log.error(
          "could not apply a published change to the base. Comparisons against what is published may be stale until the next load.",
          { moduleFilePath, failed: at.failed },
        );
        at = baseAt(inputs);
      }
      return viewOf(
        at,
        this.baseJsonEntries.get(moduleFilePath),
        schema,
        this.resolvedEntries,
      );
    });
    this.published.set(moduleFilePath, {
      base,
      entriesEpoch,
      schema,
      applied,
      view,
    });
    return view;
  }

  /**
   * The COMMITTED value at a path — what has been published, before pending
   * patches.
   *
   * For a diff or compare view: "what did this look like before I touched it",
   * and for the Publish gate: "would publishing change anything". Walks the
   * {@link publishedView} and is otherwise the same walk as {@link peek}, so
   * the two answers are comparable by construction, and reference-stable the
   * same way.
   */
  peekBase(path: SourcePath): SourcePeek {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    return this.peekIn(
      this.peekedBase,
      path,
      moduleFilePath,
      modulePath,
      this.publishedView(moduleFilePath),
    );
  }

  // #region publishing

  /**
   * Bake SOME of a module's chain into the base, and keep the rest.
   *
   * For the moment after a publish. The patches are now in the repository, so
   * the chain that produced the value is about to lose them — and losing them
   * while the base is the pre-publish text would revert every published field
   * on screen until the next source fetch arrives.
   *
   * Auto-save publishes the snapshot it named while a field carries on being
   * typed into, so the patches that shipped are a PREFIX of the chain rather
   * than all of it. Baking the whole value there is a silent double-apply —
   * the tail's effect goes into the base AND the tail stays in the chain to be
   * applied again on top. So the new base is base + the published prefix,
   * through the engine, WITHOUT their `file` ops: the published files are
   * where the source names them now, not in a patch, and a `patch_id` left in
   * the base would point the field's URL at a patch that is gone.
   *
   * When everything shipped and carried no file, the new base IS what is on
   * screen -- the same objects, nothing applied again, nothing repaints.
   */
  promotePublished(
    publishedIds: readonly PatchId[],
    modules: readonly ModuleFilePath[],
  ): void {
    const published = new Set(publishedIds);
    for (const moduleFilePath of modules) {
      const chain = this.chains.get(moduleFilePath) ?? [];
      const surviving = chain.filter(
        (entry) => !published.has(entry.record.patchId),
      );
      if (surviving.length === chain.length) {
        // None of this module's chain shipped. Nothing to bake.
        continue;
      }
      const base = this.baseSources[moduleFilePath];
      if (base === undefined) {
        // Never loaded, so there is no base to move. The chain edit still has
        // to happen or the published patches re-land when it does load.
        this.chains.set(moduleFilePath, surviving);
        continue;
      }
      const shipped = chain
        .filter((entry) => published.has(entry.record.patchId))
        .map((entry) => entry.record);
      const withFiles = shipped.some((record) =>
        record.patch.some((op) => op.op === "file"),
      );
      const shown = this.views.get(moduleFilePath)?.view;
      let content: ModuleContent;
      if (
        surviving.length === 0 &&
        !withFiles &&
        shown !== undefined &&
        shown.at.failed.length === 0 &&
        shown.at.tried.length === chain.length
      ) {
        content = shown.at.content;
      } else {
        const schema = this.schemaStore.get(moduleFilePath);
        const records = shipped.map((record) => ({
          ...record,
          patch: record.patch.filter((op) => op.op !== "file"),
        }));
        const at = this.counted(moduleFilePath, () =>
          applyOnBase(this.inputsOf(moduleFilePath, base, schema), records),
        );
        if (at.failed.length > 0) {
          /*
           * The server applied it and this could not. The chain KEEPS what
           * was published, because the base did not move: trimming here would
           * leave the edit in neither base nor chain. The next stat reconciles
           * the chain against what the server holds.
           */
          Internal.log.error(
            "could not rebuild the base after a save. The value on screen is right; the base behind it is stale until the next load.",
            { moduleFilePath, failed: at.failed },
          );
          continue;
        }
        content = at.content;
      }
      this.activity.work("source:promote-to-base", moduleFilePath);
      this.entryBaseMoved(moduleFilePath);
      this.baseSources[moduleFilePath] = content.source;
      this.bakeEntries(moduleFilePath, content);
      this.bumpBase(moduleFilePath);
      this.chains.set(moduleFilePath, surviving);
      const { before, after } = this.refresh(moduleFilePath);
      if (SourceStore.moved(before, after)) {
        this.bump(moduleFilePath);
        this.wakeChanged(moduleFilePath, before);
      }
    }
  }

  /**
   * The base entries after a bake: what the engine made each entry the chain
   * touched. One whose edits were held on a base never read is forgotten, so
   * the next read asks the server, which has the published content.
   */
  private bakeEntries(
    moduleFilePath: ModuleFilePath,
    content: ModuleContent,
  ): void {
    if (content.entries.size === 0) return;
    let byKey = this.baseJsonEntries.get(moduleFilePath);
    if (byKey === undefined) {
      byKey = new Map();
      this.baseJsonEntries.set(moduleFilePath, byKey);
    }
    const base = new Map(byKey);
    const view = this.counted(moduleFilePath, () =>
      viewOf(baseAtContent(content), base, undefined, this.resolvedEntries),
    );
    for (const [key, state] of content.entries) {
      const filled =
        isJsonObject(view.source) && !Internal.isJson(view.source[key])
          ? view.source[key]
          : undefined;
      if (state.kind === "deleted" || filled === undefined) {
        byKey.delete(key);
      } else {
        byKey.set(key, filled);
      }
    }
    this.entriesMoved(moduleFilePath);
  }

  /**
   * Forget these patches WITHOUT computing anything again: they are
   * published, and their effect is in the base the next manifest names. The
   * modules are computed when that base arrives ({@link adoptServer}).
   */
  forgetPublished(patchIds: readonly PatchId[]): void {
    const published = new Set(patchIds);
    for (const [moduleFilePath, chain] of this.chains) {
      const surviving = chain.filter(
        (entry) => !published.has(entry.record.patchId),
      );
      if (surviving.length !== chain.length) {
        this.chains.set(moduleFilePath, surviving);
      }
    }
  }

  /**
   * Whether the manifest adopted for this patch's module says it is gone:
   * the server's version of the module does not have it, and that manifest
   * was asked for after this Studio held it. `false` when nothing has been
   * decided for the module (no manifest yet, or a base new code moved here).
   */
  isGone(
    patchId: PatchId,
    moduleFilePath: ModuleFilePath | undefined,
  ): boolean {
    if (moduleFilePath === undefined) return false;
    const below = this.server.get(moduleFilePath);
    const base = this.baseOf(moduleFilePath);
    if (
      below === undefined ||
      base === undefined ||
      below.version.base !== base.version ||
      below.applied.includes(patchId)
    ) {
      return false;
    }
    return this.decidedGone(patchId, below.decidedAt);
  }

  /**
   * The server's version this module was moved to, as adopted, whatever base
   * the store holds now: what a re-intake that put the bundle's base back is
   * undone with (`ManifestSource`), in the same turn.
   */
  adoptedServer(moduleFilePath: ModuleFilePath): {
    version: ModuleVersion;
    at: ModuleAt | { applied: readonly PatchId[] };
  } | null {
    const below = this.server.get(moduleFilePath);
    if (below === undefined) return null;
    return {
      version: below.version,
      at: below.at ?? { applied: below.applied },
    };
  }

  /** The version the server named for this module, as adopted, if one has. */
  serverVersionOf(moduleFilePath: ModuleFilePath): ModuleVersion | undefined {
    return this.server.get(moduleFilePath)?.version;
  }

  /**
   * The server's version this module is on, as adopted, with its content --
   * to extend by a delta (the origin tier's `have`), or to put back under a
   * re-intake. `null` before a manifest named one, or on another base.
   */
  serverModuleOf(
    moduleFilePath: ModuleFilePath,
  ): { version: ModuleVersion; at: ModuleAt } | null {
    const below = this.server.get(moduleFilePath);
    const base = this.baseSources[moduleFilePath];
    if (below === undefined || base === undefined) return null;
    const inputs = this.inputsOf(
      moduleFilePath,
      base,
      this.schemaStore.get(moduleFilePath),
    );
    if (below.version.base !== inputs.baseVersion) return null;
    return {
      version: below.version,
      at: this.counted(moduleFilePath, () =>
        this.materializeBelow(moduleFilePath, below, inputs),
      ),
    };
  }

  /**
   * A version this Studio computed for a module, at this base and chain: the
   * memory tier. Its content when it is still kept (`VersionRing`); its
   * patches when only those are (`computedChains`) -- a save confirmed while
   * the editor typed on names a version passed on the way, and what is shown
   * extends it. `null` when this Studio never computed it.
   */
  knownChain(
    moduleFilePath: ModuleFilePath,
    version: Pick<ModuleVersion, "base" | "chain">,
  ): { at: ModuleAt } | { applied: readonly PatchId[] } | null {
    const engine = this.schemaVersionFor(
      this.schemaStore.get(moduleFilePath),
    ).engine;
    const kept = this.ring.atVersion(
      moduleFilePath,
      { engineKey: engine },
      version,
    );
    if (kept !== null) return { at: kept };
    const known = this.computedChains.get(moduleFilePath)?.get(version.chain);
    if (
      known !== undefined &&
      known.base === version.base &&
      known.engine === engine
    ) {
      return { applied: known.applied };
    }
    return null;
  }

  /** The base held for this module, and its version. */
  baseOf(
    moduleFilePath: ModuleFilePath,
  ): { source: Json; version: string } | undefined {
    const source = this.baseSources[moduleFilePath];
    if (source === undefined) return undefined;
    return {
      source,
      version: this.baseVersionFor(moduleFilePath, source),
    };
  }

  /**
   * A module the origin answered, under this Studio's schema for it: what
   * {@link adoptServer} takes. `base` is the base it is on.
   */
  atOfServer(
    moduleFilePath: ModuleFilePath,
    module: OriginModule,
    base: Json,
  ): ModuleAt {
    const schema = this.schemaStore.get(moduleFilePath);
    return serverAt(module, this.inputsOf(moduleFilePath, base, schema));
  }

  /**
   * The module `at` extended by a delta the server answered, or `null` when a
   * patch of it does not apply here. Counted as the Studio's work.
   */
  extendServer(
    moduleFilePath: ModuleFilePath,
    at: ModuleAt,
    records: readonly { patchId: PatchId; patch: PatchRecord["patch"] }[],
    base: Json,
  ): ModuleAt | null {
    const schema = this.schemaStore.get(moduleFilePath);
    const inputs = this.inputsOf(moduleFilePath, base, schema);
    return this.counted(moduleFilePath, () =>
      extendBy(
        at,
        records.map((record) => ({
          patchId: record.patchId,
          moduleFilePath,
          patch: record.patch,
        })),
        inputs,
      ),
    );
  }

  /**
   * Adopt what the server's manifest names, in ONE turn: per module, the
   * module at the server's version (and the base it is on, where that moved),
   * and for every module the manifest was asked for after `decidedAt`
   * patches this Studio held -- so a patch of the chain the server's version
   * does not have is gone, unless it is this Studio's own and not saved yet.
   *
   * This is where another editor's edit, a publish, a discard elsewhere and a
   * base from another build reach the source: as the server's answer, by
   * version, never as a replay of `/stat`'s list on a base that may be
   * another build's (what `BaseAlignment` existed to prevent). Readers are
   * woken where their read moved (`===`), and the patch store is told where
   * each patch of the chain stands.
   */
  adoptServer(
    adopted: ReadonlyMap<
      ModuleFilePath,
      {
        version: ModuleVersion;
        /** Its content, or the patches of a version this Studio computed. */
        at: ModuleAt | { applied: readonly PatchId[] };
        /** A base the module moved to: its source, markers and all. */
        base?: Json;
      }
    >,
    decided: readonly ModuleFilePath[],
    decidedAt: number,
  ): void {
    const touched = new Set<ModuleFilePath>();
    for (const [moduleFilePath, next] of adopted) {
      if (next.base !== undefined) {
        const held = this.baseOf(moduleFilePath);
        if (held === undefined || held.version !== next.version.base) {
          this.activity.work("source:clone-module", moduleFilePath);
          this.baseSources[moduleFilePath] = next.base;
          this.baseVersions.set(moduleFilePath, {
            source: next.base,
            version: next.version.base,
          });
          this.bumpBase(moduleFilePath);
          // `.jsonValues()` entry content read on the base before is not
          // this base's: dropped, so the next read fetches it again -- and
          // so is what is still on its way from it.
          this.entryBaseMoved(moduleFilePath);
          this.clearEntryFailures(moduleFilePath);
          if (this.baseJsonEntries.has(moduleFilePath)) {
            this.baseJsonEntries.delete(moduleFilePath);
            this.entriesMoved(moduleFilePath);
          }
        }
      }
      if (this.baseSources[moduleFilePath] === undefined) continue;
      const at = "version" in next.at ? next.at : null;
      this.server.set(moduleFilePath, {
        version: next.version,
        applied: at !== null ? at.applied : next.at.applied,
        at,
        decidedAt,
      });
      touched.add(moduleFilePath);
    }
    for (const moduleFilePath of decided) {
      if (touched.has(moduleFilePath)) continue;
      const below = this.server.get(moduleFilePath);
      if (below === undefined || below.decidedAt === decidedAt) continue;
      this.server.set(moduleFilePath, { ...below, decidedAt });
      // Only a module with patches beyond its server version can read
      // differently for a new decision.
      const chain = this.chains.get(moduleFilePath);
      if (chain === undefined || chain.length === 0) continue;
      const applied = new Set<PatchId>(below.applied);
      if (chain.some((entry) => !applied.has(entry.record.patchId))) {
        touched.add(moduleFilePath);
      }
    }
    const rebuilt: {
      moduleFilePath: ModuleFilePath;
      before: ModuleView | undefined;
    }[] = [];
    for (const moduleFilePath of touched) {
      const { before, after } = this.refresh(moduleFilePath);
      if (SourceStore.moved(before, after)) {
        this.bump(moduleFilePath);
      }
      rebuilt.push({ moduleFilePath, before });
      const chain = this.chains.get(moduleFilePath);
      if (after !== undefined && chain !== undefined && chain.length > 0) {
        this.announceChain(moduleFilePath, chain, after);
      }
      if (after !== undefined)
        this.loadNewlyHeld(moduleFilePath, before, after);
    }
    for (const { moduleFilePath, before } of rebuilt) {
      this.wakeChanged(moduleFilePath, before);
    }
  }

  /** Where this module's source has got to. */
  revisionOf(moduleFilePath: ModuleFilePath): Revision {
    return {
      module: moduleFilePath,
      n: this.revisions.get(moduleFilePath) ?? 0,
    };
  }

  // #region intake

  /**
   * The three ways a patch reaches source, as three constructors of
   * {@link PatchIntake}. And where the chain's confirmed part ends: a patch the
   * patch store no longer holds as pending is one the server has.
   */
  listenTo(patchStore: PatchStore): () => void {
    this.decidedGone = (patchId, decidedAt) =>
      patchStore.decidedGone(patchId, decidedAt);
    const offReceive = patchStore.events.on("patch:receive", (event) => {
      this.intake({
        kind: "foreign",
        records: patchStore.recordsFor(event.patches),
      });
    });
    const offCreate = patchStore.events.on("patch:create", (event) => {
      this.intake({
        kind: "local",
        records: patchStore.recordsFor(event.patches),
        creatorOf: (patchId) => patchStore.creatorOf(patchId),
      });
    });
    const offDrop = patchStore.events.on("patch:drop", (event) => {
      this.intake({
        kind: "revoked",
        patchIds: event.patches,
        modules: event.modules,
        vanished: event.vanished,
      });
    });
    return () => {
      this.decidedGone = () => false;
      offReceive();
      offCreate();
      offDrop();
    };
  }

  /**
   * Take patches in. THE door into source, and the only place that decides who
   * a patch wakes:
   *
   * - `local` — this session made it, so the field INSTANCE that made it is
   *   left asleep and every other reader of the path is woken. A controlled
   *   input re-rendered by its own keystroke loses the caret.
   * - `foreign` — it came from the server, so it is news to every field here.
   * - `revoked` — it was refused or deleted, so its effect comes back OUT of
   *   source. Everyone whose value moved is woken, the author too.
   */
  intake(intake: PatchIntake): void {
    if (intake.kind === "revoked") {
      this.dropFromChains(intake.patchIds, intake.modules, intake.vanished);
      return;
    }
    this.applyPatches(
      intake.records,
      intake.kind === "local" ? "internal" : "external",
      intake.kind === "local" ? intake.creatorOf : () => undefined,
    );
  }

  /**
   * These patches have SHIPPED: their records say so from here on.
   *
   * The chain holds its own reference to each `PatchRecord`, so marking one
   * applied in `PatchStore` is invisible here. The displayed value does not
   * move, but {@link peekBase} does: it counts shipped patches as published, and
   * its readers subscribe per path.
   */
  markApplied(patchIds: readonly PatchId[]): void {
    if (patchIds.length === 0) return;
    const applied = new Set(patchIds);
    const shippedModules = new Set<ModuleFilePath>();
    const shippedTouched: SourcePath[] = [];
    for (const [moduleFilePath, chain] of this.chains) {
      for (const entry of chain) {
        if (!applied.has(entry.record.patchId)) continue;
        if (isApplied(entry.record)) continue;
        shippedModules.add(moduleFilePath);
        shippedTouched.push(...touchedSourcePaths(entry.record));
        entry.record = {
          ...entry.record,
          appliedAt: { commitSha: APPLIED_ELSEWHERE_SHA },
        };
        this.appliedVersions.set(
          moduleFilePath,
          (this.appliedVersions.get(moduleFilePath) ?? 0) + 1,
        );
      }
    }
    if (shippedTouched.length > 0) {
      // No `bump`: the displayed value did not move.
      this.wakeListeners(shippedModules, [
        {
          origin: "external",
          creatorFieldId: undefined,
          paths: shippedTouched,
        },
      ]);
    }
  }

  /**
   * Forget these patches and compute the modules they were in again.
   *
   * A JSON patch is not invertible in general, so "remove the middle patch"
   * can only mean recompute base + the surviving chain -- from the version
   * before the dropped patch when that one is kept ({@link VersionRing}), so
   * discarding the newest edit applies nothing.
   *
   * Readers are woken where their value moved (`===`: the engine shares what
   * it did not touch), with origin `external`: a dropped patch is news to
   * every field including the one that made it.
   */
  private dropFromChains(
    patchIds: readonly PatchId[],
    modules: readonly ModuleFilePath[],
    vanished: boolean,
  ): void {
    const dropped = new Set(patchIds);
    const rebuilt: {
      moduleFilePath: ModuleFilePath;
      before: ModuleView | undefined;
      after: ModuleView | undefined;
    }[] = [];
    for (const moduleFilePath of modules) {
      const chain = this.chains.get(moduleFilePath);
      if (chain !== undefined) {
        const surviving = chain.filter(
          (entry) => !dropped.has(entry.record.patchId),
        );
        if (surviving.length === chain.length) {
          // Nothing of this module's chain was dropped, so its source is
          // already right.
          continue;
        }
        if (vanished) {
          for (const entry of chain) {
            if (dropped.has(entry.record.patchId)) {
              this.forgetEntriesOf(entry.record);
            }
          }
        }
        this.chains.set(moduleFilePath, surviving);
        /*
         * A dropped patch the server's version has: that version is not what
         * the server will hold once the drop lands. Back to the base, with
         * what survives on top -- from the version before it, where that is
         * kept, so discarding the newest edit applies nothing -- until the
         * next manifest names the version without it.
         */
        const below = this.server.get(moduleFilePath);
        if (
          below !== undefined &&
          below.applied.some((patchId) => dropped.has(patchId))
        ) {
          this.server.delete(moduleFilePath);
        }
      }
      if (this.baseSources[moduleFilePath] === undefined) {
        // Never loaded, so there is no source to compute. The chain edit above
        // still had to happen, or the patch would re-land when it does load.
        continue;
      }
      this.activity.work("source:rebuild-module", moduleFilePath);
      const { before, after } = this.refresh(moduleFilePath);
      this.bump(moduleFilePath);
      rebuilt.push({ moduleFilePath, before, after });
    }
    for (const id of patchIds) this.reportedEntryErrors.delete(id);
    if (rebuilt.length === 0) return;
    // Announced BEFORE the applies, so a consumer sees "these modules went
    // back" and then what survives, in that order.
    this.events.emit({
      type: "source:patch-drop",
      modules: rebuilt.map((r) => r.moduleFilePath),
    });
    for (const { moduleFilePath, after } of rebuilt) {
      const chain = this.chains.get(moduleFilePath);
      if (chain === undefined || chain.length === 0 || after === undefined) {
        continue;
      }
      this.announceChain(moduleFilePath, chain, after);
    }
    for (const { moduleFilePath, before } of rebuilt) {
      this.wakeChanged(moduleFilePath, before);
    }
  }

  /**
   * Tell the patch store where each patch of a module's chain stands in
   * `view`: what the head settles on, for a chain computed again.
   */
  private announceChain(
    moduleFilePath: ModuleFilePath,
    chain: readonly ChainEntry[],
    view: ModuleView,
  ): void {
    const applied = new Set(view.at.applied);
    const failedById = new Map(
      view.at.failed.map((failure) => [failure.patchId, failure.message]),
    );
    const success: PatchId[] = [];
    const failed: { patchId: PatchId; message: string }[] = [];
    for (const { record } of chain) {
      if (applied.has(record.patchId)) success.push(record.patchId);
      const message = failedById.get(record.patchId);
      if (message !== undefined) {
        failed.push({ patchId: record.patchId, message });
      }
    }
    failed.push(...this.entryErrorsOf(moduleFilePath, view));
    if (success.length === 0 && failed.length === 0) return;
    this.events.emit({
      type: "source:patch-apply",
      success,
      failed,
      withoutModule: [],
      modules: success.length > 0 ? [moduleFilePath] : [],
    });
  }

  /**
   * These modules left the project: their source goes, base and loaded
   * entries with it. Their chains stay -- a change to a module that is not in
   * the project is the editor's to discard, and the file may come back -- and
   * the next {@link receive} reports them as `withoutModule`.
   */
  forget(modules: readonly ModuleFilePath[]): void {
    for (const moduleFilePath of modules) {
      if (this.baseSources[moduleFilePath] === undefined) continue;
      delete this.baseSources[moduleFilePath];
      this.baseVersions.delete(moduleFilePath);
      this.server.delete(moduleFilePath);
      this.published.delete(moduleFilePath);
      this.receivedSources.delete(moduleFilePath);
      this.baseJsonEntries.delete(moduleFilePath);
      this.clearEntryFailures(moduleFilePath);
      this.entryBaseMoved(moduleFilePath);
      this.entriesMoved(moduleFilePath);
      this.refresh(moduleFilePath);
      this.bump(moduleFilePath);
    }
  }

  receive(sources: Record<ModuleFilePath, Json>): void {
    this.intakeSeen = true;
    const received: {
      moduleFilePath: ModuleFilePath;
      before: ModuleView | undefined;
      after: ModuleView | undefined;
    }[] = [];
    for (const [path, source] of Object.entries(sources)) {
      const moduleFilePath = path as ModuleFilePath;
      /*
       * The very object received last time is the same module, so no reader
       * is holding anything that moved: `HostStore` hands one back for a
       * module whose instance an HMR round did not re-create. Compared, not
       * tracked. A base from the server is a new object every time -- and
       * when it hashes to the base already held, it is that base (the same
       * version is the same content), and the one held is kept, so nothing
       * built on it moves.
       */
      const previously = this.receivedSources.get(moduleFilePath);
      const sameObject =
        previously !== undefined &&
        previously.source === source &&
        previously.baseRevision === this.baseRevisions.get(moduleFilePath);
      if (!sameObject) {
        // Cloned so the caller cannot keep a handle on what the store now owns
        // and mutate it from outside.
        this.activity.work("source:clone-module", moduleFilePath);
        const base = deepClone(source as JSONValue);
        const held = this.baseSources[moduleFilePath];
        const heldVersion =
          held === undefined
            ? undefined
            : this.baseVersions.get(moduleFilePath);
        const version = this.counted(moduleFilePath, () => baseVersionOf(base));
        if (
          held === undefined ||
          heldVersion === undefined ||
          heldVersion.source !== held ||
          heldVersion.version !== version
        ) {
          if (held !== undefined) this.entryBaseMoved(moduleFilePath);
          this.baseSources[moduleFilePath] = base;
          this.baseVersions.set(moduleFilePath, { source: base, version });
          this.bumpBase(moduleFilePath);
        }
      }
      this.receivedSources.set(moduleFilePath, {
        source,
        baseRevision: this.baseRevisions.get(moduleFilePath),
      });
      /*
       * A recorded entry FAILURE does not survive a re-intake: the server
       * resending this module contradicts it.
       */
      const clearedFailures = this.clearEntryFailures(moduleFilePath);
      const { before, after } = this.refresh(moduleFilePath);
      if (SourceStore.moved(before, after) || clearedFailures) {
        this.bump(moduleFilePath);
      }
      received.push({ moduleFilePath, before, after });
    }
    this.events.emit({
      type: "source:init",
      sources: Object.keys(sources) as ModuleFilePath[],
      moved: received
        .filter(({ before, after }) => SourceStore.moved(before, after))
        .map(({ moduleFilePath }) => moduleFilePath),
    });
    // Emitted as its own `source:patch-apply` after `source:init`: the apply
    // is what tells the patch store which ids landed — which is how the head
    // settles for a patch that arrived before its module.
    for (const { moduleFilePath, after } of received) {
      const chain = this.chains.get(moduleFilePath);
      if (chain === undefined || chain.length === 0 || after === undefined) {
        continue;
      }
      this.announceChain(moduleFilePath, chain, after);
    }
    // And the chains of modules the project does not have, which were waiting
    // for this intake to say so. See `withoutModule` in `applyEntries`.
    const withoutModule = [...this.chains].flatMap(([moduleFilePath, chain]) =>
      this.baseSources[moduleFilePath] === undefined ? chain : [],
    );
    this.applyEntries(withoutModule);
    // And wake everyone whose read moved: a field that mounted before its
    // module arrived reads `module-loading` until it is told.
    for (const { moduleFilePath, before } of received) {
      this.wakeChanged(moduleFilePath, before);
    }
  }

  /**
   * Read one path, quoting the head you believe is current.
   *
   * The handshake is what makes the read safe to do asynchronously: an answer
   * computed against a head that has since moved comes back with the new head,
   * so a slow reply can never overwrite a newer value.
   */
  async get(path: SourcePath, revision: Revision | null): Promise<SourceRead> {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    const current = this.revisionOf(moduleFilePath);
    const view = this.views.get(moduleFilePath)?.view;
    // The cheap answer: what you hold is still right, so nothing is marshalled.
    if (
      revision !== null &&
      revision.module === moduleFilePath &&
      revision.n === current.n &&
      view !== undefined &&
      this.schemaStore.get(moduleFilePath) !== undefined
    ) {
      return { status: "unchanged", revision: current };
    }
    // `absent` is only ever returned when we know enough to say so. Without
    // the schema we do not.
    if (
      view === undefined ||
      this.schemaStore.get(moduleFilePath) === undefined
    ) {
      return { status: "module-loading" };
    }
    this.activity.work("source:read-path", path);
    let resolved = resolveAt(view.source, modulePath);
    if (resolved.status === "needs-entry") {
      // The READ is the demand signal for entry content, and it waits for it.
      const error = view.entryErrors.get(resolved.key);
      if (error !== undefined) {
        return { status: "error", message: error.message };
      }
      const fetchKey = fetchKeyOf(view, resolved.key) ?? resolved.key;
      const load = await this.loadEntry(moduleFilePath, fetchKey);
      if (load.status === "error") {
        return { status: "error", message: load.message };
      }
      // Read again from the store: the load replaced the view.
      const loaded = this.views.get(moduleFilePath)?.view;
      if (loaded === undefined) {
        return { status: "module-loading" };
      }
      resolved = resolveAt(loaded.source, modulePath);
      if (resolved.status === "needs-entry") {
        // At most ONE load per read: `.jsonValues()` is root-only, so one
        // entry is all a path can need. Reaching here means the fetch reported
        // success and delivered nothing -- reported, not retried.
        return {
          status: "error",
          message:
            loaded.entryErrors.get(resolved.key)?.message ??
            `Entry '${resolved.key}' of ${moduleFilePath} was loaded but its content is still missing.`,
        };
      }
    }
    // Read AFTER any load, because a load moves the revision.
    const resolvedAt = this.revisionOf(moduleFilePath);
    if (resolved.status === "absent") {
      return { status: "absent", revision: resolvedAt };
    }
    return {
      status: "resolved-head",
      data: resolved.value,
      revision: resolvedAt,
    };
  }

  /**
   * Is this head still the current one? The same question `get` answers,
   * without the value. For a slow watchdog.
   */
  async isCurrent(revision: Revision): Promise<boolean> {
    return revision.n === this.revisionOf(revision.module).n;
  }

  /**
   * The module's BASE source as this store holds it: what the chain applies
   * to, `.jsonValues()` entries as markers and nothing filled in. What the
   * module's base version is a hash of. A reference into the store; do not
   * mutate.
   */
  baseSourceOf(moduleFilePath: ModuleFilePath): Json | undefined {
    return this.baseSources[moduleFilePath];
  }

  /**
   * The patched source for one module, as fields read it, for other stores in
   * this realm and for the relay. Deliberately NOT cloned: in-realm callers
   * only read. Reference-stable while the module's view is.
   */
  moduleSource(moduleFilePath: ModuleFilePath): Json | undefined {
    return this.views.get(moduleFilePath)?.view.source;
  }

  loadedModules(): ModuleFilePath[] {
    return [...this.views.keys()];
  }

  /**
   * Every path currently registered in this module. THE demand signal, read
   * rather than pushed: it shrinks when a field unmounts, so a row scrolled
   * past stops being paid for.
   */
  listenedPaths(moduleFilePath: ModuleFilePath): SourcePath[] {
    const paths = this.listenersByModule.get(moduleFilePath);
    return paths === undefined ? [] : [...paths];
  }

  /**
   * Register interest in one path. The returned function unregisters, and the
   * path's target is dropped once nobody is left on it.
   */
  addListener(
    path: SourcePath,
    /**
     * The field INSTANCE registering. Two instances can show one path — a studio
     * field and an inline overlay — and what is internal to one is foreign to the
     * other, so suppression has to be per instance.
     */
    fieldId: string,
    listener: (event: FieldEvent) => void,
  ): () => void {
    let byField = this.listenerTargets.get(path);
    if (!byField) {
      byField = new Map();
      this.listenerTargets.set(path, byField);
    }
    let entry = byField.get(fieldId);
    if (!entry) {
      entry = { target: new EventTarget(), count: 0 };
      byField.set(fieldId, entry);
    }
    const registered = entry;
    const fields = byField;
    const [listenModule] = Internal.splitModuleFilePathAndModulePath(path);
    let inModule = this.listenersByModule.get(listenModule);
    if (inModule === undefined) {
      inModule = new Set();
      this.listenersByModule.set(listenModule, inModule);
    }
    inModule.add(path);
    const handler = (ev: Event) => {
      listener((ev as CustomEvent<FieldEvent>).detail);
    };
    registered.target.addEventListener(FIELD_EVENT, handler);
    registered.count++;
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    // Announced so demand-driven consumers can act on it.
    this.events.emit({ type: "source:listen", path, moduleFilePath });
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      registered.target.removeEventListener(FIELD_EVENT, handler);
      registered.count--;
      this.events.emit({ type: "source:unlisten", path, moduleFilePath });
      if (registered.count <= 0 && fields.get(fieldId) === registered) {
        fields.delete(fieldId);
        if (fields.size === 0 && this.listenerTargets.get(path) === fields) {
          this.listenerTargets.delete(path);
          const stillInModule = this.listenersByModule.get(listenModule);
          if (stillInModule !== undefined) {
            stillInModule.delete(path);
            if (stillInModule.size === 0) {
              this.listenersByModule.delete(listenModule);
            }
          }
        }
      }
    };
  }

  /**
   * Record these patches in their modules' chains, then apply them.
   *
   * Recording happens BEFORE the loaded check, which is the whole fix for a
   * patch that arrives ahead of its module: it is remembered now and applied by
   * `receive()` later, rather than dropped.
   */
  private applyPatches(
    records: PatchRecord[],
    origin: PatchOrigin,
    creatorOf: (patchId: PatchId) => string | undefined,
  ): void {
    if (records.length === 0) return;
    const entries = records.map((record) => ({
      record,
      origin,
      creatorFieldId: creatorOf(record.patchId),
    }));
    for (const entry of entries) {
      const moduleFilePath = entry.record.moduleFilePath;
      const chain = this.chains.get(moduleFilePath);
      if (chain === undefined) {
        this.chains.set(moduleFilePath, [entry]);
      } else {
        chain.push(entry);
      }
    }
    this.applyEntries(entries);
  }

  /**
   * Compute the modules these chain entries are in, and say what happened to
   * each entry. Used for new patches, for a rebase's new ones, and for the
   * patches of modules the project does not have.
   *
   * A new patch extends the version before it: one engine apply, whatever the
   * module's size and however long its chain (`studioView.ts`).
   */
  private applyEntries(entries: readonly ChainEntry[]): void {
    if (entries.length === 0) return;
    const success: PatchId[] = [];
    const failed: { patchId: PatchId; message: string }[] = [];
    const withoutModule: PatchId[] = [];
    const changedModules = new Set<ModuleFilePath>();
    // Grouped by (origin, creator): a batch can mix a local edit and a foreign
    // one, and the creator decides which single listener stays asleep.
    const wokenBy: {
      origin: PatchOrigin;
      creatorFieldId?: string;
      paths: SourcePath[];
    }[] = [];
    const byModule = new Map<ModuleFilePath, ChainEntry[]>();
    for (const entry of entries) {
      const moduleFilePath = entry.record.moduleFilePath;
      const inModule = byModule.get(moduleFilePath);
      if (inModule === undefined) byModule.set(moduleFilePath, [entry]);
      else inModule.push(entry);
    }
    for (const [moduleFilePath, inModule] of byModule) {
      if (this.baseSources[moduleFilePath] === undefined) {
        /*
         * Once the project's modules are in, a module that is not among them
         * is not coming: its file was renamed or deleted with this change
         * still unpublished. That is an answer. If the file does come back,
         * the intake that brings it computes this chain, and the patch applies.
         */
        if (this.intakeSeen) {
          withoutModule.push(...inModule.map((entry) => entry.record.patchId));
          continue;
        }
        // Not loaded yet: `receive()` computes base + chain when it arrives.
        this.activity.work("source:skip-unloaded", moduleFilePath);
        continue;
      }
      const { before, after } = this.refresh(moduleFilePath);
      if (after === undefined) continue;
      const applied = new Set(after.at.applied);
      const failedById = new Map(
        after.at.failed.map((failure) => [failure.patchId, failure.message]),
      );
      for (const { record, origin, creatorFieldId } of inModule) {
        if (applied.has(record.patchId)) {
          success.push(record.patchId);
          const paths = touchedSourcePaths(record);
          const existing = wokenBy.find(
            (group) =>
              group.origin === origin &&
              group.creatorFieldId === creatorFieldId,
          );
          if (existing === undefined) {
            wokenBy.push({ origin, creatorFieldId, paths: [...paths] });
          } else {
            existing.paths.push(...paths);
          }
          continue;
        }
        const message = failedById.get(record.patchId);
        if (message !== undefined) {
          failed.push({ patchId: record.patchId, message });
        }
      }
      failed.push(...this.entryErrorsOf(moduleFilePath, after));
      if (SourceStore.moved(before, after)) {
        this.bump(moduleFilePath);
        changedModules.add(moduleFilePath);
      }
      this.loadEditedEntries(moduleFilePath, after, inModule);
    }

    // An apply in which nothing HAPPENED is not news.
    if (
      success.length === 0 &&
      failed.length === 0 &&
      withoutModule.length === 0
    ) {
      return;
    }

    // Emitted BEFORE the field events, and the ordering is load-bearing:
    // dispatch is synchronous, so the patch store has folded this result into
    // its head by the time a woken field reads it.
    this.events.emit({
      type: "source:patch-apply",
      success,
      failed,
      withoutModule,
      modules: [...changedModules],
    });

    if (wokenBy.length === 0) return;
    this.wakeListeners(changedModules, wokenBy);
  }

  /**
   * Ask for the `.jsonValues()` entries these patches edited whose base is not
   * here: the engine holds such an edit until it is, and nothing else may ask
   * -- a page showing the entry, or the editor's own field opened later, would
   * show it without the edit until somebody did. Asked now rather than on the
   * next read, so an edit that does not fit its entry is found (and
   * discarded) while the editor is still there.
   */
  private loadEditedEntries(
    moduleFilePath: ModuleFilePath,
    view: ModuleView,
    entries: readonly ChainEntry[],
  ): void {
    if (!isJsonObject(view.source)) return;
    const keys = new Set<string>();
    for (const { record } of entries) {
      for (const op of record.patch) {
        const key = op.path[0];
        if (op.op === "file" || typeof key !== "string") continue;
        if (Internal.isJson(view.source[key]) && chainTouches(view, key)) {
          keys.add(key);
        }
      }
    }
    if (keys.size > 0) void this.loadEntries(moduleFilePath, [...keys]);
  }

  /**
   * Ask for the base of the `.jsonValues()` entries the server's version holds
   * edits for that `before` did not, as {@link loadEditedEntries} does for a
   * patch applied here: the engine holds such an edit until the base entry is
   * read, the view shows the entry's marker until then, and nothing else
   * would ask -- a page shown the module would wait on it for good.
   */
  private loadNewlyHeld(
    moduleFilePath: ModuleFilePath,
    before: ModuleView | undefined,
    after: ModuleView,
  ): void {
    if (!isJsonObject(after.source)) return;
    const keys: string[] = [];
    for (const [key, state] of after.at.content.entries) {
      if (state.kind !== "waiting" || state.ops === null) continue;
      if (before?.at.content.entries.get(key) === state) continue;
      if (Internal.isJson(after.source[key])) keys.push(key);
    }
    if (keys.length > 0) void this.loadEntries(moduleFilePath, keys);
  }

  /**
   * Wake every listener on a changed path, except the one that caused it: for
   * patches applied, whose paths say what they changed.
   */
  private wakeListeners(
    changedModules: Set<ModuleFilePath>,
    wokenBy: {
      origin: PatchOrigin;
      creatorFieldId?: string;
      /**
       * What changed, at either granularity — see `ChangedPath`. A patch names
       * exact paths; a module matches everything registered inside it.
       */
      paths: ChangedPath[];
    }[],
  ): void {
    // Scoped to the modules that actually changed, not the whole registry: a
    // registered path in some other module could not have matched.
    const candidates = new Set<SourcePath>();
    for (const moduleFilePath of changedModules) {
      const registered = this.listenersByModule.get(moduleFilePath);
      if (registered === undefined) continue;
      for (const path of registered) {
        candidates.add(path);
      }
    }
    this.activity.work("source:scan-listeners", undefined, candidates.size);
    for (const path of candidates) {
      const byField = this.listenerTargets.get(path);
      if (byField === undefined) continue;
      const touching = wokenBy.filter((group) =>
        touchesPath(group.paths, path),
      );
      if (touching.length === 0) continue;
      const [wokenModule] = Internal.splitModuleFilePathAndModulePath(path);
      const revision = this.revisionOf(wokenModule);
      for (const [fieldId, entry] of byField) {
        // The first group this field did NOT cause: everyone except the
        // instance that caused it is woken.
        const wokenByGroup = touching.find(
          (group) => group.creatorFieldId !== fieldId,
        );
        if (wokenByGroup === undefined) continue;
        this.dispatch(entry.target, {
          type: `${wokenByGroup.origin}-patch`,
          path,
          revision,
        });
      }
    }
  }

  /**
   * Wake every listener in this module whose read moved since `before`: for a
   * module computed again (a drop, an intake, an entry read, a publish), where
   * no patch says what changed. Compared with `===` -- the engine copies along
   * a patch's path and shares the rest, so a value that did not move is the
   * same object (risk 5 in the plan). Origin `external`: nobody's own edit.
   */
  private wakeChanged(
    moduleFilePath: ModuleFilePath,
    before: ModuleView | undefined,
  ): void {
    const after = this.views.get(moduleFilePath)?.view;
    if (before === after) return;
    const registered = this.listenersByModule.get(moduleFilePath);
    if (registered === undefined) return;
    this.activity.work("source:scan-listeners", undefined, registered.size);
    const everything =
      before === undefined ||
      after === undefined ||
      before.schema !== after.schema;
    const revision = this.revisionOf(moduleFilePath);
    for (const path of [...registered]) {
      if (!everything && before !== undefined && after !== undefined) {
        const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
        if (sameRead(before, after, modulePath)) continue;
      }
      const byField = this.listenerTargets.get(path);
      if (byField === undefined) continue;
      for (const entry of byField.values()) {
        this.dispatch(entry.target, {
          type: "external-patch",
          path,
          revision,
        });
      }
    }
  }

  private dispatch(target: EventTarget, detail: FieldEvent): void {
    this.activity.work("source:wake-listener", detail.path);
    target.dispatchEvent(new CustomEvent(FIELD_EVENT, { detail }));
  }
}

const FIELD_EVENT = "val:field-changed";

/** Whether a read of `modulePath` answers the same in both views. */
function sameRead(
  before: ModuleView,
  after: ModuleView,
  modulePath: string,
): boolean {
  const a = resolveAt(before.source, modulePath);
  const b = resolveAt(after.source, modulePath);
  if (a.status !== b.status) return false;
  if (a.status === "found" && b.status === "found") return a.value === b.value;
  if (a.status === "needs-entry" && b.status === "needs-entry") {
    return (
      a.key === b.key &&
      before.entryErrors.get(a.key)?.message ===
        after.entryErrors.get(b.key)?.message
    );
  }
  return true;
}

/** A module at `content`, as a base: for reading what a bake made. */
function baseAtContent(content: ModuleContent): ModuleAt {
  return {
    version: { schema: NO_SCHEMA, base: "", chain: "" },
    engine: "",
    content,
    tried: [],
    applied: [],
    failed: [],
  };
}

/**
 * Which source paths a patch may have changed.
 *
 * Op paths are patch paths (`["field"]`); listeners register source paths
 * (`/test.val.ts?"field"`), so each op path is converted and qualified with the
 * module. `move`/`copy` change two places, so both ends are reported.
 */
export function touchedSourcePaths(record: PatchRecord): SourcePath[] {
  const paths: SourcePath[] = [];
  const add = (patchPath: string[]) => {
    paths.push(
      Internal.joinModuleFilePathAndModulePath(
        record.moduleFilePath,
        Internal.patchPathToModulePath(patchPath),
      ),
    );
  };
  for (const op of record.patch) {
    if (op.op === "file") {
      // Where the file's `patch_id` lands: the field (and, for a poster or
      // captions, the video's own path, which is the op's).
      add(op.path);
      continue;
    }
    add(op.path);
    if (op.op === "move" || op.op === "copy") {
      add(op.from);
      addShiftedContainer(op.from);
    }
    // An insert or a removal at an array index shifts EVERY later index, so the
    // value at each of them changed without any of them appearing in an op
    // path. Reporting the container covers them, because `touchesPath` matches
    // an ancestor of a registered path as well as a descendant.
    if (op.op === "add" || op.op === "remove" || op.op === "move") {
      addShiftedContainer(op.path);
    }
  }
  return paths;

  /**
   * Report the parent of an op path when the last segment is an array index.
   * A numeric key on an object also reports its parent: a false positive
   * costing one extra wake, against a false negative that leaves a field
   * displaying a value the store no longer holds.
   */
  function addShiftedContainer(patchPath: string[]): void {
    if (patchPath.length === 0) return;
    const last = patchPath[patchPath.length - 1];
    if (!Number.isInteger(Number(last))) return;
    add(patchPath.slice(0, -1));
  }
}

/**
 * A `Map` that counts its writes, so what is worked out from it can be kept
 * and told when it went stale without being worked out again to compare.
 */
class CountedMap<K, V> extends Map<K, V> {
  /** Moves on every `set`, and on every `delete` or `clear` that removed something. */
  writes = 0;

  override set(key: K, value: V): this {
    this.writes++;
    return super.set(key, value);
  }

  override delete(key: K): boolean {
    const deleted = super.delete(key);
    if (deleted) this.writes++;
    return deleted;
  }

  override clear(): void {
    if (this.size > 0) this.writes++;
    super.clear();
  }
}

/**
 * How many bulk `GET /json` ({@link SourceStore.loadAllEntries}) may be in
 * flight at once, across the store. A browser opens about six connections to
 * a host; the rest are for what the editor does while a search loads: the
 * entries a click opens, `/stat`, saving.
 */
const BULK_REQUESTS_IN_FLIGHT = 3;

/**
 * How many keys a bulk request asks for: as many as the route takes. The URL
 * budget (`chunkJsonEntryKeys`) is what usually decides, at a few dozen keys.
 * Larger than a read's batch because nothing waits on one particular bulk
 * request, and every request is a batch the view is rebuilt for.
 */
const BULK_KEYS_PER_REQUEST = JSON_ENTRIES_BATCH_MAX;

/**
 * The fewest entries a bulk load applies at once, before its last batch: see
 * `SourceStore.bulkBatchIsDue`.
 */
const MIN_BULK_APPLY = 200;

/** One running {@link SourceStore.loadAllEntries}. */
type BulkLoad = {
  /** The base keys to load, by the key they are fetched by. */
  keys: string[];
  /** The first of `keys` not yet considered for a request. */
  next: number;
  /** Requests sent and not yet applied. */
  inFlight: number;
  /** Callers still waiting; at none, what has not gone out is dropped. */
  interest: number;
  /** Fetches of its keys that something else started first. */
  shared: Promise<void>[];
  done: Promise<void>;
  finish: () => void;
};

/** Cache key for one entry of one module. `\0` cannot occur in either half. */
function entryKey(moduleFilePath: ModuleFilePath, key: string): string {
  return `${moduleFilePath}\0${key}`;
}
