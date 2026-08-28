import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import { noopActivity, type ActivitySink } from "./activity";

/**
 * Owns the serialized schemas.
 *
 * Split out from the source store on purpose, even though the two arrive
 * together today: schemas have their own change sources (`GET /schema`, and HMR
 * swapping a module's schema under existing source) and their own consumers
 * (validation, references). Making that a store with its own event now means
 * adding those inputs later does not move any event.
 *
 * SERIALIZED schemas, never `Schema` instances. Instances carry the user's
 * `select` and custom `validate` closures, which cannot be structured-cloned,
 * so a store holding them could never move into a worker. Serializing at the
 * edge (`System.receiveModules`) keeps that door open.
 */
export class SchemaStore {
  readonly events = new StoreBus<SystemEvent>();

  private schemas: Record<ModuleFilePath, SerializedSchema> = {};
  private versions = new Map<ModuleFilePath, number>();
  /**
   * Whether each module's schema declares a preview anywhere, by version.
   *
   * Cached against the version rather than recomputed, and answered from the
   * SCHEMA rather than from a preview that came back empty — the difference
   * matters at mount, when nothing has been previewed yet. See
   * {@link SchemaStore.declaresPreview}.
   */
  private previewDeclared = new Map<
    ModuleFilePath,
    { version: number; declared: boolean }
  >();

  constructor(private readonly activity: ActivitySink = noopActivity) {}

  receive(schemas: Record<ModuleFilePath, SerializedSchema>): void {
    this.activity.work(
      "schema:receive",
      undefined,
      Object.keys(schemas).length,
    );
    this.schemas = { ...this.schemas, ...schemas };
    for (const moduleFilePath of Object.keys(schemas) as ModuleFilePath[]) {
      this.versions.set(
        moduleFilePath,
        (this.versions.get(moduleFilePath) ?? 0) + 1,
      );
    }
    this.events.emit({
      type: "schema:init",
      modules: Object.keys(schemas) as ModuleFilePath[],
    });
  }

  /** Synchronous: same realm as every caller. See {@link StoreBus}. */
  get(moduleFilePath: ModuleFilePath): SerializedSchema | undefined {
    return this.schemas[moduleFilePath];
  }

  all(): Record<ModuleFilePath, SerializedSchema> {
    return this.schemas;
  }

  /**
   * Bumped every time a module's schema is received. Stands in for the
   * `schemaSha` that `SchemaValidator` caches on: the only question either
   * answers is "is my deserialized schema still the right one", and a counter
   * answers it without hashing. It is per-session only, which is all a cache
   * key has to be.
   */
  version(moduleFilePath: ModuleFilePath): number {
    return this.versions.get(moduleFilePath) ?? 0;
  }

  /**
   * Can this module produce a preview at all?
   *
   * The preview itself needs the host — it is a user closure — but whether one
   * is DECLARED is in the serialized schema, and asking here first is what stops
   * the preview store crossing the host seam for a module that can only answer
   * "nothing".
   *
   * This is not a micro-optimisation: browser measurement showed mounting 260
   * fields across 141 modules spending ~2.3ms of 3.1ms inside `executePreview`
   * on modules that returned an empty result. In a real project most modules
   * declare no preview, so most of that work was provably wasted.
   *
   * `false` for a module whose schema has not arrived — there is nothing to
   * preview yet either way, and the store's `module-loading`/absent handling
   * covers it.
   *
   * VERSION SKEW: this trusts the `preview` marker to be present whenever a
   * preview is declared. It is set by `executeSerialize` on a real instance, so
   * it is there for schemas from local modules AND from `GET /schema` (the
   * server serializes from instances too). A server old enough to predate the
   * marker would serve schemas without it, and previews would then silently stop
   * appearing rather than fail — which is why Val's existing schema-skew check
   * (`schema-out-of-date`) is the thing that has to catch that, not this.
   */
  declaresPreview(moduleFilePath: ModuleFilePath): boolean {
    const version = this.version(moduleFilePath);
    const cached = this.previewDeclared.get(moduleFilePath);
    if (cached !== undefined && cached.version === version) {
      return cached.declared;
    }
    const schema = this.schemas[moduleFilePath];
    const declared = schema === undefined ? false : declaresPreview(schema);
    this.previewDeclared.set(moduleFilePath, { version, declared });
    return declared;
  }
}

/**
 * Does this schema, or anything under it, declare a preview?
 *
 * Only two schemas can: `array` and `record`, the containers that have items to
 * preview. Every other node is pure recursion, which is why the walk only has to
 * look for the `preview` marker and descend.
 *
 * There is deliberately NO `string` arm. `s.string().render({as:"textarea"})` is
 * a render, not a preview: static config that travels WITH the serialized schema
 * and is read where the field is drawn, so a module whose only such declaration
 * is a string layout must never be sent to the host. Restoring an arm here would
 * put that whole-module walk back for a fact the schema already carried. See
 * `core/src/render.ts`.
 *
 * `seen` guards a schema that refers to itself structurally, so this cannot
 * recurse forever — the same guard `collectReferences` and
 * `jsonValuesLoadRequirements` use.
 */
function declaresPreview(
  schema: SerializedSchema,
  seen: Set<SerializedSchema> = new Set(),
): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  switch (schema.type) {
    case "array":
      return schema.preview === true || declaresPreview(schema.item, seen);
    case "record":
      return schema.preview === true || declaresPreview(schema.item, seen);
    case "object":
      return Object.values(schema.items).some((item) =>
        declaresPreview(item, seen),
      );
    case "union":
      return schema.items.some((item) => declaresPreview(item, seen));
    default:
      return false;
  }
}
