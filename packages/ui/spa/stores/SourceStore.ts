import {
  Internal,
  type Json,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  applyPatch,
  deepClone,
  JSONOps,
  type JSONValue,
} from "@valbuild/core/patch";
import { StoreBus } from "./StoreBus";
import { touchesPath } from "./pathMatch";
import type {
  FieldEvent,
  Head,
  PatchOrigin,
  PatchRecord,
  SourceRead,
  SystemEvent,
} from "./types";
import type { SchemaStore } from "./SchemaStore";
import type { PatchStore } from "./PatchStore";
import { noopActivity, type ActivitySink } from "./activity";

const ops = new JSONOps();

/** How the source store learns the current head without owning the chain. */
export type ReadHead = () => Head;

type Resolved =
  | { status: "found"; value: Json }
  | { status: "absent" }
  | { status: "error"; message: string };

/**
 * Owns the patched source, and owns "who is listening where".
 *
 * Both in one store on purpose: because the same code applies the patch and
 * decides who to tell, the invariant *"if an event went out, the source behind
 * it is already applied"* holds by construction rather than by convention. A
 * field woken by an event can read immediately and cannot get a pre-patch
 * value.
 */
export class SourceStore {
  readonly events = new StoreBus<SystemEvent>();

  /**
   * Source with the applied chain folded in — the only source anyone reads.
   *
   * The base source is deliberately NOT kept alongside it. A rebase (HMR
   * swapping a module's source under existing patches, or `PUT /sources/~`)
   * needs it, and this prototype does not implement rebase — holding a base
   * that nothing ever reads would read as though it did.
   */
  private sources: Record<ModuleFilePath, Json> = {};
  private appliedIds: PatchId[] = [];

  /**
   * One `EventTarget` per REGISTERED path, not per module.
   *
   * This is the registry that makes "no messages" a guarantee: a listener on a
   * path the patch did not touch is never invoked at all, so it costs nothing
   * and cannot be woken by a sibling's keystroke. The alternative — one target
   * per module with listeners filtering themselves — makes every mounted field
   * in a module run on every edit in that module.
   */
  private listenerTargets = new Map<
    SourcePath,
    { target: EventTarget; count: number }
  >();

  constructor(
    private readonly schemaStore: SchemaStore,
    private readonly readHead: ReadHead,
    private readonly activity: ActivitySink = noopActivity,
  ) {}

  /**
   * Reacts to both `patch:receive` (data arrived for an external patch) and
   * `patch:create` (a local edit). The two are handled identically except for
   * the origin reported to listeners, which is the only thing a field needs in
   * order to tell news from its own echo.
   */
  listenTo(patchStore: PatchStore): () => void {
    const offReceive = patchStore.events.on("patch:receive", (event) => {
      this.applyPatches(patchStore.recordsFor(event.patches), "external");
    });
    const offCreate = patchStore.events.on("patch:create", (event) => {
      this.applyPatches(patchStore.recordsFor(event.patches), "internal");
    });
    return () => {
      offReceive();
      offCreate();
    };
  }

  receive(sources: Record<ModuleFilePath, Json>): void {
    // Cloned so the caller cannot keep a handle on what the store now owns and
    // mutate it from outside.
    for (const [moduleFilePath, source] of Object.entries(sources)) {
      this.activity.work("source:clone-module", moduleFilePath);
      this.sources[moduleFilePath as ModuleFilePath] = deepClone(
        source as JSONValue,
      );
    }
    this.events.emit({
      type: "source:init",
      sources: Object.keys(sources) as ModuleFilePath[],
    });
  }

  /**
   * Read one path, quoting the head you believe is current.
   *
   * The handshake is what makes the read safe to do asynchronously: an answer
   * computed against a head that has since moved comes back as
   * `resolved-out-of-date` carrying the new head, so a slow reply can never
   * overwrite a newer value. Without it, a read racing a patch would silently
   * win with stale data.
   */
  async get(path: SourcePath, head: Head): Promise<SourceRead> {
    const current = this.readHead();
    if (!headsEqual(head, current)) {
      return { status: "resolved-out-of-date", head: current };
    }
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    const source = this.sources[moduleFilePath];
    // `absent` is only ever returned when we know enough to say so. Without
    // the schema we do not: a module whose schema has not loaded may resolve
    // this path once it has. Collapsing the two is the bug this split exists
    // to prevent.
    if (
      source === undefined ||
      this.schemaStore.get(moduleFilePath) === undefined
    ) {
      return { status: "module-loading" };
    }
    this.activity.work("source:read-path", path);
    const resolved = resolveAtModulePath(source, modulePath);
    if (resolved.status === "absent") {
      return { status: "absent" };
    }
    if (resolved.status === "error") {
      return { status: "error", message: resolved.message };
    }
    return { status: "resolved-head", data: resolved.value };
  }

  /**
   * The patched source for one module, for other stores in this realm.
   *
   * Deliberately NOT cloned: cloning per caller is exactly the cost this whole
   * rewrite exists to remove. In-realm callers (search, validation, patch sets)
   * only read, and they are all in this file's tree — the boundary that has to
   * be defended is the one to the main thread, and that is `get()`.
   */
  moduleSource(moduleFilePath: ModuleFilePath): Json | undefined {
    return this.sources[moduleFilePath];
  }

