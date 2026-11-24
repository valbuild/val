import {
  Internal,
  resolveSettingsModule,
  VAL_EXTENSION,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
  type ValidationError,
  type ValidationErrors,
} from "@valbuild/core";
import {
  declaredLocales,
  filterBlockingValidationErrors,
  getKeyOfRecordAt,
  keyOfRecordPath,
  type SchemaSourceSnapshot,
} from "@valbuild/shared/internal";
import { collectCustomValidateTargets } from "../validation/customValidate";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import type { SchemaStore } from "./SchemaStore";
import type { SourceStore } from "./SourceStore";
import type { HostBridge, SchemaValidationBridge } from "./bridges";
import { noopActivity, type ActivitySink } from "./activity";

export type CustomValidateStatus =
  | "ran"
  | "not-needed"
  | "unavailable"
  | "error";

export type ValidationResult =
  | { status: "stale" }
  | { status: "unknown-module" }
  | {
      status: "validated";
      errors: ValidationErrors;
      customValidatePaths: SourcePath[];
      customValidateStatus: CustomValidateStatus;
      /**
       * Was the module's whole content available to check?
       *
       * `false` when a `.jsonValues()` record still holds unfetched entries: both
       * halves of validation walk source, and neither can see inside an opaque
       * `{_type:"json"}` marker. `errors: false` then means "nothing wrong in
       * what I could see", which is a different claim from "this module is
       * valid" — and the same reason `customValidateStatus: "unavailable"`
       * exists rather than the custom half being silently dropped.
       */
      jsonEntriesLoaded: boolean;
    };

/**
 * REALM: host. Owns validation errors and their staleness; routes both halves of
 * the work outward.
 *
 * ## The split, and why it is a split rather than one call
 *
 * Validation has two halves with different requirements:
 *
 * - **Schema validation** needs only a serialized schema and JSON source. It is
 *   the expensive, always-needed half, and it clone-transfers fine — so it goes
 *   across the WORKER seam ({@link SchemaValidationBridge}), as
 *   `ValidationWorkerClient` does today.
 * - **Custom validation** executes the user's `validate` closures, which exist
 *   only on the real `Schema` instances. It goes across the HOST seam
 *   ({@link HostBridge}). Projects that declare no custom validators pay nothing
 *   — the walk finds no paths and the host is never asked.
 *
 * Routing everything to the host would be one code path, but it would put the
 * expensive half back on the host thread for every project, including the
 * majority that have no custom validators at all.
 *
 * ## Lazy is the point
 *
 * Today a keystroke costs a validation round-trip per module. Here a patch marks
 * the module STALE and says so (`validation:invalidate`), computing nothing.
 * Typing 40 characters costs 40 set-inserts and zero validations; the one
 * validation happens when the errors are next read.
 */
/** One object, so repeated stale peeks are `===`. See `ValidationStore.peek`. */
const STALE: ValidationResult = { status: "stale" };

/**
 * A record that another module's errors are resolved against, and its keys as
 * they were when that module was validated.
 *
 * `keyOf` names the record it points at; a route resolves against the keys of
 * every router record in the project; `locales` against the project's declared
 * languages. In every case the KEYS are the whole of what the resolution reads,
 * so they are what is remembered and compared — an edit inside an entry moves
 * nothing here, and must not cost the referrer a validation.
 */
type ResolvedRecord =
  | {
      kind: "keyOf";
      module: ModuleFilePath;
      path: SourcePath;
      keys: string | null;
    }
  | { kind: "router"; module: ModuleFilePath; keys: string | null }
  | { kind: "locales"; module: ModuleFilePath; keys: string | null };

type CrossModuleInputs = {
  records: ResolvedRecord[];
  /**
   * Any `router:check-route` marker. The answer then also depends on WHICH
   * modules are routers: a router module that arrives later is a record this
   * result never saw, so no stored keys can register its keys changing.
   */
  routes: boolean;
  /**
   * Any `locale:check-locale`, `router:check-locale-param` or
   * `record:fill-keys` marker — all resolve against `locales.available` in the
   * settings module.
   *
   * Same reason `routes` is a flag and not just a record: a project with no
   * settings module yet resolves these against an empty list, and the module
   * that later declares the languages is one no stored record names.
   */
  locales: boolean;
};

/** The keys of a record as one comparable value, or null if it is not a record. */
function keysOf(source: unknown): string | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  return JSON.stringify(Object.keys(source).sort());
}

function isRouterRecord(schema: SerializedSchema | undefined): boolean {
  return schema !== undefined && schema.type === "record" && !!schema.router;
}

/**
 * The project's languages as one comparable value.
 *
 * Ordered, not a set: `record:fill-keys` reports its missing keys in the order
 * the project declared them, so reordering the list changes the message.
 */
function localesNow(snapshot: SchemaSourceSnapshot): string {
  return JSON.stringify(declaredLocales(snapshot));
}

function recordKeysNow(
  record: ResolvedRecord,
  snapshot: SchemaSourceSnapshot,
): string | null {
  if (record.kind === "router") {
    return keysOf(snapshot.sources[record.module]);
  }
  if (record.kind === "locales") {
    return localesNow(snapshot);
  }
  return keysOf(getKeyOfRecordAt(record.path, snapshot).source);
}

function isSettingsModule(schema: SerializedSchema | undefined): boolean {
  return schema !== undefined && schema.type === "settings";
}

