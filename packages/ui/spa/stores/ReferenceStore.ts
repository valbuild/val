import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
} from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import { noopActivity, type ActivitySink } from "./activity";
import { sourcePathOfChild } from "../utils/sourcePath";

/**
 * The three kinds of pointer in a Val project.
 *
 * `target` is the module a referrer names. It is `null` for `route`, and that
 * asymmetry is real rather than an omission: `SerializedRouteSchema` carries
 * include/exclude patterns and NOT the router it points into, so a route
 * reference can only be matched by comparing the field's string VALUE. The app's
 * `getRouteReferences` already works this way; naming it here keeps a caller from
 * assuming a target it cannot have.
 */
export type ReferenceKind = "keyOf" | "file" | "route";

/** One pointer found in the source tree. The unit the index is made of. */
export type Reference = {
  kind: ReferenceKind;
  /** The module this referrer names, or `null` for `route`. */
  target: ModuleFilePath | null;
  /**
   * What it points at within that module: a record key for `keyOf`, a file ref
   * for `file`, a route string for `route`. `null` when the field is empty.
   */
  value: string | null;
};

/**
 * A question about who points at something.
 *
 * `value` narrows it, and narrowing is what a DELETE actually asks: not "does
 * anything point at this record" but "does anything point at this key of it".
 * Without it, deleting one unused key is blocked by another key being used.
 */
export type ReferenceQuery =
  | { kind: "keyOf"; module: ModuleFilePath; value?: string }
  | { kind: "file"; module: ModuleFilePath; value?: string }
  | { kind: "route"; value?: string };

/**
 * What a scan found, and whether that is all of it.
 *
 * `partial` is the reason this is a union rather than an array. The answers gate
 * destructive actions — "delete this key", "rename this route" — and those are
 * only safe on an EXHAUSTIVE referrer list. A walk over a `.jsonValues()` record
 * whose entry content has not been fetched cannot be exhaustive: the referrer may
 * be inside an entry the walk saw as an opaque marker. An empty array would then
 * read as "safe to delete" and be wrong.
 *
 * `refs` is populated in both states, because a reference that IS found is real,
 * and hiding it until everything is loaded shows "no references" for a record
 * that visibly has them.
 */
export type ReferenceScan =
  | { status: "complete"; refs: SourcePath[] }
  | { status: "partial"; refs: SourcePath[]; awaiting: ModuleFilePath[] };

/** What has to be cloned across the worker seam to scan. */
export type ReferenceSnapshot = Record<
  ModuleFilePath,
  {
    source: Json;
    schema: SerializedSchema;
    /**
     * Is this source everything the module has? `false` for a `.jsonValues()`
     * module with entry content still unfetched. Travels IN the snapshot because
     * this store cannot ask — see {@link ReferenceStore}.
     */
    complete: boolean;
  }
>;

/**
 * REALM: worker.
 *
 * Holds no reference to any other store, for the same reason `SearchStore` does
 * not: the scan needs only serialized schemas and JSON source, so it belongs on
 * the far side of the thread boundary, and a store reference there would be a
 * pointer into another realm.
 *
 * ## One index, three questions
 *
 * The app asks three questions today, each with its own whole-project walk from
 * its own React hook: `getKeysOf`, `getReferencedFiles`, `getRouteReferences`.
 * Every one of them re-walks every leaf of every module, on every render of the
 * component that asks.
 *
 * They are the same walk. A referrer is a LEAF fact — this path, this kind, this
 * target, this value — so one index over those facts answers all three, and a
 * narrower question (one key, one file ref) is a FILTER rather than another walk.
 *
 * ## Indexed per module, like the search index
 *
 * `byModule` keeps which references came from which module, so a module can be
 * re-scanned in isolation. A keystroke marks its module stale and computes
 * nothing; the next query re-walks that one module. The old scans re-walked the
 * project for a change to one string.
 *
 * **Staleness is tracked on the HOST**, not here — see `StaleModules` in
 * `createSystem.ts`. Same reason as the search store: the host is the side that
 * saw the change, so keeping the set here meant pushing it in and reading it
 * back, which across a thread boundary is messages for something already known.
 * Every method here is `async` for the same reason: a read across a seam is a
 * message, so a synchronous signature cannot be crossed at all.
 *
 * ## Completeness is the store's job
 *
 * Only something that knows what is loaded can say whether a scan is exhaustive,
 * and a caller that gates a delete on `refs.length` rather than on the status has
 * a data-loss bug. So the status is not optional metadata — it is the answer, and
 * `refs` is the detail.
 */
