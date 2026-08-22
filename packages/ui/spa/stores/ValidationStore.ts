import type {
  ModuleFilePath,
  Source,
  SourcePath,
  ValidationErrors,
} from "@valbuild/core";
import { SchemaValidator } from "../validation/validateModule";
import { collectCustomValidateTargets } from "../validation/customValidate";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import type { SchemaStore } from "./SchemaStore";
import type { SourceStore } from "./SourceStore";

export type ValidationResult =
  | { status: "stale" }
  | { status: "unknown-module" }
  | {
      status: "validated";
      errors: ValidationErrors;
      /** Nodes whose custom validators still have to be run elsewhere. */
      customValidatePaths: SourcePath[];
    };

/**
 * Owns validation errors.
 *
 * ## Lazy, not eager — this is the whole point of the store
 *
 * Today a keystroke posts a validation request per module, per keystroke. This
 * store does the opposite: a patch marks the module STALE and says so, and
 * nothing is computed until someone asks. Typing 40 characters into a field
 * costs 40 `validation:invalidate` events (a set insert each) and zero
 * validations; the one validation happens when the errors are next read.
 *
 * ## No worker of its own
 *
 * `ValidationWorkerClient` exists today because the main thread cannot afford to
 * validate. In this architecture the stores already sit off the main thread as a
 * set (see `architecture.md`), so validating here is already off the main
 * thread — and the schema and source it needs are in this realm, so it costs no
 * structured clone. A second worker would add a copy of every module per
 * validation to buy nothing.
 */
export class ValidationStore {
  readonly events = new StoreBus<SystemEvent>();

  private validator = new SchemaValidator();
  private results = new Map<
    ModuleFilePath,
    { errors: ValidationErrors; customValidatePaths: SourcePath[] }
  >();
  private stale = new Set<ModuleFilePath>();

  constructor(
    private readonly schemaStore: SchemaStore,
    private readonly sourceStore: SourceStore,
  ) {}

  /**
   * A module is stale when its source changed OR its schema changed. Both, or
   * validation silently reports errors against a schema that no longer exists —
   * which is what an HMR edit to a schema file produces.
   */
  listenTo(): () => void {
    const offInit = this.sourceStore.events.on("source:init", (event) => {
      this.invalidate(event.sources);
    });
    const offApply = this.sourceStore.events.on(
      "source:patch-apply",
      (event) => {
        // `modules` lists only the modules whose source actually changed, so a
        // patch that failed to apply invalidates nothing — it cannot have
        // changed the module's validity.
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
    for (const moduleFilePath of modules) {
      this.stale.add(moduleFilePath);
      this.results.delete(moduleFilePath);
    }
    this.events.emit({ type: "validation:invalidate", modules });
  }

  /**
   * Validate on demand, returning the cached result when the module is not
   * stale. The read is what triggers the work — nothing above computes ahead of
   * a reader.
   */
  async validate(moduleFilePath: ModuleFilePath): Promise<ValidationResult> {
    const cached = this.results.get(moduleFilePath);
    if (cached && !this.stale.has(moduleFilePath)) {
      return { status: "validated", ...cached };
    }
    const serializedSchema = this.schemaStore.get(moduleFilePath);
    const source = this.sourceStore.moduleSource(moduleFilePath);
    if (serializedSchema === undefined || source === undefined) {
      return { status: "unknown-module" };
    }
    const errors = this.validator.validate(
      moduleFilePath,
      source as Source,
      serializedSchema,
      // See `SchemaStore.version`: a counter, not a sha. The validator only uses
      // it to decide whether to re-deserialize.
      String(this.schemaStore.version(moduleFilePath)),
    );
    const customValidatePaths = collectCustomValidateTargets(
      moduleFilePath,
      serializedSchema,
      source as Source,
    ).paths;
    const result = { errors, customValidatePaths };
    this.results.set(moduleFilePath, result);
    this.stale.delete(moduleFilePath);
    this.events.emit({
      type: "validation:result",
      moduleFilePath,
      errors,
      customValidatePaths,
    });
    return { status: "validated", ...result };
  }

  /** Cached only: never triggers work, so a render path can call it freely. */
  peek(moduleFilePath: ModuleFilePath): ValidationResult {
    const cached = this.results.get(moduleFilePath);
    if (cached && !this.stale.has(moduleFilePath)) {
      return { status: "validated", ...cached };
    }
    return { status: "stale" };
  }
}