/**
 * Whether a `record:fill-keys` marker is resolved against the SETTINGS module,
 * rather than against a key set it already carries.
 *
 * The marker is raised for every declared key set, not just locales: a
 * literal- or enum-keyed record brings its keys along in `declared`, and only a
 * locale-keyed record leaves them `null` to be read out of settings. Asking the
 * same question `resolveSchemaSourceFixForError` asks, so the two cannot
 * disagree about which markers depend on settings at all.
 *
 * Without the distinction every declared-key record in the project depended on
 * settings, so editing an unrelated one — the assistant's context box, which
 * the panel writes on every keystroke — revalidated all of them.
 */
function readsSettingsLocales(error: ValidationError): boolean {
  if (!(error.fixes ?? []).includes("record:fill-keys")) {
    return false;
  }
  const value = error.value;
  if (!value || typeof value !== "object") {
    return false;
  }
  return !Array.isArray((value as { declared?: unknown }).declared);
}

export class ValidationStore {
  readonly events = new StoreBus<SystemEvent>();

  /**
   * The last result per module, stored as the {@link ValidationResult} callers
   * get back rather than as its parts.
   *
   * Stored pre-wrapped so `peek` can return the SAME OBJECT every time. That is
   * not a micro-optimisation: `peek` is documented as safe to call on a render
   * path, and the previous version built `{ status: "validated", ...cached }`
   * fresh per call — so a `useSyncExternalStore` consumer saw a new snapshot on
   * every render and re-rendered forever. React's own words for it were "maximum
   * update depth exceeded". An unstable reference is precisely what is not safe
   * on a render path, so the store owes stability, not the caller.
   */
  private results = new Map<ModuleFilePath, ValidationResult>();
  private stale = new Set<ModuleFilePath>();
  /**
   * The result an invalidation took away, kept until the next one replaces it.
   *
   * For {@link peekLastKnown}, and only for it. `invalidate` deletes the result
   * so that nothing can mistake it for current — `peek` answers `stale` and the
   * reader asks again. But "stale" is not "no errors", and every reader that
   * drew it as none flashed: an edit to a module with an error anywhere in it
   * took the error off the screen for the length of the revalidation, so the
   * Publish button went from "Fix 1" to "Publish" and back on every pause in
   * typing, and the message under an invalid field blinked out and in.
   */
  private previous = new Map<ModuleFilePath, ValidationResult>();
  /**
   * What each validated module's cross-module fixes were resolved against.
   *
   * A `keyof:check-keys` or `router:check-route` error is a marker: the schema
   * cannot see the record it points at, so the answer is settled when the errors
   * are READ, against the referenced module's source. That makes a module's
   * validity depend on source it does not own — and a change to that source
   * used to reach no one. Renaming a page (a record key) left every module
   * pointing at the old key reporting nothing, and discarding the rename left
   * every module that HAD noticed reporting "does not exist" about a key that
   * was back. Neither module had changed, so neither was invalidated.
   *
   * Kept per dependent so the check on a source change is a set lookup and a
   * string compare per record, not a resolution. Deleted with the result.
   */
  private resolvedAgainst = new Map<ModuleFilePath, CrossModuleInputs>();
  /** Concurrent readers of one module share a single validation. */
  private inFlight = new Map<ModuleFilePath, Promise<ValidationResult>>();
  /**
   * A result's errors as a person is shown them, by the result object: see
   * {@link surfacedOf}.
   */
  private surfacedByResult = new WeakMap<
    ValidationResult,
    Record<SourcePath, ValidationError[]>
  >();
  /** The last {@link surfacedErrors} answer, and the parts it was made of. */
  private surfacedAll: {
    parts: [ModuleFilePath, Record<SourcePath, ValidationError[]>][];
    value: Record<SourcePath, ValidationError[]>;
  } | null = null;

  constructor(
    private readonly schemaStore: SchemaStore,
    private readonly sourceStore: SourceStore,
    private readonly schemaValidation: SchemaValidationBridge,
    private readonly host: HostBridge,
    private readonly activity: ActivitySink = noopActivity,
  ) {}

  /**
   * A module is stale when its source changed, OR its schema changed, OR a
   * record its errors resolve against changed. The first two, or validation
   * silently reports errors against a schema that no longer exists — which is
   * exactly what an HMR edit to a schema file produces. The third, or a `keyOf`
   * field's error describes the referenced record as it was, not as it is; see
   * {@link resolvedAgainst}.
   *
   * Source changes are taken from `source:change`: the one event
   * `SourceStore.bump` emits for every way a module's source can move — a patch
   * applied, a patch dropped, the base received, an entry arriving or being
   * forgotten. This store used to enumerate the specific events instead, and
   * missed one: a drop is its own event and is NOT followed by an apply when
   * nothing in the module's chain survives, which is the ordinary discard. So
   * the discarded edit's errors stayed for as long as nothing else touched the
   * module. Listening to the revision moving cannot miss a way for it to move.
   */
  listenTo(): () => void {
    const offChange = this.sourceStore.events.on("source:change", (event) => {
      this.sourceChanged([event.moduleFilePath]);
    });
    const offSchema = this.schemaStore.events.on("schema:init", (event) => {
      this.schemaChanged(event.modules);
    });
    return () => {
      offChange();
      offSchema();
    };
  }

  /** These modules' source moved: they are stale, and so is whatever resolved against them. */
  private sourceChanged(modules: ModuleFilePath[]): void {
    const dependents = this.dependentsOf(modules);
    this.invalidate(
      dependents.length === 0 ? modules : [...modules, ...dependents],
    );
  }

