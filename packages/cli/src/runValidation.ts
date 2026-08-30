import path from "path";
import {
  createDefaultValFSHost,
  createFixPatch,
  createService,
  createValModuleFileInspector,
  fixHandlers,
  type FixHandlerContext,
  type IValFSHost,
  type IValRemote,
  type ValidationEvent,
  type ValidationError,
  type ValModule,
} from "@valbuild/server";
import {
  type Json,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import {
  resolveSchemaSourceFixes,
  type SchemaSourceSnapshot,
} from "@valbuild/shared/internal";

/**
 * Driving `val validate` over a project.
 *
 * The fix handlers themselves live in `@valbuild/server` (`fixHandlers.ts`), so
 * that the language server runs exactly the same ones and an editor fix cannot
 * drift from a CLI fix. What is left here is the part that is genuinely the
 * CLI's: walking every module, deciding what counts as reportable, and emitting
 * the event stream the terminal renders.
 */
export type {
  FixHandlerContext,
  IValFSHost,
  IValRemote,
  ValidationEvent,
  ValidationError,
  ValModule,
};
export { createDefaultValFSHost, fixHandlers };

export async function* runValidation({
  root,
  fix,
  valFiles,
  project,
  remote,
  fs,
}: {
  root: string;
  fix: boolean;
  valFiles: string[];
  project: string | undefined;
  remote: IValRemote;
  fs: IValFSHost;
}): AsyncGenerator<ValidationEvent> {
  const projectRoot = path.resolve(root);

  const service = await createService(projectRoot, fs);

  // Modules registered in the project's val.modules. Files found on disk that
  // are not registered here are not validated; what (if anything) is reported
  // for them is decided by `reportUnregistered` below.
  const registered = new Set<ModuleFilePath>(service.getModuleFilePaths());

  // Only used for files that are NOT registered, so it never duplicates the
  // evaluation `createService` already did.
  const inspectValModuleFile = createValModuleFileInspector(projectRoot, fs);

  let errors = 0;

  // Build a single schema/source snapshot up front so the shared resolver
  // can resolve keyof:check-keys / router:check-route references that span
  // multiple val files. Use the full registry so cross-module references
  // resolve even against modules not in the validated subset.
  const snapshot: SchemaSourceSnapshot = { schemas: {}, sources: {} };
  for (const moduleFilePath of registered) {
    const valModule = await service.get(moduleFilePath, "" as ModulePath, {
      validate: false,
    });
    if (valModule.schema) {
      snapshot.schemas[moduleFilePath] = valModule.schema;
    }
    if (valModule.source !== undefined) {
      snapshot.sources[moduleFilePath] = valModule.source as Json;
    }
  }

  /**
   * What to report for a `*.val.ts` file that val.modules does not register.
   *
   * The `*.val.ts` suffix is used for more than Val modules — shared schemas and
   * other content-adjacent helpers wear it too — and those are not meant to be
   * registered, so warning about every unregistered file buries the one warning
   * that matters under a wall of noise. The default export is what separates
   * them: a file that default exports a module is one someone meant to register
   * and forgot (a warning), a file that default exports something else can never
   * be loaded by Val under that name (an error), and a file with no default
   * export is simply not a module (silence).
   */
  async function* reportUnregistered(
    file: string,
  ): AsyncGenerator<ValidationEvent> {
    const start = Date.now();
    const inspection = inspectValModuleFile(path.join(projectRoot, file));
    if (inspection.status === "no-default-export") {
      return;
    }
    if (inspection.status === "val-module") {
      yield { type: "unregistered-module", file };
      return;
    }
    errors += 1;
    yield {
      type: "fatal-error",
      file: `/${file}`,
      message: inspection.message,
    };
    yield {
      type: "file-error-count",
      file: `/${file}`,
      errorCount: 1,
      durationMs: Date.now() - start,
    };
  }

  async function* validateFile(file: string): AsyncGenerator<ValidationEvent> {
    const moduleFilePath = `/${file}` as ModuleFilePath; // TODO: check if this always works? (Windows?)
    if (!registered.has(moduleFilePath)) {
      yield* reportUnregistered(file);
      return;
    }
    const start = Date.now();
    const valModule = await service.get(moduleFilePath, "" as ModulePath, {
      validate: true,
    });
    const remoteFiles: Record<
      SourcePath,
      { ref: string; metadata?: Record<string, unknown> }
    > = {};
    let remoteFileBuckets: string[] | undefined = undefined;
    let remoteFilesCounter = 0;
    if (!valModule.errors) {
      yield {
        type: "file-valid",
        file: moduleFilePath,
        durationMs: Date.now() - start,
      };
      return;
    } else {
      let fileErrors = 0;
      let fixedErrors = 0;
      if (valModule.errors) {
        if (valModule.errors.validation) {
          // Resolve schema/source fixes (keyof:check-keys, router:check-route)
          // against the snapshot before per-error dispatch. Resolved errors
          // are dropped; invalid references come back with rewritten messages
          // and fixes cleared, so they fall through the "no fixes" branch.
          const resolvedValidationErrors = resolveSchemaSourceFixes(
            valModule.errors.validation,
            snapshot,
          );
          for (const [sourcePath, validationErrors] of Object.entries(
            resolvedValidationErrors,
          )) {
            for (const v of validationErrors) {
              if (!v.fixes || v.fixes.length === 0) {
                // No fixes available - just report error
                fileErrors += 1;
                yield {
                  type: "validation-error",
                  sourcePath,
                  message: v.message,
                  ...(v.keyError ? { keyError: true } : {}),
                };
                continue;
              }

              // Find and execute appropriate handler
              const fixType = v.fixes[0]; // Take first fix
              const handler = fixHandlers[fixType];

              if (!handler) {
                yield {
                  type: "unknown-fix",
                  sourcePath,
                  fixes: v.fixes,
                  ...(v.keyError ? { keyError: true } : {}),
                };
                fileErrors += 1;
                continue;
              }

              // Execute handler
              const result = await handler({
                sourcePath: sourcePath as SourcePath,
                validationError: v,
                valModule,
                projectRoot,
                fix: !!fix,
                service,
                valFiles,
                moduleFilePath,
                file,
                fs,
                remoteFiles,
                publicProjectId: undefined,
                remoteFileBuckets,
                remoteFilesCounter,
                remote,
                project,
              });

              // Yield any events from handler
              if (result.events) {
                for (const event of result.events) {
                  yield event;
                }
              }

              // Update shared state from handler result
              if (result.remoteFileBuckets !== undefined) {
                remoteFileBuckets = result.remoteFileBuckets;
              }
              if (result.remoteFilesCounter !== undefined) {
                remoteFilesCounter = result.remoteFilesCounter;
              }

              if (!result.success) {
                yield {
                  type: "validation-error",
                  sourcePath,
                  message: result.errorMessage ?? "Unknown error",
                  ...(v.keyError ? { keyError: true } : {}),
                };
                fileErrors += 1;
                continue;
              }

              if (result.appliedFix) {
                fixedErrors += 1;
                yield { type: "fix-applied", file, sourcePath };
              }

              if (result.fixableErrorMessage !== undefined) {
                fileErrors += 1;
                yield {
                  type: "validation-fixable-error",
                  sourcePath,
                  message: result.fixableErrorMessage,
                  fixable: true,
                  ...(v.keyError ? { keyError: true } : {}),
                };
              }

              // Apply patch if needed
              if (result.shouldApplyPatch) {
                const fixPatch = await createFixPatch(
                  { projectRoot, remoteHost: remote.remoteHost },
                  !!fix,
                  sourcePath as SourcePath,
                  v,
                  remoteFiles,
                  valModule.source,
                  valModule.schema,
                );

                if (fix && fixPatch?.patch && fixPatch?.patch.length > 0) {
                  await service.patch(moduleFilePath, fixPatch.patch);
                  fixedErrors += 1;
                  yield { type: "fix-applied", file, sourcePath };
                } else if (
                  !fix &&
                  fixPatch?.patch &&
                  fixPatch?.patch.length > 0
                ) {
                  fileErrors += 1;
                  yield {
                    type: "validation-fixable-error",
                    sourcePath,
                    message: v.message,
                    fixable: true,
                    ...(v.keyError ? { keyError: true } : {}),
                  };
                }

                for (const e of fixPatch?.remainingErrors ?? []) {
                  fileErrors += 1;
                  yield {
                    type: "validation-fixable-error",
                    // Gallery checks expand into per-entry errors that point at
                    // the individual entry; fall back to the record sourcePath.
                    sourcePath: e.sourcePath ?? sourcePath,
                    message: e.message,
                    fixable: !!(e.fixes && e.fixes.length),
                    ...(e.keyError ? { keyError: true } : {}),
                  };
                }
              }
            }
          }
        }
        if (
          fixedErrors === fileErrors &&
          (!valModule.errors.fatal || valModule.errors.fatal.length == 0)
        ) {
          yield {
            type: "file-valid",
            file: moduleFilePath,
            durationMs: Date.now() - start,
          };
        }
        for (const fatalError of valModule.errors.fatal || []) {
          fileErrors += 1;
          yield {
            type: "fatal-error",
            file: moduleFilePath,
            message: fatalError.message,
          };
        }
      } else {
        yield {
          type: "file-valid",
          file: moduleFilePath,
          durationMs: Date.now() - start,
        };
      }
      if (fileErrors > 0) {
        yield {
          type: "file-error-count",
          file: `/${file}`,
          errorCount: fileErrors,
          durationMs: Date.now() - start,
        };
      }
      errors += fileErrors;
    }
  }

  for (const file of valFiles.sort()) {
    yield* validateFile(file);
  }

  service.dispose();

  if (errors > 0) {
    yield { type: "summary-errors", count: errors };
  } else {
    yield { type: "summary-success" };
  }
}