export class ReferenceStore {
  readonly events = new StoreBus<SystemEvent>();

  private byModule = new Map<ModuleFilePath, Map<SourcePath, Reference>>();
  /**
   * Modules scanned from source that was not all of it, and the referrer kinds
   * each could still be hiding.
   *
   * Per KIND, not a bare flag, and that is what keeps the gate usable: a
   * `.jsonValues()` record of `{ body: s.string() }` cannot hide a `keyOf` no
   * matter how much of it is unloaded, so a delete must not wait for it. Only a
   * record whose item schema actually contains a referrer of the asked-for kind
   * blocks the answer. Same reasoning as `jsonValuesLoadRequirements`, decided
   * from the schema alone.
   */
  private incomplete = new Map<ModuleFilePath, Set<ReferenceKind>>();

  constructor(private readonly activity: ActivitySink = noopActivity) {}

  /**
   * Drop a module entirely, for one that has gone away rather than changed.
   *
   * Async for the same reason `find` is: it is a message.
   */
  async forget(moduleFilePath: ModuleFilePath): Promise<void> {
    this.byModule.delete(moduleFilePath);
    this.incomplete.delete(moduleFilePath);
  }

  /**
   * Walk the modules in `snapshot`, replacing their slice of the index and
   * leaving every other module's alone.
   *
   * Replacing rather than merging is load-bearing: a referrer that has been
   * edited away has to DISAPPEAR. A stale referrer is the dangerous direction —
   * it blocks a delete that is in fact safe, and the user has no way to see why.
   */
  async rescan(snapshot: ReferenceSnapshot): Promise<ModuleFilePath[]> {
    const target = Object.keys(snapshot) as ModuleFilePath[];
    for (const moduleFilePath of target) {
      this.activity.work("references:scan-module", moduleFilePath);
      const entry = snapshot[moduleFilePath];
      const found = new Map<SourcePath, Reference>();
      collectReferences(
        moduleFilePath as string as SourcePath,
        entry.schema,
        entry.source as Source,
        found,
      );
      this.byModule.set(moduleFilePath, found);
      if (entry.complete) {
        this.incomplete.delete(moduleFilePath);
      } else {
        // What this module could still be HIDING, from its schema — not from
        // what happened to be loaded. A schema answers the question completely.
        this.incomplete.set(moduleFilePath, hiddenKinds(entry.schema));
      }
    }
    this.events.emit({ type: "references:scan", modules: target });
    return target;
  }

  /**
   * Answer `query` from the index. Walks nothing.
   *
   * Async despite computing synchronously, and that is the point: this store is
   * worker-realm, and across a thread boundary a read IS a message. A synchronous
   * signature here is not merely slow to cross — it cannot be crossed, and it
   * would silently stop working the moment the store really moved. Same reasoning
   * as `SchemaValidationBridge`.
   */
  async find(query: ReferenceQuery): Promise<ReferenceScan> {
    this.activity.work("references:query", query.kind);
    const refs: SourcePath[] = [];
    for (const found of this.byModule.values()) {
      for (const [path, reference] of found) {
        if (!matches(reference, query)) continue;
        refs.push(path);
      }
    }
    const awaiting: ModuleFilePath[] = [];
    for (const [moduleFilePath, kinds] of this.incomplete) {
      if (kinds.has(query.kind)) {
        awaiting.push(moduleFilePath);
      }
    }
    if (awaiting.length > 0) {
      return { status: "partial", refs, awaiting };
    }
    return { status: "complete", refs };
  }

  /**
   * What the field at one path points at, or `null`.
   *
   * The same fact read the other way round, which is why it is here rather than
   * being its own walk: `KeyOfField` and the validation fixes need "what does
   * THIS field reference", and computing that separately would be a second index
   * of the same thing.
   */
  async at(path: SourcePath): Promise<Reference | null> {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    return this.byModule.get(moduleFilePath)?.get(path) ?? null;
  }
}

function matches(reference: Reference, query: ReferenceQuery): boolean {
  if (reference.kind !== query.kind) return false;
  // `route` has no target to match on — see `ReferenceKind`.
  if (query.kind !== "route" && reference.target !== query.module) return false;
  if (query.value !== undefined && reference.value !== query.value) {
    return false;
  }
  return true;
}