  /**
   * These modules' schema was replaced: they are stale, and so is everything
   * that resolves against them.
   *
   * Unconditionally, unlike a source change: a resolution reads the referenced
   * SCHEMA as well as its keys — a `keyOf` target that stops being a record, or
   * a record that stops being a router, changes the answer with every key in
   * place, so there is no key comparison that could see it. Schemas move on HMR
   * and on load, not on keystrokes, so the wider net costs nothing that matters.
   */
  private schemaChanged(modules: ModuleFilePath[]): void {
    const changedSet = new Set(modules);
    const routerAmong = modules.some((moduleFilePath) =>
      isRouterRecord(this.schemaStore.get(moduleFilePath)),
    );
    const settingsAmong = modules.some((moduleFilePath) =>
      isSettingsModule(this.schemaStore.get(moduleFilePath)),
    );
    const dependents: ModuleFilePath[] = [];
    for (const [dependent, inputs] of this.resolvedAgainst) {
      if (changedSet.has(dependent)) {
        continue;
      }
      if (
        (inputs.routes && routerAmong) ||
        (inputs.locales && settingsAmong) ||
        inputs.records.some((record) => changedSet.has(record.module))
      ) {
        dependents.push(dependent);
      }
    }
    // A module whose schema is gone was removed from the project: nothing is
    // left to validate, so its last errors must not stand in for new ones --
    // and they must be gone BEFORE the invalidation is announced, because a
    // reader of `surfacedErrors` reads it inside the event.
    const gone = modules.filter(
      (moduleFilePath) => this.schemaStore.get(moduleFilePath) === undefined,
    );
    this.invalidate(
      dependents.length === 0 ? modules : [...modules, ...dependents],
      gone,
    );
  }

  /**
   * A snapshot holding only these modules' source.
   *
   * Never `allSources()`: that walks and substitutes every loaded module, and
   * this runs on every source change once any cross-module result exists — so
   * it would have made typing in one module rebuild a project-sized snapshot
   * per keystroke. A resolution reads the referenced module's source and
   * schema and nothing else, so nothing else is read here.
   */
  private snapshotOf(modules: Iterable<ModuleFilePath>): SchemaSourceSnapshot {
    const sources: Record<ModuleFilePath, Json> = {};
    for (const moduleFilePath of modules) {
      const source = this.sourceStore.moduleSource(moduleFilePath);
      if (source !== undefined) {
        sources[moduleFilePath] = source;
      }
    }
    return { schemas: this.schemaStore.all(), sources };
  }

  /**
   * The validated modules whose cross-module fixes would now resolve
   * differently because one of `changed` moved.
   *
   * Compared on keys, not on "the module changed": a router module is a page
   * module, so typing into any page would otherwise put every module holding a
   * `s.route()` field back into the validation queue on every keystroke.
   */
  private dependentsOf(changed: readonly ModuleFilePath[]): ModuleFilePath[] {
    if (changed.length === 0 || this.resolvedAgainst.size === 0) {
      return [];
    }
    const changedSet = new Set(changed);
    const changedRouters = changed.filter((moduleFilePath) =>
      isRouterRecord(this.schemaStore.get(moduleFilePath)),
    );
    const changedSettings = changed.filter((moduleFilePath) =>
      isSettingsModule(this.schemaStore.get(moduleFilePath)),
    );
    // Who COULD be affected, decided from what is already held. The common
    // case — an edit in a module nothing resolves against — ends here, having
    // read no source at all.
    const candidates: [ModuleFilePath, CrossModuleInputs][] = [];
    for (const [dependent, inputs] of this.resolvedAgainst) {
      if (changedSet.has(dependent)) {
        // Being invalidated anyway.
        continue;
      }
      if (
        (inputs.routes && changedRouters.length > 0) ||
        (inputs.locales && changedSettings.length > 0) ||
        inputs.records.some((record) => changedSet.has(record.module))
      ) {
        candidates.push([dependent, inputs]);
      }
    }
    if (candidates.length === 0) {
      return [];
    }
    // Only the changed modules: a record in any other module cannot have moved.
    const snapshot = this.snapshotOf(changed);
    // Read once per record, not once per dependent that names it.
    const keysNow = new Map<string, string | null>();
    const currentKeys = (record: ResolvedRecord): string | null => {
      const at = record.kind === "keyOf" ? record.path : record.module;
      let keys = keysNow.get(at);
      if (keys === undefined) {
        keys = recordKeysNow(record, snapshot);
        keysNow.set(at, keys);
      }
      return keys;
    };
    const dependents: ModuleFilePath[] = [];
    for (const [dependent, inputs] of candidates) {
      const keysMoved = inputs.records.some(
        (record) =>
          changedSet.has(record.module) && currentKeys(record) !== record.keys,
      );
      const routerAppeared =
        inputs.routes &&
        changedRouters.some(
          (moduleFilePath) =>
            !inputs.records.some(
              (record) =>
                record.kind === "router" && record.module === moduleFilePath,
            ),
        );
      const settingsAppeared =
        inputs.locales &&
        changedSettings.some(
          (moduleFilePath) =>
            !inputs.records.some(
              (record) =>
                record.kind === "locales" && record.module === moduleFilePath,
            ),
        );
      if (keysMoved || routerAppeared || settingsAppeared) {
        dependents.push(dependent);
      }
    }
    return dependents;
  }

