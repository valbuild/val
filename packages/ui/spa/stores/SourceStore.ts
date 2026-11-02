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
  VersionRing,
  applyOnBase,
  baseAt,
  chainTouches,
  engineSchemaKey,
  fetchKeyOf,
  isJsonObject,
  resolveAt,
  studioModule,
  viewOf,
  type ModuleAt,
  type ModuleInputs,
  type ModuleView,
  type ResolvedEntries,
} from "./studioView";

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
 * It holds each module's BASE (the source as authored or as the server last
 * sent it, `.jsonValues()` entries as markers), the base content of the
 * entries it has read, and the module's CHAIN. Everything a field reads is the
 * Studio's view of those (`studioView.ts`): {@link withLocalEdits} over
 * {@link chainSource}, through THE engine (`applyPatchRecord` in
 * `@valbuild/shared`, which Val's server applies patches with), at a version
 * computed here ({@link versionOf}). There are no patch rules of its own here
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
  /** In-flight entry fetches, by base key, so N readers of one entry cause ONE fetch. */
  private loadingEntries = new Map<string, Promise<void>>();
  /**
   * Entries whose last fetch FAILED, and why, by base key. Kept because `peek`
   * has to be able to say so: without it a failed entry renders a spinner
   * forever while the effect that would retry sees nothing new to do. Cleared
   * on a successful fetch and on a fresh attempt.
   */
  private entryFailures = new Map<string, string>();
  /** Moved whenever a module's entry fetches start, finish or fail: for {@link peek}. */
  private fetchEpochs = new Map<ModuleFilePath, number>();
  /** Patches an entry's error has been reported for, so it is reported once. */
  private reportedEntryErrors = new Set<PatchId>();
  /**
   * Whether the server has a patch (`PatchStore.isPending` says it does not):
   * where {@link chainSource} ends and {@link withLocalEdits} begins.
   */
  private isConfirmed: (patchId: PatchId) => boolean = () => false;

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
    private readonly fetchJsonEntry?: FetchJsonEntry,
  ) {}

  /**
   * A counter over EVERY module, moved by every `bump`. For a whole-project
   * reader — "all sources", the nav tree, search — whose snapshot has to be a
   * stable value that changes when anything could have.
   */
  private globalRevision = 0;

  /**
   * Modules whose change is computed but not yet announced, and the view each
   * had before the batch: see {@link batched}.
   */
  private deferredAnnouncements = new Set<ModuleFilePath>();
  private deferredWakes = new Map<ModuleFilePath, ModuleView | undefined>();
  private batchDepth = 0;

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
    if (this.batchDepth > 0) {
      this.deferredAnnouncements.add(moduleFilePath);
      return;
    }
    // The one place a revision moves is the one place this is announced. See
    // `source:change` in `types.ts`.
    this.events.emit({ type: "source:change", moduleFilePath });
  }

  /**
   * Run `fn`, announcing the modules it changed ONCE at the end instead of once
   * per change.
   *
   * For an operation that is one thing to its caller but many writes underneath.
   * Loading a `.jsonValues()` record's entries is the case that forced it: each
   * entry is its own request, each arrival changed the module, and every change
   * woke every whole-project subscriber in the app. A 121-entry record therefore
   * re-rendered the open module 121 times in a burst, and the route died with
   * "Maximum update depth exceeded" from inside a Radix ref callback.
   *
   * Deferring the ANNOUNCEMENT and the wakes, not the write, is what makes this
   * safe: the views and revisions are updated as each entry lands, so anything
   * that reads mid-batch sees current data. Flushed in a `finally` before the
   * returned promise settles.
   */
  private async batched<T>(fn: () => Promise<T>): Promise<T> {
    this.batchDepth++;
    try {
      return await fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.deferredAnnouncements.size > 0) {
        const modules = [...this.deferredAnnouncements];
        this.deferredAnnouncements.clear();
        for (const moduleFilePath of modules) {
          this.events.emit({ type: "source:change", moduleFilePath });
        }
        this.events.emit({
          type: "source:patch-apply",
          success: [],
          failed: [],
          withoutModule: [],
          modules,
        });
      }
      if (this.batchDepth === 0 && this.deferredWakes.size > 0) {
        const wakes = [...this.deferredWakes];
        this.deferredWakes.clear();
        for (const [moduleFilePath, before] of wakes) {
          this.wakeChanged(moduleFilePath, before);
        }
      }
    }
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
    records: readonly PatchRecord[],
  ): ModuleInputs {
    const chain = this.chains.get(moduleFilePath) ?? [];
    let confirmed = 0;
    while (
      confirmed < chain.length &&
      confirmed < records.length &&
      (chain[confirmed].origin === "external" ||
        this.isConfirmed(chain[confirmed].record.patchId))
    ) {
      confirmed++;
    }
    const schemaVersion = this.schemaVersionFor(schema);
    return {
      schema,
      schemaVersion: schemaVersion.version,
      engineKey: schemaVersion.engine,
      base,
      baseVersion: this.baseVersionFor(moduleFilePath, base),
      records,
      confirmed,
      onApply: (patchId) => this.activity.work("source:apply-patch", patchId),
    };
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
    const records = (this.chains.get(moduleFilePath) ?? []).map(
      (entry) => entry.record,
    );
    const at = this.counted(moduleFilePath, () =>
      studioModule(
        moduleFilePath,
        this.inputsOf(moduleFilePath, base, schema, records),
        this.ring,
      ),
    );
    return { before, after: this.viewAt(moduleFilePath, at, schema) };
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
   * draft read fills for a page (`withDraftJsonEntries` in `@valbuild/server`).
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
    let byKey = this.baseJsonEntries.get(moduleFilePath);
    if (byKey === undefined) {
      byKey = new Map();
      this.baseJsonEntries.set(moduleFilePath, byKey);
    }
    byKey.set(key, content);
    this.entriesMoved(moduleFilePath);
    this.activity.work("source:receive-json-entry", moduleFilePath);
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
    if (this.batchDepth > 0) {
      // `batched` emits one of these for the whole batch.
      return;
    }
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
    for (const op of record.patch) {
      const keys = [op.path[0]];
      if (op.op === "move" || op.op === "copy") keys.push(op.from[0]);
      for (const key of keys) {
        if (typeof key !== "string") continue;
        forgot = (base?.delete(key) ?? false) || forgot;
      }
    }
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
    const view = this.views.get(moduleFilePath)?.view;
    if (view === undefined) return;
    const read = this.baseJsonEntries.get(moduleFilePath);
    const wanted = new Set<string>();
    for (const key of keys) {
      const fetchKey = this.fetchKey(view, key);
      if (fetchKey === undefined) continue;
      if (read?.has(fetchKey) === true) continue;
      if (this.entryFailures.has(entryKey(moduleFilePath, fetchKey))) continue;
      wanted.add(fetchKey);
    }
    if (wanted.size === 0) return;
    /**
     * Coalesced per module per tick, then announced once. Load-bearing for
     * more than request count: a virtualized `.jsonValues()` record asks for
     * the window it is showing, and every arrival re-renders those rows, which
     * moves the window, which asks again. One announcement per tick is what
     * lets that settle.
     */
    let pending = this.pendingEntryLoads.get(moduleFilePath);
    if (pending === undefined) {
      const keysWanted = new Set<string>();
      const request = (async () => {
        await Promise.resolve();
        this.pendingEntryLoads.delete(moduleFilePath);
        await this.batched(() =>
          Promise.all(
            [...keysWanted].map((key) => this.loadEntry(moduleFilePath, key)),
          ),
        );
      })();
      pending = { keys: keysWanted, request };
      this.pendingEntryLoads.set(moduleFilePath, pending);
    }
    for (const key of wanted) {
      pending.keys.add(key);
    }
    await pending.request;
  }

  /** In-flight coalesced entry loads, per module. See {@link loadEntries}. */
  private pendingEntryLoads = new Map<
    ModuleFilePath,
    { keys: Set<string>; request: Promise<void> }
  >();

  /**
   * Every `.jsonValues()` entry this module has, loaded. The deliberate
   * exception to demand-driven reading, for the callers that genuinely need
   * the whole module: search, a validation pass, a compare view.
   */
  async loadAllEntries(moduleFilePath: ModuleFilePath): Promise<void> {
    const view = this.views.get(moduleFilePath)?.view;
    if (view === undefined || !isJsonObject(view.source)) return;
    const keys: string[] = [];
    for (const [key, value] of Object.entries(view.source)) {
      if (Internal.isJson(value)) keys.push(key);
    }
    await this.loadEntries(moduleFilePath, keys);
  }

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
    const markers: { key: string; failure: string | undefined }[] = [];
    for (const [key, value] of Object.entries(view.source)) {
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
    /**
     * Reference-stable, by recompute-and-compare: this is read on a render
     * path, and a hook that returns a fresh object every render is a render
     * loop as soon as anything downstream puts it in an effect's dependencies.
     * Keyed on the requested modules.
     */
    const cacheKey = moduleFilePaths.join("\n");
    const previous = this.entriesStatusCache.get(cacheKey);
    if (previous !== undefined && sameEntriesStatus(previous, next)) {
      return previous;
    }
    this.entriesStatusCache.set(cacheKey, next);
    return next;
  }

  private entriesStatusCache = new Map<string, EntriesStatus>();

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
    let total = 0;
    for (const [key, value] of Object.entries(view.at.content.source)) {
      if (!Internal.isJson(value)) continue;
      // Content the chain wrote whole (a new entry) is not an entry to load.
      if (entryState(view.at.content, key)?.kind === "content") continue;
      total++;
    }
    const markers = this.markersOf(moduleFilePath) ?? [];
    const failed = markers.filter((marker) => marker.failure !== undefined);
    return { total, loaded: total - markers.length, failed: failed.length };
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

  /** Fetch one BASE entry, by its key. */
  private async loadEntry(
    moduleFilePath: ModuleFilePath,
    key: string,
  ): Promise<{ status: "ok" } | { status: "error"; message: string }> {
    if (this.fetchJsonEntry === undefined) {
      return {
        status: "error",
        message: `Cannot read inside '${key}' of ${moduleFilePath}: no jsonValues fetch is configured. Refusing rather than reporting the path absent.`,
      };
    }
    const cacheKey = entryKey(moduleFilePath, key);
    const inFlight = this.loadingEntries.get(cacheKey);
    if (inFlight !== undefined) {
      // N readers of one entry cause ONE fetch.
      this.activity.work("source:share-json-entry-load", moduleFilePath);
      await inFlight;
      // The shared fetch's outcome, not an assumed success.
      const shared = this.entryFailures.get(cacheKey);
      return shared === undefined
        ? { status: "ok" }
        : { status: "error", message: shared };
    }
    let failure: string | undefined;
    // Cleared before the attempt, so a retry is not reported as failed while
    // it is in flight.
    this.entryFailures.delete(cacheKey);
    const request = (async () => {
      this.activity.work("source:load-json-entry", moduleFilePath);
      const res = await this.fetchJsonEntry!(moduleFilePath, key);
      if (res.status === "error") {
        failure = res.message;
        this.entryFailures.set(cacheKey, res.message);
        return;
      }
      this.receiveJsonEntry(moduleFilePath, key, res.content);
    })().finally(() => {
      this.loadingEntries.delete(cacheKey);
      this.fetchMoved(moduleFilePath);
    });
    this.loadingEntries.set(cacheKey, request);
    this.fetchMoved(moduleFilePath);
    await request;
    // A definite failure, never a promise that never settles.
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
      const inputs = this.inputsOf(moduleFilePath, base, schema, records);
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
          applyOnBase(
            this.inputsOf(moduleFilePath, base, schema, records),
            records,
          ),
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
   * Forget these patches WITHOUT computing anything again.
   *
   * For a base from another build (`BaseAlignment`), whose base already
   * contains them: it is followed by {@link rebase} in the same turn, which
   * computes the modules from that base. Nothing is shown in between.
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
   * Replace the base AND the chain on it, in one step.
   *
   * For a base from another build (`BaseAlignment`). {@link receive} alone
   * computes the chain this store already holds on it and leaves new patches
   * to arrive after it, which is right when the base moves forward and wrong
   * when it moves back: an older build's base needs patches that come BEFORE
   * the ones held here.
   *
   * So the chain of every module in `sources` is replaced by the one given,
   * in its order. An entry that was already here keeps its origin and creator,
   * so a field is not woken by its own edit being replayed. A module outside
   * `sources` keeps its base, and only gains the patches it has never had.
   */
  rebase(sources: Record<ModuleFilePath, Json>, chain: PatchRecord[]): void {
    const previous = new Map<PatchId, ChainEntry>();
    for (const entries of this.chains.values()) {
      for (const entry of entries) {
        previous.set(entry.record.patchId, entry);
      }
    }
    const rebased = new Set<string>(Object.keys(sources));
    // `.jsonValues()` entry content is not in `sources` -- the module's source
    // is markers -- and what is loaded came from the build that answered when
    // it was read. Dropped, so the next read fetches it from this one.
    for (const moduleFilePath of [...this.baseJsonEntries.keys()]) {
      if (!rebased.has(moduleFilePath)) continue;
      this.clearEntryFailures(moduleFilePath);
      this.baseJsonEntries.delete(moduleFilePath);
      this.entriesMoved(moduleFilePath);
    }
    const appended: ChainEntry[] = [];
    for (const moduleFilePath of [...this.chains.keys()]) {
      if (rebased.has(moduleFilePath)) this.chains.delete(moduleFilePath);
    }
    for (const record of chain) {
      const known = previous.get(record.patchId);
      if (!rebased.has(record.moduleFilePath) && known !== undefined) continue;
      const entry = known ?? { record, origin: "external" };
      const moduleChain = this.chains.get(record.moduleFilePath);
      if (moduleChain === undefined) {
        this.chains.set(record.moduleFilePath, [entry]);
      } else {
        moduleChain.push(entry);
      }
      if (!rebased.has(record.moduleFilePath)) appended.push(entry);
    }
    this.receive(sources);
    this.applyEntries(appended);
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
    this.isConfirmed = (patchId) => !patchStore.isPending(patchId);
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
      this.isConfirmed = () => false;
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
      this.published.delete(moduleFilePath);
      this.receivedSources.delete(moduleFilePath);
      this.baseJsonEntries.delete(moduleFilePath);
      this.clearEntryFailures(moduleFilePath);
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
    if (this.batchDepth > 0) {
      if (!this.deferredWakes.has(moduleFilePath)) {
        this.deferredWakes.set(moduleFilePath, before);
      }
      return;
    }
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

/** Cache key for one entry of one module. `\0` cannot occur in either half. */
function entryKey(moduleFilePath: ModuleFilePath, key: string): string {
  return `${moduleFilePath}\0${key}`;
}
