import {
  computeSchemaSha,
  computeSourcesSha,
  Internal,
  previewScope,
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
  HostPreviewResult,
} from "./bridges";
import type { SchemaStore } from "./SchemaStore";
import type { SourceStore } from "./SourceStore";
import { noopActivity, type ActivitySink } from "./activity";

/**
 * REALM: host. Cannot ever move to a worker.
 *
 * The only place that holds real `Schema` INSTANCES — the objects carrying the
 * user's `preview` and custom `validate` closures. Closures cannot be
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
 * 2. **Execution.** It implements {@link HostBridge}, so the preview and
 *    validation stores can have the two things done that only an instance can
 *    do, without ever holding one.
 */
/**
 * One entry of a `val.modules` registry, as intake gets it: the module, or
 * what its code threw (`loadValModules`).
 */
export type IntakeModule =
  | ValModule<SelectorSource>
  | { readonly threw: string };

/** A module intake could not read, and why. See {@link HostStore.failures}. */
export type ModuleFailure = {
  moduleFilePath: string | null;
  message: string;
  /**
   * The Studio still shows this module, as the last intake that could read
   * it had it: its code threw this time, and a module whose code is mid-edit
   * is not a module that was removed.
   */
  kept?: true;
};

/** What intake adopted at one place in the registry, to keep if it throws. */
type Adopted = {
  moduleFilePath: ModuleFilePath;
  serializedSchema: SerializedSchema;
  source: Json;
  instance: Schema<SelectorSource>;
  /** `source` when it is the bundle's own, not a served one. */
  bundleSource?: Json;
};

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
  /**
   * When intake last completed, or `null` before it ever has.
   *
   * A timestamp rather than a boolean, so a consumer can tell a re-intake (HMR,
   * a schema redeploy) from the first one — the difference matters to anything
   * that caches against it. `null` is the only value that means "not ready", and
   * every hook that gates on readiness gates on that.
   */
  initializedAt(): number | null {
    return this.receivedAt;
  }

  private receivedAt: number | null = null;

  /**
   * Modules this intake could not read, and why.
   *
   * Replaced on every `receive`, not accumulated: intake is the whole truth
   * about what the host has, so a module that failed last time and works now
   * must stop being reported. Read by the dev banner — see
   * `LocalModulesErrorBanner`.
   */
  private moduleFailures: ModuleFailure[] = [];

  failures(): readonly ModuleFailure[] {
    return this.moduleFailures;
  }

  /**
   * What the last intake adopted, by place in the registry: what a module
   * whose code throws next time is kept as. Its place is the only thing that
   * names it -- a registry entry is an `import()` and nothing else.
   */
  private adoptedAt: (Adopted | undefined)[] = [];

  receive(
    modules: IntakeModule[],
    /**
     * The Source the page serves where it is not the bundle's, by module: a
     * content version -- content published without a build -- and a
     * proposal's saves over it (`ValDraft.base`, `window.__VAL_BASE__`). It IS
     * the base, and the bundle is not: after a content-only publish the bundle
     * still holds what it was built with. Taken as given, so the base's sha is
     * the fold the server reports for the same Source and no base is fetched
     * for it; without it, the pre-publish text was the Studio's base until a
     * fetch replaced it, and reached a draft page whenever it got there first.
     */
    served?: Record<ModuleFilePath, Json>,
  ): void {
    const serializedSchemas: Record<ModuleFilePath, SerializedSchema> = {};
    const sources: Record<ModuleFilePath, Json> = {};
    const adopted: ModuleFilePath[] = [];
    const failures: ModuleFailure[] = [];
    const adoptedAt: (Adopted | undefined)[] = [];

    for (const [index, module] of modules.entries()) {
      /**
       * Code that throws -- a module mid-edit -- keeps the module it was.
       *
       * Dropped, as it used to be, the module silently left the Studio, and
       * came back only when the code was fixed. Kept, the editor goes on
       * seeing it on the schema it last had, and is told why it did not move.
       */
      if ("threw" in module) {
        const kept = this.adoptedAt[index];
        if (
          kept === undefined ||
          serializedSchemas[kept.moduleFilePath] !== undefined
        ) {
          failures.push({
            moduleFilePath: null,
            message: `Module number ${index + 1} in val.modules could not be loaded: ${module.threw}`,
          });
          continue;
        }
        serializedSchemas[kept.moduleFilePath] = kept.serializedSchema;
        sources[kept.moduleFilePath] = kept.source;
        this.instances[kept.moduleFilePath] = kept.instance;
        adopted.push(kept.moduleFilePath);
        adoptedAt[index] = kept;
        failures.push({
          moduleFilePath: kept.moduleFilePath,
          message: module.threw,
          kept: true,
        });
        continue;
      }
      /**
       * One bad module must not take the rest of the project down.
       *
       * This used to throw, which meant a single module with a schema that
       * cannot serialize — a real thing during an HMR edit — lost every module
       * AFTER it in the list as well, and the Studio came up with a partial
       * project and no explanation. Recording and continuing is what makes the
       * dev banner able to name the module instead.
       */
      try {
        const path = Internal.getValPath(module);
        if (path === undefined) {
          failures.push({
            moduleFilePath: null,
            message: "Module has no path",
          });
          continue;
        }
        const moduleFilePath = path as string as ModuleFilePath;
        const schema = Internal.getSchema(module);
        if (schema === undefined) {
          failures.push({
            moduleFilePath,
            message: "Module has no schema",
          });
          continue;
        }
        /**
         * The same module as last time -- the very instance, which is what an
         * HMR round leaves every file it did not re-evaluate -- hands over the
         * very objects it handed over last time. That is how the stores
         * downstream tell a module that changed from one that came along with
         * it: `SchemaStore.receive` and `SourceStore.receive` compare what
         * they are given with what they were given, and only a changed module
         * invalidates anything. It is the instance and not a comparison of the
         * serialized form because an instance carries closures (`validate`,
         * `preview`) that the serialized form does not: a module whose only
         * change is its `validate` must still be validated again.
         */
        const previous = this.adoptedAt[index];
        const same =
          previous !== undefined &&
          previous.moduleFilePath === moduleFilePath &&
          previous.instance === schema
            ? previous
            : undefined;
        // Bracket access, never `instanceof Schema`: this object came from the
        // HOST's copy of @valbuild/core, so the class identity differs from ours.
        // See the bundle-seam note in `bridges.ts`.
        if (same !== undefined) {
          serializedSchemas[moduleFilePath] = same.serializedSchema;
        } else {
          this.activity.work("host:serialize-schema", moduleFilePath);
          serializedSchemas[moduleFilePath] = schema["executeSerialize"]();
        }
        // JSON round-trip so what crosses is provably clone-safe — no instance
        // can leak downstream by being reachable from a source value.
        const servedSource = served?.[moduleFilePath];
        const bundleSource =
          servedSource !== undefined
            ? undefined
            : (same?.bundleSource ??
              (JSON.parse(JSON.stringify(Internal.getSource(module))) as Json));
        sources[moduleFilePath] = servedSource ?? bundleSource ?? null;
        this.instances[moduleFilePath] = schema;
        adopted.push(moduleFilePath);
        adoptedAt[index] = {
          moduleFilePath,
          serializedSchema: serializedSchemas[moduleFilePath],
          source: sources[moduleFilePath],
          instance: schema,
          ...(bundleSource !== undefined ? { bundleSource } : {}),
        };
      } catch (error) {
        failures.push({
          moduleFilePath: (Internal.getValPath(module) as string) ?? null,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    /*
     * And a module that could not be SERIALIZED this time keeps what it was,
     * for the same reason a module whose code throws does: it is mid-edit, not
     * removed. Before intake replaced the schemas, the merge kept it.
     */
    for (const failure of failures) {
      if (failure.moduleFilePath === null || failure.kept) continue;
      const index = this.adoptedAt.findIndex(
        (previous) => previous?.moduleFilePath === failure.moduleFilePath,
      );
      const kept = this.adoptedAt[index];
      if (kept === undefined) continue;
      const moduleFilePath = kept.moduleFilePath;
      if (serializedSchemas[moduleFilePath] !== undefined) continue;
      serializedSchemas[moduleFilePath] = kept.serializedSchema;
      sources[moduleFilePath] = kept.source;
      this.instances[moduleFilePath] = kept.instance;
      adopted.push(moduleFilePath);
      adoptedAt[index] ??= kept;
      failure.kept = true;
    }
    this.moduleFailures = failures;
    this.adoptedAt = adoptedAt;

    // BEFORE the announcement. Dispatch is synchronous, so a consumer woken by
    // `host:receive` reads this in the same turn — and it has to see the intake it
    // was just told about, not the one before it. Setting it after would make the
    // first `host:receive` of a session arrive with `initializedAt` still null,
    // which is exactly the state every readiness gate treats as "not ready".
    this.receivedAt = Date.now();
    this.events.emit({ type: "host:receive", modules: adopted });
    // Schemas before source: `SourceStore.get` refuses to answer `absent` for a
    // module whose schema is unknown, so the other order would make the first
    // read after intake say `module-loading`.
    // A module the last intake had and this one does not was removed from
    // `val.modules`: it goes, with its source (and, through `schema:init`,
    // its validation and previews). It used to stay until a reload.
    const removed = (Object.keys(this.instances) as ModuleFilePath[]).filter(
      (moduleFilePath) => serializedSchemas[moduleFilePath] === undefined,
    );
    for (const moduleFilePath of removed) {
      delete this.instances[moduleFilePath];
    }
    this.schemaStore.receive(serializedSchemas);
    this.sourceStore.forget(removed);
    this.sourceStore.receive(sources);
    this.bundle = {
      sourcesSha: computeSourcesSha(
        adopted.map((path) => ({ path, source: sources[path] })),
      ),
      sources,
    };
    // Recomputed on every intake, an HMR re-run included: it is the schema
    // this page is RUNNING, which is what `SchemaFreshnessWatch` compares.
    this.runningSchemaSha = computeSchemaSha(
      adopted.map((path) => ({
        path,
        serializedSchema: serializedSchemas[path],
      })),
    );
    // After the source store has the bundle's source, so a listener that puts
    // another build's base back on top (`BaseAlignment`) has the last word.
    this.events.emit({
      type: "host:base-received",
      sourcesSha: this.bundle.sourcesSha,
    });
  }

  /**
   * The source this intake brought, and its `sourcesSha`.
   *
   * The same fold the server runs over ITS build's modules, so the two can be
   * compared: a `/stat` answer is relative to the build that answered it, and
   * this is how the Studio knows whether that build is the one whose source it
   * holds. Hashed over the JSON round-tripped source, which stringifies the same
   * as the module's own.
   */
  bundleBase(): {
    sourcesSha: string;
    sources: Record<ModuleFilePath, Json>;
  } | null {
    return this.bundle;
  }

  private bundle: {
    sourcesSha: string;
    sources: Record<ModuleFilePath, Json>;
  } | null = null;

  /**
   * The `schemaSha` of the schemas this page is running, or `null` before
   * intake.
   *
   * The same fold the server runs over its build's modules (`computeSchemaSha`),
   * over the same modules in the same order — the ones that serialized, in
   * `val.modules` order — so a `/stat` from a build with another schema says so
   * by not being equal to this.
   */
  schemaSha(): string | null {
    return this.runningSchemaSha;
  }

  private runningSchemaSha: string | null = null;

  async preview(
    moduleFilePath: ModuleFilePath,
    only?: readonly SourcePath[],
  ): Promise<HostPreviewResult> {
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
      this.activity.work("host:execute-preview", moduleFilePath);
      // An empty `only` is not "nothing": a caller with no paths to name wants
      // the module, which is what every caller before scoping got. Only a
      // non-empty list narrows anything.
      const scope =
        only !== undefined && only.length > 0
          ? previewScope([...only])
          : undefined;
      return {
        status: "previewed",
        preview: instance["executePreview"](
          moduleFilePath,
          source as SelectorSource,
          scope,
        ),
      };
    } catch (error) {
      // A preview is decoration. A schema whose preview throws must not take
      // the module's fields down with it.
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Would this module still be valid if it looked like THIS?
   *
   * Speculative: the source is supplied rather than read, so nothing is applied
   * to the store and nothing has to be undone if the answer is "no". That is
   * what the AI flow needs — it proposes a patch, and a proposal that would
   * break the module has to be rejected before it becomes an edit the user has
   * to notice and discard.
   *
   * Uses the real instance, so the user's own `validate` closures run. A patch
   * that only violates a custom rule is caught here and nowhere else: the
   * serialized schema the worker validates against has no user functions in it.
   */
  validateSpeculative(
    moduleFilePath: ModuleFilePath,
    source: Json,
  ):
    | { status: "validated"; errors: ValidationErrors }
    | { status: "unknown-module" } {
    const instance = this.instances[moduleFilePath];
    if (!instance) {
      return { status: "unknown-module" };
    }
    this.activity.work("host:execute-validate", moduleFilePath);
    return {
      status: "validated",
      errors: instance["executeValidate"](
        moduleFilePath as string as SourcePath,
        source as SelectorSource,
      ),
    };
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

  /** For a preview/validation store deciding whether asking is worth it. */
  has(moduleFilePath: ModuleFilePath): boolean {
    return this.instances[moduleFilePath] !== undefined;
  }

  /** Unused by the stores; here so a test can assert intake without guessing. */
  loadedModules(): ModuleFilePath[] {
    return Object.keys(this.instances) as ModuleFilePath[];
  }
}