  /** What resolving these errors reads from OTHER modules, as it stands now. */
  private crossModuleInputs(
    errors: ValidationErrors,
  ): CrossModuleInputs | null {
    if (errors === false) {
      return null;
    }
    // The markers first, and no source until they are found: most modules
    // with errors have none, and reading source for them would put a
    // cross-module pass on every ordinary validation.
    const paths = new Set<SourcePath>();
    let routes = false;
    let locales = false;
    for (const list of Object.values(errors)) {
      for (const error of list) {
        const fixes = error.fixes ?? [];
        if (fixes.includes("router:check-route")) {
          routes = true;
        }
        if (
          fixes.includes("locale:check-locale") ||
          fixes.includes("router:check-locale-param") ||
          readsSettingsLocales(error)
        ) {
          locales = true;
        }
        const path = keyOfRecordPath(error);
        if (path !== null) {
          paths.add(path);
        }
      }
    }
    if (paths.size === 0 && !routes && !locales) {
      return null;
    }
    const keyOfModules = [...paths].map(
      (path) => Internal.splitModuleFilePathAndModulePath(path)[0],
    );
    // Every router record that has source, which is exactly what
    // `checkRouteIsValid` reads its routes from.
    const routers = routes
      ? this.sourceStore
          .loadedModules()
          .filter((moduleFilePath) =>
            isRouterRecord(this.schemaStore.get(moduleFilePath)),
          )
      : [];
    // The settings module, which is where `locales.available` is read from.
    // Null where the project has none — there is then nothing to watch, and
    // `locales` stays true so that one arriving later is still noticed.
    const settingsModule = locales
      ? resolveSettingsModule(this.schemaStore.all()).moduleFilePath
      : null;
    const snapshot = this.snapshotOf([
      ...keyOfModules,
      ...routers,
      ...(settingsModule !== null ? [settingsModule] : []),
    ]);
    const records: ResolvedRecord[] = [];
    for (const path of paths) {
      const [module] = Internal.splitModuleFilePathAndModulePath(path);
      records.push({
        kind: "keyOf",
        module,
        path,
        keys: keysOf(getKeyOfRecordAt(path, snapshot).source),
      });
    }
    for (const moduleFilePath of routers) {
      records.push({
        kind: "router",
        module: moduleFilePath,
        keys: keysOf(snapshot.sources[moduleFilePath]),
      });
    }
    if (settingsModule !== null) {
      records.push({
        kind: "locales",
        module: settingsModule,
        keys: localesNow(snapshot),
      });
    }
    return { records, routes, locales };
  }

  /**
   * Bumped by every invalidation, so a validation in flight can tell whether the
   * world moved underneath it. See {@link run}.
   */
  private generation = 0;

  /**
   * @param gone modules removed from the project: their last answer is
   *   forgotten rather than kept for {@link peekLastKnown}.
   */
  invalidate(
    modules: ModuleFilePath[],
    gone: readonly ModuleFilePath[] = [],
  ): void {
    this.generation++;
    if (modules.length === 0) return;
    // Marking stale is unconditional; ANNOUNCING it is not. "Your errors are
    // now stale" is only news for a module whose errors someone actually has —
    // otherwise intake alone emits an invalidate per module per store, and the
    // signal that matters drowns in it. Same rule as the render and search
    // stores.
    const goneSet = new Set(gone);
    const hadResult = modules.filter(
      (moduleFilePath) =>
        this.results.has(moduleFilePath) ||
        (goneSet.has(moduleFilePath) && this.previous.has(moduleFilePath)),
    );
    for (const moduleFilePath of modules) {
      this.resolvedAgainst.delete(moduleFilePath);
      if (goneSet.has(moduleFilePath)) {
        this.results.delete(moduleFilePath);
        this.previous.delete(moduleFilePath);
        this.stale.delete(moduleFilePath);
        continue;
      }
      this.stale.add(moduleFilePath);
      const result = this.results.get(moduleFilePath);
      if (result !== undefined) {
        this.previous.set(moduleFilePath, result);
      }
      this.results.delete(moduleFilePath);
    }
    if (hadResult.length > 0) {
      this.events.emit({ type: "validation:invalidate", modules: hadResult });
    }
  }

  async validate(moduleFilePath: ModuleFilePath): Promise<ValidationResult> {
    const cached = this.results.get(moduleFilePath);
    if (cached !== undefined && !this.stale.has(moduleFilePath)) {
      this.activity.work("validation:cache-hit", moduleFilePath);
      // The stored object, so a cache hit through `validate` and one through
      // `peek` are the same reference — a consumer holding one from either must
      // be able to compare them.
      return cached;
    }
    const existing = this.inFlight.get(moduleFilePath);
    if (existing) {
      this.activity.work("validation:share-in-flight", moduleFilePath);
      return existing;
    }
    this.activity.work("validation:cache-miss", moduleFilePath);
    const request = this.run(moduleFilePath).finally(() => {
      this.inFlight.delete(moduleFilePath);
    });
    this.inFlight.set(moduleFilePath, request);
    return request;
  }

  /**
   * How many times one request will recompute after being overtaken.
   *
   * A bound rather than a `while (true)`: each pass is driven by an edit landing
   * mid-flight, so under normal typing this runs once or twice. The cap is for
   * the pathological case — something invalidating faster than validation
   * completes — where spinning forever would be worse than leaving the module
   * stale for whoever asks next.
   */
  private static readonly MAX_RECOMPUTES = 5;

