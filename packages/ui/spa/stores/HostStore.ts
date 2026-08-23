import {
  Internal,
  renderScope,
  type Json,
  type ModuleFilePath,
  type Schema,
  type SelectorSource,
  type SerializedSchema,
  type SourcePath,
  type ValModule,
  type ValidationErrors,
} from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import type {
  HostBridge,
  HostCustomValidateResult,
  HostRenderResult,
} from "./bridges";
import type { SchemaStore } from "./SchemaStore";
import type { SourceStore } from "./SourceStore";
import { noopActivity, type ActivitySink } from "./activity";

/**
 * REALM: host. Cannot ever move to a worker.
 *
 * The only place that holds real `Schema` INSTANCES — the objects carrying the
 * user's `select`, `render` and custom `validate` closures. Closures cannot be
 * structured-cloned, so this store defines the edge of what can be threaded, and
 * everything that needs to execute one has to be on this side of it.
 *
 * Two jobs:
 *
 * 1. **Intake.** It is the entry point for modules, mirroring `setValModules` in
 *    the real app: the host app imports its own `val.modules` and hands the
 *    instances in. This store keeps the instances and pushes only the
 *    SERIALIZED halves — serialized schema, JSON source — into the other
 *    stores. Nothing downstream can accidentally hold a closure.
 *
 * 2. **Execution.** It implements {@link HostBridge}, so the render and
 *    validation stores can have the two things done that only an instance can
 *    do, without ever holding one.
 */
export class HostStore implements HostBridge {
  readonly events = new StoreBus<SystemEvent>();

  /**
   * The instances. Never leave this store, never cross a bridge, never get
   * serialized into an event.
   */
  private instances: Record<ModuleFilePath, Schema<SelectorSource>> = {};

  constructor(
    private readonly schemaStore: SchemaStore,
    private readonly sourceStore: SourceStore,
    private readonly activity: ActivitySink = noopActivity,
  ) {}

  /**
   * Adopt modules from the host app.
   *
   * Re-callable: HMR re-runs this with new instances for the same paths. What is
   * NOT yet handled is rebase — swapping base source under existing patches —
   * which is listed as a known gap in `architecture.md`.
   */
  receive(modules: ValModule<SelectorSource>[]): void {
    const serializedSchemas: Record<ModuleFilePath, SerializedSchema> = {};
    const sources: Record<ModuleFilePath, Json> = {};
    const adopted: ModuleFilePath[] = [];

    for (const module of modules) {
      const path = Internal.getValPath(module);
      if (path === undefined) {
        throw new Error("Module has no path");
      }
      const moduleFilePath = path as string as ModuleFilePath;
      const schema = Internal.getSchema(module);
      if (schema === undefined) {
        throw new Error(`Module '${moduleFilePath}' has no schema`);
      }
      // Bracket access, never `instanceof Schema`: this object came from the
      // HOST's copy of @valbuild/core, so the class identity differs from ours.
      // See the bundle-seam note in `bridges.ts`.
      this.activity.work("host:serialize-schema", moduleFilePath);
      serializedSchemas[moduleFilePath] = schema["executeSerialize"]();
      // JSON round-trip so what crosses is provably clone-safe — no instance
      // can leak downstream by being reachable from a source value.
      sources[moduleFilePath] = JSON.parse(
        JSON.stringify(Internal.getSource(module)),
      ) as Json;
      this.instances[moduleFilePath] = schema;
      adopted.push(moduleFilePath);
    }

    this.events.emit({ type: "host:receive", modules: adopted });
    // Schemas before source: `SourceStore.get` refuses to answer `absent` for a
    // module whose schema is unknown, so the other order would make the first
    // read after intake say `module-loading`.
    this.schemaStore.receive(serializedSchemas);
    this.sourceStore.receive(sources);
  }

  async render(
    moduleFilePath: ModuleFilePath,
    only?: readonly SourcePath[],
  ): Promise<HostRenderResult> {
    const instance = this.instances[moduleFilePath];
    if (!instance) {
      return { status: "unknown-module" };
    }
    // Read, do not receive: the source store is in this realm, so this is a
    // pointer, not a 129 KB copy. That is the reason source lives here.
    const source = this.sourceStore.moduleSource(moduleFilePath);
    if (source === undefined) {
      return { status: "unknown-module" };
    }
    try {
      this.activity.work("host:execute-render", moduleFilePath);
      // An empty `only` is not "nothing": a caller with no paths to name wants
      // the module, which is what every caller before scoping got. Only a
      // non-empty list narrows anything.
      const scope =
        only !== undefined && only.length > 0
          ? renderScope([...only])
          : undefined;
      return {
        status: "rendered",
        render: instance["executeRender"](
          moduleFilePath,
          source as SelectorSource,
          scope,
        ),
      };
    } catch (error) {
      // A render is decoration. A schema whose render throws must not take the
      // module's fields down with it — same rule as `computeRender` today.
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Run the module's custom validators.
   *
   * `paths` comes from the validation store, which walked the SERIALIZED schema
   * to find where validators are declared. This side could not have found them:
   * a deserialized schema has no user functions in it, so it cannot report that
   * it skipped any. The store finds the places; the instance does the work.
   */
  async customValidate(
    moduleFilePath: ModuleFilePath,
    paths: SourcePath[],
  ): Promise<HostCustomValidateResult> {
    const instance = this.instances[moduleFilePath];
    if (!instance) {
      return { status: "unknown-module" };
    }
    const source = this.sourceStore.moduleSource(moduleFilePath);
    if (source === undefined) {
      return { status: "unknown-module" };
    }
    if (paths.length === 0) {
      return { status: "validated", errors: false };
    }
    try {
      // `executeValidate` on the real instance runs both schema and custom
      // checks. The schema half is already known (the worker computed it), so
      // the caller merges and de-duplicates — see `ValidationStore`.
      this.activity.work("host:execute-validate", moduleFilePath);
      const errors: ValidationErrors = instance["executeValidate"](
        moduleFilePath as string as SourcePath,
        source as SelectorSource,
      );
      return { status: "validated", errors };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** For a render/validation store deciding whether asking is worth it. */
  has(moduleFilePath: ModuleFilePath): boolean {
    return this.instances[moduleFilePath] !== undefined;
  }

  /** Unused by the stores; here so a test can assert intake without guessing. */
  loadedModules(): ModuleFilePath[] {
    return Object.keys(this.instances) as ModuleFilePath[];
  }
}