  loadedModules(): ModuleFilePath[] {
    return Object.keys(this.sources) as ModuleFilePath[];
  }

  /**
   * Register interest in one path. The returned function unregisters, and the
   * path's target is dropped once nobody is left on it — an unbounded registry
   * would make the intersection on every patch slower over a session.
   */
  addListener(
    path: SourcePath,
    listener: (event: FieldEvent) => void,
  ): () => void {
    let entry = this.listenerTargets.get(path);
    if (!entry) {
      entry = { target: new EventTarget(), count: 0 };
      this.listenerTargets.set(path, entry);
    }
    const registered = entry;
    const handler = (ev: Event) => {
      listener((ev as CustomEvent<FieldEvent>).detail);
    };
    registered.target.addEventListener(FIELD_EVENT, handler);
    registered.count++;
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      registered.target.removeEventListener(FIELD_EVENT, handler);
      registered.count--;
      // `EventTarget` exposes no listener count, so the store keeps its own.
      // Dropping empty entries matters: the intersection below walks every
      // registered path on every patch, so a registry that only ever grows
      // would make a long session progressively slower.
      if (
        registered.count <= 0 &&
        this.listenerTargets.get(path) === registered
      ) {
        this.listenerTargets.delete(path);
      }
    };
  }

  private applyPatches(records: PatchRecord[], origin: PatchOrigin): void {
    if (records.length === 0) return;
    const success: PatchId[] = [];
    const failed: { patchId: PatchId; message: string }[] = [];
    const touched: SourcePath[] = [];
    const changedModules = new Set<ModuleFilePath>();

    for (const record of records) {
      const current = this.sources[record.moduleFilePath];
      if (current === undefined) {
        // The module is not loaded, so there is nothing to apply the patch to
        // yet. Not a failure: `receive()` rebuilds from base + chain, so this
        // patch lands as soon as the module arrives.
        this.activity.work("source:skip-unloaded", record.moduleFilePath);
        continue;
      }
      // `file` ops carry binary data, not a document mutation — the JSON patch
      // ops cannot express them and `applyPatch` rejects them outright.
      const patchableOps = record.patch.filter((op) => op.op !== "file");
      if (patchableOps.length === 0) {
        success.push(record.patchId);
        this.appliedIds.push(record.patchId);
        continue;
      }
      // Two units of work, counted separately on purpose: the clone is
      // proportional to the MODULE and the apply is proportional to the PATCH,
      // so a redundant clone and a redundant apply are different bugs.
      this.activity.work("source:clone-module", record.moduleFilePath);
      this.activity.work("source:apply-patch", record.patchId);
      const res = applyPatch(
        deepClone(current as JSONValue),
        ops,
        patchableOps,
      );
      if (result.isOk(res)) {
        this.sources[record.moduleFilePath] = res.value;
        this.appliedIds.push(record.patchId);
        success.push(record.patchId);
        changedModules.add(record.moduleFilePath);
        touched.push(...touchedSourcePaths(record));
      } else {
        failed.push({ patchId: record.patchId, message: res.error.message });
      }
    }

    // Emitted BEFORE the field events, and the ordering is load-bearing:
    // dispatch is synchronous, so the patch store has folded this result into
    // its head by the time we read it below. Field events therefore carry the
    // head that already includes the patch that caused them.
    this.events.emit({
      type: "source:patch-apply",
      success,
      failed,
      modules: [...changedModules],
    });

    if (touched.length === 0) return;
    const head = this.readHead();
    // The scan is O(registered paths); the wakes are what the design promises
    // is O(fields actually affected). Counting both is how a test tells the
    // difference between "we looked at everything" and "we woke everything".
    this.activity.work(
      "source:scan-listeners",
      undefined,
      this.listenerTargets.size,
    );
    for (const [path, entry] of this.listenerTargets) {
      if (!touchesPath(touched, path)) continue;
      this.activity.work("source:wake-listener", path);
      const detail: FieldEvent = { type: `${origin}-patch`, path, head };
      entry.target.dispatchEvent(new CustomEvent(FIELD_EVENT, { detail }));
    }
  }
}

const FIELD_EVENT = "val:field-changed";

function headsEqual(a: Head, b: Head): boolean {
  if (a.type === "empty" || b.type === "empty") {
    return a.type === b.type;
  }
  return a.type === b.type && a.patchId === b.patchId;
}

/**
 * Which source paths a patch may have changed.
 *
 * Op paths are patch paths (`["field"]`); listeners register source paths
 * (`/test.val.ts?"field"`), so each op path is converted and qualified with the
 * module. `move`/`copy` change two places, so both ends are reported.
 */
function touchedSourcePaths(record: PatchRecord): SourcePath[] {
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
    if (op.op === "file") continue;
    add(op.path);
    if (op.op === "move" || op.op === "copy") {
      add(op.from);
    }
  }
  return paths;
}

function resolveAtModulePath(source: Json, modulePath: string): Resolved {
  const parts = Internal.splitModulePath(modulePath as never);
  let current: Json = source;
  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return { status: "absent" };
    }
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { status: "absent" };
      }
      current = current[index];
      continue;
    }
    if (!(part in current)) {
      return { status: "absent" };
    }
    current = (current as Record<string, Json>)[part];
  }
  return { status: "found", value: current };
}