  /**
   * Compute until the answer describes source that has not moved since.
   *
   * ## Why a loop, and not "the reader will ask again"
   *
   * It used to be one pass: compute, store, and clear `stale` only if nothing
   * invalidated meanwhile. The staying-stale half is right — a result computed
   * from pre-edit source must not be cached as current — but nothing then asked
   * again, and the reason is worth spelling out because it is invisible from
   * either side alone.
   *
   * `peek` answers `stale` with ONE shared object, deliberately, so repeated
   * peeks are `===`. The reader re-asked from an effect keyed on the result
   * it rendered. So a module that goes stale → raced result → stale handed the
   * reader the same `STALE` object twice, the effect's dependencies did not
   * change, and the re-ask never happened. (The reader is `useValidationDemand`
   * now, which asks once per time the module goes stale, and relies on this
   * loop for the same reason.) Validation stopped
   * for that module until something remounted the field: typing an invalid value
   * in the canvas showed no error at all, while opening the same field on its own
   * showed it immediately.
   *
   * Fixed here rather than in the hook: "a request I accepted is answered from
   * source that is current" is this store's promise to keep, and the hook cannot
   * keep it — re-asking on every event is exactly the per-keystroke validation
   * this design exists to avoid.
   *
   * Each pass still stores and announces its result, so a reader shows the
   * previous errors while the next pass runs rather than flashing to none.
   */
  private async run(moduleFilePath: ModuleFilePath): Promise<ValidationResult> {
    let last: ValidationResult = STALE;
    for (let attempt = 0; attempt < ValidationStore.MAX_RECOMPUTES; attempt++) {
      last = await this.runOnce(moduleFilePath);
      if (last.status !== "validated") {
        // Nothing to be current about: the module has no schema or no source
        // yet, and intake will invalidate when it arrives.
        return last;
      }
      if (!this.stale.has(moduleFilePath)) {
        return last;
      }
    }
    return last;
  }

  /**
   * The schema half for a `.jsonValues()` record, one entry at a time: what a
   * batch of entries arriving costs is those entries, not the record.
   *
   * Every batch moves the module's source, so the record is stale after each,
   * and validating it whole sent all of it across the worker seam every time
   * -- at 10,000 posts the structured clone alone was 172 ms of main-thread
   * time per batch (`scenarios/measure/results.md`). A record's errors are the
   * union of two things that do not depend on each other:
   *
   * - **The record's own**: its keys, its router's keys, the keys it declares,
   *   its locale scope. None reads an entry's content, so they are validated
   *   on a SHELL -- the same keys, every entry an un-loaded marker -- which
   *   `executeValidate` already walks past without looking inside, and only
   *   when the keys moved: a batch moves none.
   * - **Each entry's**: what the item schema says about it, at its own path.
   *   Kept per key, by the entry object it was computed for, so an entry that
   *   did not change is not validated again: an entry's object is new exactly
   *   when its content moved (it arrived, or an edit copied its path).
   *
   * The entries that changed go as one record of just them, through the same
   * `validate`; what it says outside an entry (its own record-level checks,
   * about a record of the wrong keys) and its key errors (the shell's) are not
   * theirs and are dropped.
   */
  private async validateEntriesRecord(
    moduleFilePath: ModuleFilePath,
    source: Json,
    serializedSchema: SerializedSchema,
    schemaVersion: string,
  ): Promise<ValidationErrors> {
    if (!isJsonObjectSource(source)) {
      return this.schemaValidation.validate(
        moduleFilePath,
        source as Source,
        serializedSchema,
        schemaVersion,
      );
    }
    let held = this.entryErrors.get(moduleFilePath);
    if (held === undefined || held.schemaVersion !== schemaVersion) {
      held = { schemaVersion, byKey: new Map(), record: null };
      this.entryErrors.set(moduleFilePath, held);
    }
    const changed: Record<string, Json> = {};
    const entryPaths = new Map<SourcePath, string>();
    const kept = new Map<string, EntryErrors>();
    // What the record's own checks read: its keys, in order, and which
    // entries are null (a declared key nobody has filled in yet).
    const keys: string[] = [];
    for (const [key, entry] of Object.entries(source)) {
      keys.push(entry === null ? `${key}\u0000null` : key);
      if (entry === null || Internal.isJson(entry)) continue;
      const before = held.byKey.get(key);
      if (before !== undefined && before.entry === entry) {
        kept.set(key, before);
        continue;
      }
      changed[key] = entry;
      entryPaths.set(entryPathOf(moduleFilePath, key), key);
    }
    // Not sent again while the keys stand: entries arriving, or an edit in
    // one, move no key, and the shell of 10,000 keys was the cost (its
    // structured clone, its walk, and its errors cloned back carrying it).
    let recordErrors: ValidationErrors;
    if (held.record !== null && sameKeys(held.record.keys, keys)) {
      recordErrors = held.record.errors;
    } else {
      recordErrors = await this.schemaValidation.validate(
        moduleFilePath,
        shellOf(source),
        serializedSchema,
        schemaVersion,
      );
      held.record = { keys, errors: recordErrors };
    }
    if (entryPaths.size > 0) {
      this.activity.work(
        "validation:validate-entries",
        moduleFilePath,
        entryPaths.size,
      );
      const subset = await this.schemaValidation.validate(
        moduleFilePath,
        changed,
        serializedSchema,
        schemaVersion,
      );
      const byKey = new Map<string, Record<SourcePath, ValidationError[]>>();
      for (const [pathS, errors] of Object.entries(subset || {})) {
        const path = pathS as SourcePath;
        const key = entryKeyOf(entryPaths, path);
        // Outside every entry: a record-level check, which the shell answers.
        if (key === undefined) continue;
        // The key's own: the shell has every key, and says so there.
        const own = errors.filter((error) => error.keyError !== true);
        if (own.length === 0) continue;
        let entryErrors = byKey.get(key);
        if (entryErrors === undefined) {
          entryErrors = {};
          byKey.set(key, entryErrors);
        }
        entryErrors[path] = own;
      }
      for (const [, key] of entryPaths) {
        kept.set(key, { entry: changed[key], errors: byKey.get(key) ?? null });
      }
    }
    // Only the entries still here and loaded: one that left, or was put back
    // to a marker, is not reported, and not kept.
    held.byKey = kept;
    return unionWithEntries(recordErrors, kept);
  }

