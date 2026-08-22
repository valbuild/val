import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";

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

  receive(schemas: Record<ModuleFilePath, SerializedSchema>): void {
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
}
