import type {
  ModuleFilePath,
  Source,
  SourcePath,
  ValidationErrors,
} from "@valbuild/core";
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
export class ValidationStore {
  readonly events = new StoreBus<SystemEvent>();

  private results = new Map<
    ModuleFilePath,
    {
      errors: ValidationErrors;
      customValidatePaths: SourcePath[];
      customValidateStatus: CustomValidateStatus;
    }
  >();
  private stale = new Set<ModuleFilePath>();
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
   * A module is stale when its source changed OR its schema changed. Both, or
   * validation silently reports errors against a schema that no longer exists —
   * which is exactly what an HMR edit to a schema file produces.
   */
  listenTo(): () => void {
    const offInit = this.sourceStore.events.on("source:init", (event) => {
      this.invalidate(event.sources);
    });
    const offApply = this.sourceStore.events.on(
      "source:patch-apply",
      (event) => {
        // `modules` lists only modules whose source actually changed, so a patch
        // that failed to apply invalidates nothing — it cannot have changed the
        // module's validity.
        this.invalidate(event.modules);
      },
    );
    const offSchema = this.schemaStore.events.on("schema:init", (event) => {
      this.invalidate(event.modules);
    });
    return () => {
      offInit();
      offApply();
      offSchema();
    };
  }

  invalidate(modules: ModuleFilePath[]): void {
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
    }
    if (hadResult.length > 0) {
      this.events.emit({ type: "validation:invalidate", modules: hadResult });
    }
  }

  async validate(moduleFilePath: ModuleFilePath): Promise<ValidationResult> {
    const cached = this.results.get(moduleFilePath);
    if (cached && !this.stale.has(moduleFilePath)) {
      this.activity.work("validation:cache-hit", moduleFilePath);
      return { status: "validated", ...cached };
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

  private async run(moduleFilePath: ModuleFilePath): Promise<ValidationResult> {
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

    const result = { errors, customValidatePaths, customValidateStatus };
    this.results.set(moduleFilePath, result);
    this.stale.delete(moduleFilePath);
    this.events.emit({
      type: "validation:result",
      moduleFilePath,
      ...result,
    });
    return { status: "validated", ...result };
  }

  /** Cached only: never triggers work, so a render path may call it freely. */
  peek(moduleFilePath: ModuleFilePath): ValidationResult {
    const cached = this.results.get(moduleFilePath);
    if (cached && !this.stale.has(moduleFilePath)) {
      return { status: "validated", ...cached };
    }
    return { status: "stale" };
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