  private collectCustomTargets(
    moduleFilePath: ModuleFilePath,
    serializedSchema: SerializedSchema,
    source: Json,
  ): SourcePath[] {
    this.activity.work("validation:collect-custom-targets", moduleFilePath);
    return collectCustomValidateTargets(
      moduleFilePath,
      serializedSchema,
      source as Source,
    ).paths;
  }

  /** Whether a module's schema declares any `.validate(...)`, by version. */
  private declaresCustomValidate(
    moduleFilePath: ModuleFilePath,
    serializedSchema: SerializedSchema,
    schemaVersion: string,
  ): boolean {
    const held = this.customValidateDeclared.get(moduleFilePath);
    if (held !== undefined && held.schemaVersion === schemaVersion) {
      return held.declared;
    }
    const declared = declaresCustomValidate(serializedSchema);
    this.customValidateDeclared.set(moduleFilePath, {
      schemaVersion,
      declared,
    });
    return declared;
  }

  private customValidateDeclared = new Map<
    ModuleFilePath,
    { schemaVersion: string; declared: boolean }
  >();

  /**
   * Each `.jsonValues()` record's entry errors, by key, as computed for the
   * entry object they were computed for ({@link validateEntriesRecord}).
   * Dropped when the schema version moves: they were computed against the
   * schema before it.
   */
  private entryErrors = new Map<
    ModuleFilePath,
    {
      schemaVersion: string;
      byKey: Map<string, EntryErrors>;
      /** The record's own errors, and the keys they were computed for. */
      record: { keys: string[]; errors: ValidationErrors } | null;
    }
  >();

  private async runOnce(
    moduleFilePath: ModuleFilePath,
  ): Promise<ValidationResult> {
    // Read BEFORE the awaits below, and compared after. See the note at the
    // bottom of this method.
    const startedAt = this.generation;
    const serializedSchema = this.schemaStore.get(moduleFilePath);
    const source = this.sourceStore.moduleSource(moduleFilePath);
    if (serializedSchema === undefined || source === undefined) {
      // Nothing left to have been right about: the module is gone, or not
      // here yet. Its old errors must not outlive it in `peekLastKnown`.
      this.previous.delete(moduleFilePath);
      return { status: "unknown-module" };
    }

    // Across the worker seam: source and schema ARE the structured clone, which
    // is why they are arguments rather than something the far side reads.
    this.activity.work("validation:schema-validate", moduleFilePath);
    const schemaVersion = String(this.schemaStore.version(moduleFilePath));
    const schemaErrors = isJsonValuesRecord(serializedSchema)
      ? await this.validateEntriesRecord(
          moduleFilePath,
          source,
          serializedSchema,
          schemaVersion,
        )
      : await this.schemaValidation.validate(
          moduleFilePath,
          source as Source,
          serializedSchema,
          schemaVersion,
        );

    // The walk runs here, on the serialized schema: it can see that a validator
    // was DECLARED even though it cannot call it. The host, holding a real
    // instance, could call one but could not tell us it had skipped any.
    // Not at all when the schema declares no validator: the walk goes through
    // the whole source, every loaded entry of a `.jsonValues()` record
    // included, to find nothing.
    const customValidatePaths = this.declaresCustomValidate(
      moduleFilePath,
      serializedSchema,
      schemaVersion,
    )
      ? this.collectCustomTargets(moduleFilePath, serializedSchema, source)
      : [];

    let errors = schemaErrors;
    let customValidateStatus: CustomValidateStatus = "not-needed";
    if (customValidatePaths.length > 0) {
      const custom = await this.host.customValidate(
        moduleFilePath,
        customValidatePaths,
      );
      if (custom.status === "validated") {
        this.activity.work("validation:merge", moduleFilePath);
        errors = mergeValidationErrors(schemaErrors, custom.errors);
        customValidateStatus = "ran";
      } else if (custom.status === "unknown-module") {
        // The host has no instance for this module — it was validated against a
        // serialized schema only. Reported rather than hidden: silently dropping
        // the custom half would show a green module that was never fully checked.
        customValidateStatus = "unavailable";
      } else {
        customValidateStatus = "error";
      }
    }

    // Asked AFTER both halves have run: the custom half can trigger entry loads,
    // so asking first could report a module incomplete that is complete by the
    // time the result is handed back.
    const result: ValidationResult = {
      status: "validated",
      errors,
      customValidatePaths,
      customValidateStatus,
      jsonEntriesLoaded: !this.sourceStore.hasUnloadedEntries(moduleFilePath),
    };
    this.results.set(moduleFilePath, result);
    this.previous.delete(moduleFilePath);
    const inputs = this.crossModuleInputs(errors);
    if (inputs === null) {
      this.resolvedAgainst.delete(moduleFilePath);
    } else {
      this.resolvedAgainst.set(moduleFilePath, inputs);
    }
    /**
     * Only if nothing invalidated while this was running.
     *
     * ANY invalidation, of any module — the counter is global on purpose. That
     * is also what covers a cross-module dependent on its first pass: it has no
     * {@link resolvedAgainst} entry until this method stores one, so a change
     * to the record it reads cannot find it by name and invalidates only the
     * record's own module. But that invalidation moves the generation, this
     * result stays stale, and `run` computes it again against the record as it
     * now is. Pinned by "recomputes a first pass that a referenced record moved
     * under" in `crossModuleValidation.test.ts`.
     *
     * Both halves are awaited — the schema half across a worker, the custom half
     * across the host seam — so an edit can land mid-flight. Clearing `stale`
     * unconditionally cached a result computed from the PRE-edit source and
     * marked it fresh, and `peek` then returned it forever: the reader's effect
     * only re-asks on `stale`, so nothing would ever ask again. The result is
     * still stored — showing the previous errors greyed is better than showing
     * none — but it stays marked stale so the next read recomputes.
     */
    if (this.generation === startedAt) {
      this.stale.delete(moduleFilePath);
    }
    // Left stale otherwise, and `run` above recomputes: the caller is owed an
    // answer about the source as it is now, not as it was when they asked.
    this.events.emit({
      type: "validation:result",
      moduleFilePath,
      errors,
      customValidatePaths,
      customValidateStatus,
    });
    return result;
  }

