import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
  type ValidationErrors,
} from "@valbuild/core";
import {
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
 * every router record in the project. In both cases the KEYS are the whole of
 * what the resolution reads, so they are what is remembered and compared — an
 * edit inside an entry moves nothing here, and must not cost the referrer a
 * validation.
 */
type ResolvedRecord =
  | {
      kind: "keyOf";
      module: ModuleFilePath;
      path: SourcePath;
      keys: string | null;
    }
  | { kind: "router"; module: ModuleFilePath; keys: string | null };

type CrossModuleInputs = {
  records: ResolvedRecord[];
  /**
   * Any `router:check-route` marker. The answer then also depends on WHICH
   * modules are routers: a router module that arrives later is a record this
   * result never saw, so no stored keys can register its keys changing.
   */
  routes: boolean;
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

function recordKeysNow(
  record: ResolvedRecord,
  snapshot: SchemaSourceSnapshot,
): string | null {
  if (record.kind === "router") {
    return keysOf(snapshot.sources[record.module]);
  }
  return keysOf(getKeyOfRecordAt(record.path, snapshot).source);
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
    const dependents: ModuleFilePath[] = [];
    for (const [dependent, inputs] of this.resolvedAgainst) {
      if (changedSet.has(dependent)) {
        continue;
      }
      if (
        (inputs.routes && routerAmong) ||
        inputs.records.some((record) => changedSet.has(record.module))
      ) {
        dependents.push(dependent);
      }
    }
    this.invalidate(
      dependents.length === 0 ? modules : [...modules, ...dependents],
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
      const at = record.kind === "router" ? record.module : record.path;
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
      if (keysMoved || routerAppeared) {
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
    for (const list of Object.values(errors)) {
      for (const error of list) {
        if ((error.fixes ?? []).includes("router:check-route")) {
          routes = true;
        }
        const path = keyOfRecordPath(error);
        if (path !== null) {
          paths.add(path);
        }
      }
    }
    if (paths.size === 0 && !routes) {
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
    const snapshot = this.snapshotOf([...keyOfModules, ...routers]);
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
    return { records, routes };
  }

  /**
   * Bumped by every invalidation, so a validation in flight can tell whether the
   * world moved underneath it. See {@link run}.
   */
  private generation = 0;

  invalidate(modules: ModuleFilePath[]): void {
    this.generation++;
    if (modules.length === 0) return;
    // Marking stale is unconditional; ANNOUNCING it is not. "Your errors are
    // now stale" is only news for a module whose errors someone actually has —
    // otherwise intake alone emits an invalidate per module per store, and the
    // signal that matters drowns in it. Same rule as the render and search
    // stores.
    const hadResult = modules.filter((moduleFilePath) =>
      this.results.has(moduleFilePath),
    );
    for (const moduleFilePath of modules) {
      this.stale.add(moduleFilePath);
      this.results.delete(moduleFilePath);
      this.resolvedAgainst.delete(moduleFilePath);
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
   * peeks are `===`. The reader (`useModuleValidation`) re-asks from an effect
   * keyed on the result it rendered. So a module that goes stale → raced result
   * → stale hands the reader the same `STALE` object twice, the effect's
   * dependencies do not change, and the re-ask never happens. Validation stopped
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

  private async runOnce(
    moduleFilePath: ModuleFilePath,
  ): Promise<ValidationResult> {
    // Read BEFORE the awaits below, and compared after. See the note at the
    // bottom of this method.
    const startedAt = this.generation;
    const serializedSchema = this.schemaStore.get(moduleFilePath);
    const source = this.sourceStore.moduleSource(moduleFilePath);
    if (serializedSchema === undefined || source === undefined) {
      return { status: "unknown-module" };
    }

    // Across the worker seam: source and schema ARE the structured clone, which
    // is why they are arguments rather than something the far side reads.
    this.activity.work("validation:schema-validate", moduleFilePath);
    const schemaErrors = await this.schemaValidation.validate(
      moduleFilePath,
      source as Source,
      serializedSchema,
      String(this.schemaStore.version(moduleFilePath)),
    );

    // The walk runs here, on the serialized schema: it can see that a validator
    // was DECLARED even though it cannot call it. The host, holding a real
    // instance, could call one but could not tell us it had skipped any.
    this.activity.work("validation:collect-custom-targets", moduleFilePath);
    const customValidatePaths = collectCustomValidateTargets(
      moduleFilePath,
      serializedSchema,
      source as Source,
    ).paths;

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