/**
 * Which referrer kinds a schema can contain.
 *
 * Asked of a `.jsonValues()` record's ITEM schema to decide what unloaded content
 * could be hiding. Answered from the schema, so it is exact and costs nothing —
 * as opposed to guessing from the loaded entries, which cannot say anything about
 * the ones that are not there.
 */
function hiddenKinds(schema: SerializedSchema | undefined): Set<ReferenceKind> {
  const kinds = new Set<ReferenceKind>();
  const seen = new Set<SerializedSchema>();
  const go = (at: SerializedSchema | undefined): void => {
    if (at === undefined || seen.has(at)) return;
    seen.add(at);
    switch (at.type) {
      case "keyOf":
        kinds.add("keyOf");
        return;
      case "image":
      case "file":
        kinds.add("file");
        return;
      case "route":
        kinds.add("route");
        return;
      case "object":
        for (const item of Object.values(at.items)) go(item);
        return;
      case "array":
      case "record":
        go(at.item);
        return;
      case "union":
        for (const item of at.items) go(item);
        return;
      default:
        return;
    }
  };
  // Only the ITEM matters: `.jsonValues()` is root-only, so the record's own key
  // set is always known and only what is INSIDE an entry can be missing.
  if (schema?.type === "record") {
    go(schema.item);
  } else {
    go(schema);
  }
  return kinds;
}

/**
 * Walk one module, recording every referrer leaf.
 *
 * Deliberately its own walk rather than `traverseSchemas`: that one visits every
 * leaf and `console.error`s on a schema/source mismatch, which for a store that
 * runs on every query would be noise. This one only descends where a referrer
 * could be and says nothing about what it skips.
 */
function collectReferences(
  path: SourcePath,
  schema: SerializedSchema | undefined,
  source: Source,
  into: Map<SourcePath, Reference>,
): void {
  if (schema === undefined) return;
  // An unloaded `.jsonValues()` entry is an opaque marker. Skipping it is what
  // makes the scan PARTIAL — recorded per module by the caller, not guessed at
  // here, because this walk cannot tell "no referrer" from "cannot see".
  if (Internal.isJson(source)) return;
  switch (schema.type) {
    case "keyOf":
      into.set(path, {
        kind: "keyOf",
        // `keyOf.path` is the referenced record's path; for a module-level
        // record that IS the module file path, which is the comparison
        // `getKeysOf` makes too.
        target: schema.path as string as ModuleFilePath,
        value: typeof source === "string" ? source : null,
      });
      return;
    case "image":
    case "file": {
      if (schema.referencedModule === undefined) return;
      into.set(path, {
        kind: "file",
        target: schema.referencedModule as ModuleFilePath,
        value: fileRefOf(source),
      });
      return;
    }
    case "route":
      into.set(path, {
        kind: "route",
        target: null,
        value: typeof source === "string" ? source : null,
      });
      return;
    case "object": {
      if (!isRecordSource(source)) return;
      for (const key in schema.items) {
        const value = source[key];
        if (value === undefined) continue;
        collectReferences(
          sourcePathOfChild(path, key),
          schema.items[key],
          value,
          into,
        );
      }
      return;
    }
    case "record": {
      if (!isRecordSource(source)) return;
      for (const key in source) {
        collectReferences(
          sourcePathOfChild(path, key),
          schema.item,
          source[key],
          into,
        );
      }
      return;
    }
    case "array": {
      if (!Array.isArray(source)) return;
      for (let index = 0; index < source.length; index++) {
        // The NUMBER, not its string form: a module path segment is
        // `JSON.stringify`d, so a stringified index becomes `?p="0"` where every
        // other part of the system writes `?p=0`. The paths still look right and
        // nothing that navigates to one can resolve it.
        collectReferences(
          sourcePathOfChild(path, index),
          schema.item,
          source[index],
          into,
        );
      }
      return;
    }
    case "union": {
      // The variant is not resolved here: a union's variants are structurally
      // distinct, so a key that exists in the source belongs to at most one of
      // them, and walking all of them finds it without needing the discriminant.
      // Over-walking a union costs a few misses; resolving it wrongly loses a
      // referrer.
      for (const item of schema.items) {
        collectReferences(path, item, source, into);
      }
      return;
    }
    default:
      return;
  }
}

function fileRefOf(source: Source): string | null {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }
  const ref = (source as Record<string, unknown>).path;
  return typeof ref === "string" ? ref : null;
}

function isRecordSource(source: Source): source is Record<string, Source> {
  return (
    typeof source === "object" && source !== null && !Array.isArray(source)
  );
}