  /**
   * Cached only: never triggers work, so a render path may call it freely.
   *
   * Returns the STORED object, so repeated peeks of an unchanged result are
   * `===`. See {@link results} for why that is part of the contract rather than
   * an implementation detail.
   */
  peek(moduleFilePath: ModuleFilePath): ValidationResult {
    const cached = this.results.get(moduleFilePath);
    if (cached !== undefined && !this.stale.has(moduleFilePath)) {
      return cached;
    }
    return STALE;
  }

  /**
   * The newest result there is, current or not: what to SHOW while a module
   * revalidates.
   *
   * Same as {@link peek} for a fresh module. For a stale one it is the result
   * the edit made stale — or a pass that an edit overtook — rather than
   * `stale`, so a reader keeps drawing the errors it had until the next pass
   * replaces them. Only `stale` when the module has never been validated.
   *
   * Never use it to DECIDE anything: it is allowed to be out of date, which is
   * the whole point. Whether the module is stale — and so whether to ask
   * {@link validate} — is still `peek`'s to say, and the publish gate validates
   * for itself.
   */
  peekLastKnown(moduleFilePath: ModuleFilePath): ValidationResult {
    return (
      this.results.get(moduleFilePath) ??
      this.previous.get(moduleFilePath) ??
      STALE
    );
  }

  /** Whether {@link peek} would answer `stale` — cheaper than comparing to it. */
  isStale(moduleFilePath: ModuleFilePath): boolean {
    return this.stale.has(moduleFilePath) || !this.results.has(moduleFilePath);
  }

  /**
   * A result's errors as a person is shown them: its cross-module markers
   * resolved and the server's own fixes dropped (`filterBlockingValidationErrors`),
   * or null for a result with nothing to show.
   *
   * Worked out once per RESULT OBJECT and kept beside it, for every reader: a
   * field under it, the whole-project {@link surfacedErrors}, and anything
   * else that shows a module's errors. That is correct because what the
   * resolution reads from other modules -- the record a `keyOf` or a gallery
   * marker names, the routers, the settings' locales -- is
   * {@link resolvedAgainst}, and a change to any of it invalidates this module
   * and makes a new result. While the module is stale its last answer is
   * shown as it was resolved, one pass behind, as every other surface of a
   * stale module is.
   *
   * It used to be worked out per reader: `useAllValidationErrors` filtered
   * every validated module in each component that called it, on every
   * validation event in the project. Eight call it on the gallery page, and
   * loading a `.jsonValues()` record's entries revalidates the record once per
   * batch, so at 10,000 posts that each pick an image it was a second of
   * long tasks (`scenarios/measure/results.md`, "The Studio, built").
   */
  surfacedOf(
    result: ValidationResult,
  ): Record<SourcePath, ValidationError[]> | null {
    if (result.status !== "validated" || result.errors === false) {
      return null;
    }
    const cached = this.surfacedByResult.get(result);
    if (cached !== undefined) {
      return cached;
    }
    const surfaced = filterBlockingValidationErrors(
      result.errors,
      this.schemaStore.all(),
      this.sourceStore.allSources(),
    );
    this.surfacedByResult.set(result, surfaced);
    return surfaced;
  }

  /**
   * Every surfaced validation error the Studio knows of, by source path: the
   * last answer of each loaded module (current or not, as
   * {@link peekLastKnown}), through {@link surfacedOf}.
   *
   * Reference-stable, so it can be a `useSyncExternalStore` snapshot read by
   * every whole-project reader at once: the same object while no module's
   * answer moved, and while a module's answer moved to the same messages (a
   * revalidation that found what the last one did, which is most of them).
   * Reading it costs a look at each loaded module's result; filtering is paid
   * only for a module whose result is new.
   *
   * Reports, never asks: a module that has not been validated contributes
   * nothing. The publish gate validates for itself.
   */
  surfacedErrors(): Record<SourcePath, ValidationError[]> {
    const parts: [ModuleFilePath, Record<SourcePath, ValidationError[]>][] = [];
    for (const moduleFilePath of this.sourceStore.loadedModules()) {
      const surfaced = this.surfacedOf(this.peekLastKnown(moduleFilePath));
      if (surfaced !== null && Object.keys(surfaced).length > 0) {
        parts.push([moduleFilePath, surfaced]);
      }
    }
    const held = this.surfacedAll;
    if (held !== null && sameParts(held.parts, parts)) {
      return held.value;
    }
    let value: Record<SourcePath, ValidationError[]> = {};
    for (const [, surfaced] of parts) {
      Object.assign(value, surfaced);
    }
    if (held !== null && sameErrors(held.value, value)) {
      value = held.value;
    }
    this.surfacedAll = { parts, value };
    return value;
  }
}

function sameParts(
  a: readonly [ModuleFilePath, Record<SourcePath, ValidationError[]>][],
  b: readonly [ModuleFilePath, Record<SourcePath, ValidationError[]>][],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index++) {
    if (a[index][0] !== b[index][0] || a[index][1] !== b[index][1]) {
      return false;
    }
  }
  return true;
}

/**
 * Do two error maps say the same thing?
 *
 * Compared by MESSAGE rather than by object identity, because the resolving pass
 * rebuilds error objects: `resolveSchemaSourceFixes` turns a `router:check-route`
 * marker into a different error, so identity would report every recompute as a
 * change and the comparison would never hold.
 *
 * Messages are what the UI shows and what the error badges count, so two maps
 * with the same paths and the same messages are the same answer as far as every
 * reader of {@link ValidationStore.surfacedErrors} is concerned.
 */
function sameErrors(
  a: Record<SourcePath, ValidationError[]>,
  b: Record<SourcePath, ValidationError[]>,
): boolean {
  const aPaths = Object.keys(a);
  const bPaths = Object.keys(b);
  if (aPaths.length !== bPaths.length) {
    return false;
  }
  for (const path of aPaths) {
    const left = a[path as SourcePath];
    const right = b[path as SourcePath];
    if (right === undefined || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index++) {
      if (left[index].message !== right[index].message) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Whether anything in a serialized schema says `customValidate: true`. The
 * serialized schema is plain data and says so wherever a `.validate(...)` was
 * declared, at any depth, whatever the schema type: so this looks at every
 * object in it rather than knowing each type's children, which a new schema
 * type would then have to be added to.
 */
function declaresCustomValidate(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.some(declaresCustomValidate);
  if (typeof schema !== "object" || schema === null) return false;
  for (const [key, value] of Object.entries(schema)) {
    if (key === "customValidate" && value === true) return true;
    if (declaresCustomValidate(value)) return true;
  }
  return false;
}

/** One `.jsonValues()` entry's errors, and the entry they are about. */
type EntryErrors = {
  entry: Json;
  errors: Record<SourcePath, ValidationError[]> | null;
};

/** What an un-loaded entry is in the shell a record is validated as. */
const UNLOADED_ENTRY: Json = { [VAL_EXTENSION]: "json" };

function isJsonValuesRecord(schema: SerializedSchema): boolean {
  return schema.type === "record" && schema.jsonValues === true;
}

function isJsonObjectSource(source: Json): source is Record<string, Json> {
  return (
    typeof source === "object" && source !== null && !Array.isArray(source)
  );
}

function entryPathOf(moduleFilePath: ModuleFilePath, key: string): SourcePath {
  return Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.patchPathToModulePath([key]),
  );
}

/** The record with every loaded entry put back to an un-loaded marker. */
function shellOf(source: Record<string, Json>): Record<string, Json> {
  const shell: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(source)) {
    shell[key] =
      entry === null || Internal.isJson(entry) ? entry : UNLOADED_ENTRY;
  }
  return shell;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Which entry `path` is at or under, of the ones in `entryPaths`. */
function entryKeyOf(
  entryPaths: ReadonlyMap<SourcePath, string>,
  path: SourcePath,
): string | undefined {
  const exact = entryPaths.get(path);
  if (exact !== undefined) return exact;
  // A path below an entry is the entry's path and more: the first segment
  // boundary after the module part that names a known entry is it.
  for (let at = path.indexOf("."); at !== -1; at = path.indexOf(".", at + 1)) {
    const key = entryPaths.get(path.slice(0, at) as SourcePath);
    if (key !== undefined) return key;
  }
  return undefined;
}

/**
 * The record's own errors and every entry's, in one object: built once, not
 * merged entry by entry, which would copy the whole object per entry.
 */
function unionWithEntries(
  recordErrors: ValidationErrors,
  entries: ReadonlyMap<string, EntryErrors>,
): ValidationErrors {
  let union: Record<SourcePath, ValidationError[]> | null =
    recordErrors === false ? null : { ...recordErrors };
  for (const { errors } of entries.values()) {
    if (errors === null) continue;
    union ??= {};
    for (const [pathS, pathErrors] of Object.entries(errors)) {
      const path = pathS as SourcePath;
      const existing = union[path];
      union[path] =
        existing === undefined ? pathErrors : [...existing, ...pathErrors];
    }
  }
  return union ?? false;
}

/**
 * Union the two halves, per source path.
 *
 * `executeValidate` on the real instance re-runs the SCHEMA checks as well as
 * the custom ones, so the host's result overlaps the worker's. De-duplicating by
 * message is what stops every field in a custom-validated module showing each
 * schema error twice.
 */
function mergeValidationErrors(
  a: ValidationErrors,
  b: ValidationErrors,
): ValidationErrors {
  if (a === false) return b;
  if (b === false) return a;
  const merged: Exclude<ValidationErrors, false> = { ...a };
  for (const [pathS, errors] of Object.entries(b)) {
    const path = pathS as SourcePath;
    const existing = merged[path];
    if (!existing) {
      merged[path] = errors;
      continue;
    }
    const seen = new Set(existing.map((error) => error.message));
    merged[path] = [
      ...existing,
      ...errors.filter((error) => !seen.has(error.message)),
    ];
  }
  return merged;
}
