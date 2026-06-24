import path from "path";
import {
  createFixPatch,
  createService,
  getPersonalAccessTokenPath,
  parsePersonalAccessTokenFile,
  Service,
  IValFSHost,
} from "@valbuild/server";
import {
  FILE_REF_PROP,
  Internal,
  type Json,
  ModuleFilePath,
  ModulePath,
  SerializedFileSchema,
  SerializedImageSchema,
  SourcePath,
  ValidationFix,
} from "@valbuild/core";
import {
  resolveSchemaSourceFixes,
  type SchemaSourceSnapshot,
} from "@valbuild/shared/internal";
import { getFileExt } from "./utils/getFileExt";
import ts from "typescript";
import nodeFs from "fs";

export type { IValFSHost };

export type IValRemote = {
  remoteHost: string;
  getSettings(
    projectName: string,
    options: { pat: string },
  ): Promise<
    | {
        success: true;
        data: {
          publicProjectId: string;
          remoteFileBuckets: { bucket: string }[];
        };
      }
    | { success: false; message: string }
  >;
  uploadFile(
    project: string,
    bucket: string,
    fileHash: string,
    fileExt: string | undefined,
    fileBuffer: Buffer,
    options: { pat: string },
  ): Promise<{ success: true } | { success: false; error: string }>;
};

const textEncoder = new TextEncoder();

// Types for handler system
export type ValModule = Awaited<ReturnType<Service["get"]>>;

export type ValidationError = {
  message: string;
  value?: unknown;
  fixes?: ValidationFix[];
};

export type FixHandlerContext = {
  sourcePath: SourcePath;
  validationError: ValidationError;
  valModule: ValModule;
  projectRoot: string;
  fix: boolean;
  service: Service;
  valFiles: string[];
  moduleFilePath: ModuleFilePath;
  file: string;
  fs: IValFSHost;
  // Shared state
  remoteFiles: Record<
    SourcePath,
    { ref: string; metadata?: Record<string, unknown> }
  >;
  publicProjectId?: string;
  remoteFileBuckets?: string[];
  remoteFilesCounter: number;
  remote: IValRemote;
  project: string | undefined;
};

export type FixHandlerResult = {
  success: boolean;
  errorMessage?: string;
  shouldApplyPatch?: boolean;
  // Updated shared state
  publicProjectId?: string;
  remoteFileBuckets?: string[];
  remoteFilesCounter?: number;
  // Events to emit
  events?: ValidationEvent[];
};

export type FixHandler = (ctx: FixHandlerContext) => Promise<FixHandlerResult>;

export type ValidationEvent =
  | { type: "file-valid"; file: string; durationMs: number }
  | {
      type: "file-error-count";
      file: string;
      errorCount: number;
      durationMs: number;
    }
  | { type: "validation-error"; sourcePath: string; message: string }
  | {
      type: "validation-fixable-error";
      sourcePath: string;
      message: string;
      fixable: boolean;
    }
  | { type: "unknown-fix"; sourcePath: string; fixes: string[] }
  | { type: "unregistered-module"; file: string }
  | { type: "fix-applied"; file: string; sourcePath: string }
  | { type: "fatal-error"; file: string; message: string }
  | { type: "remote-uploading"; ref: string }
  | { type: "remote-uploaded"; ref: string }
  | { type: "remote-already-uploaded"; filePath: string }
  | { type: "remote-downloading"; sourcePath: string }
  | { type: "summary-errors"; count: number }
  | { type: "summary-success" };

// Handler functions
export async function handleFileMetadata(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    ctx.sourcePath,
  );

  if (!ctx.valModule.source || !ctx.valModule.schema) {
    return {
      success: false,
      errorMessage: `Could not resolve source or schema for ${ctx.sourcePath}`,
    };
  }

  const fileSource = Internal.resolvePath(
    modulePath,
    ctx.valModule.source,
    ctx.valModule.schema,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileRefProp = (fileSource.source as any)?.[FILE_REF_PROP];
  if (!fileRefProp) {
    return {
      success: false,
      errorMessage: `Expected file to be defined at: ${ctx.sourcePath} but no file was found`,
    };
  }

  const filePath = path.join(ctx.projectRoot, fileRefProp);
  if (!ctx.fs.fileExists(filePath)) {
    return {
      success: false,
      errorMessage: `File ${filePath} does not exist`,
    };
  }

  return { success: true, shouldApplyPatch: true };
}

export async function handleRemoteFileUpload(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  if (!ctx.fix) {
    return {
      success: false,
      errorMessage: `Remote file ${ctx.sourcePath} needs to be uploaded (use --fix to upload)`,
    };
  }

  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    ctx.sourcePath,
  );

  if (!ctx.valModule.source || !ctx.valModule.schema) {
    return {
      success: false,
      errorMessage: `Could not resolve source or schema for ${ctx.sourcePath}`,
    };
  }

  const resolvedRemoteFileAtSourcePath = Internal.resolvePath(
    modulePath,
    ctx.valModule.source,
    ctx.valModule.schema,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileRefProp = (resolvedRemoteFileAtSourcePath.source as any)?.[
    FILE_REF_PROP
  ];
  if (!fileRefProp) {
    return {
      success: false,
      errorMessage: `Expected file to be defined at: ${ctx.sourcePath} but no file was found`,
    };
  }

  const filePath = path.join(ctx.projectRoot, fileRefProp);
  if (!ctx.fs.fileExists(filePath)) {
    return {
      success: false,
      errorMessage: `File ${filePath} does not exist`,
    };
  }

  const patFile = getPersonalAccessTokenPath(ctx.projectRoot);
  if (!ctx.fs.fileExists(patFile)) {
    return {
      success: false,
      errorMessage: `File: ${path.join(ctx.projectRoot, ctx.file)} has remote images that are not uploaded and you are not logged in.\n\nFix this error by logging in:\n\t"npx val login"\n`,
    };
  }

  const patFileContent = ctx.fs.readFile(patFile);
  if (patFileContent === undefined) {
    return {
      success: false,
      errorMessage: `Could not read personal access token file at ${patFile}`,
    };
  }

  const parsedPatFile = parsePersonalAccessTokenFile(patFileContent);
  if (!parsedPatFile.success) {
    return {
      success: false,
      errorMessage: `Error parsing personal access token file: ${parsedPatFile.error}. You need to login again.`,
    };
  }
  const { pat } = parsedPatFile.data;

  if (ctx.remoteFiles[ctx.sourcePath]) {
    return {
      success: true,
      events: [{ type: "remote-already-uploaded", filePath }],
    };
  }

  if (!resolvedRemoteFileAtSourcePath.schema) {
    return {
      success: false,
      errorMessage: `Cannot upload remote file: schema not found for ${ctx.sourcePath}`,
    };
  }

  const actualRemoteFileSource = resolvedRemoteFileAtSourcePath.source;
  const fileSourceMetadata = Internal.isFile(actualRemoteFileSource)
    ? actualRemoteFileSource.metadata
    : undefined;
  const resolveRemoteFileSchema = resolvedRemoteFileAtSourcePath.schema;

  if (!resolveRemoteFileSchema) {
    return {
      success: false,
      errorMessage: `Could not resolve schema for remote file: ${ctx.sourcePath}`,
    };
  }

  const projectName = ctx.project;
  let publicProjectId = ctx.publicProjectId;
  let remoteFileBuckets = ctx.remoteFileBuckets;
  let remoteFilesCounter = ctx.remoteFilesCounter;

  if (!publicProjectId || !remoteFileBuckets) {
    if (!projectName) {
      return {
        success: false,
        errorMessage:
          "Project name not found. Add project name to val.config or set the VAL_PROJECT environment variable",
      };
    }
    const settingsRes = await ctx.remote.getSettings(projectName, { pat });
    if (!settingsRes.success) {
      return {
        success: false,
        errorMessage: `Could not get public project id: ${settingsRes.message}.`,
      };
    }
    publicProjectId = settingsRes.data.publicProjectId;
    remoteFileBuckets = settingsRes.data.remoteFileBuckets.map((b) => b.bucket);
  }

  if (!publicProjectId) {
    return {
      success: false,
      errorMessage: "Could not get public project id",
    };
  }

  if (!projectName) {
    return {
      success: false,
      errorMessage: `Could not get project. Check that your val.config has the 'project' field set, or set it using the VAL_PROJECT environment variable`,
    };
  }

  if (
    resolveRemoteFileSchema.type !== "image" &&
    resolveRemoteFileSchema.type !== "file"
  ) {
    return {
      success: false,
      errorMessage: `The schema is the remote is neither image nor file: ${ctx.sourcePath}`,
    };
  }

  remoteFilesCounter += 1;
  const bucket =
    remoteFileBuckets[remoteFilesCounter % remoteFileBuckets.length];

  if (!bucket) {
    return {
      success: false,
      errorMessage: `Internal error: could not allocate a bucket for the remote file located at ${ctx.sourcePath}`,
    };
  }

  const fileBuffer = ctx.fs.readBuffer(filePath);
  if (fileBuffer === undefined) {
    return {
      success: false,
      errorMessage: `Error reading file: ${filePath}`,
    };
  }

  const relativeFilePath = path
    .relative(ctx.projectRoot, filePath)
    .split(path.sep)
    .join("/") as `public/${string}`;

  if (!relativeFilePath.startsWith("public/")) {
    return {
      success: false,
      errorMessage: `File path must be within the public/ directory (e.g. public/path/to/file.txt). Got: ${relativeFilePath}`,
    };
  }

  const fileHash = Internal.remote.getFileHash(fileBuffer);
  const coreVersion = Internal.VERSION.core || "unknown";
  const fileExt = getFileExt(filePath);
  const schema = resolveRemoteFileSchema as
    | SerializedImageSchema
    | SerializedFileSchema;
  const metadata = fileSourceMetadata;
  const ref = Internal.remote.createRemoteRef(ctx.remote.remoteHost, {
    publicProjectId,
    coreVersion,
    bucket,
    validationHash: Internal.remote.getValidationHash(
      coreVersion,
      schema,
      fileExt,
      metadata,
      fileHash,
      textEncoder,
    ),
    fileHash,
    filePath: relativeFilePath,
  });

  const remoteFileUpload = await ctx.remote.uploadFile(
    projectName,
    bucket,
    fileHash,
    fileExt,
    fileBuffer,
    { pat },
  );

  if (!remoteFileUpload.success) {
    return {
      success: false,
      errorMessage: `Could not upload remote file: '${ref}'. Error: ${remoteFileUpload.error}`,
    };
  }

  ctx.remoteFiles[ctx.sourcePath] = {
    ref,
    metadata: fileSourceMetadata,
  };

  return {
    success: true,
    shouldApplyPatch: true,
    publicProjectId,
    remoteFileBuckets,
    remoteFilesCounter,
    events: [
      { type: "remote-uploading", ref },
      { type: "remote-uploaded", ref },
    ],
  };
}

export async function handleRemoteFileDownload(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  if (ctx.fix) {
    return {
      success: true,
      shouldApplyPatch: true,
      events: [{ type: "remote-downloading", sourcePath: ctx.sourcePath }],
    };
  } else {
    return {
      success: false,
      errorMessage: `Remote file ${ctx.sourcePath} needs to be downloaded (use --fix to download)`,
    };
  }
}

export async function handleRemoteFileCheck(): Promise<FixHandlerResult> {
  // Skip - no action needed
  return { success: true, shouldApplyPatch: true };
}

export async function handleUniqueFolderCheck(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  const value = ctx.validationError.value as
    | { directory: string; type: string }
    | undefined;
  if (!value || typeof value.directory !== "string") {
    return {
      success: false,
      errorMessage: `Unexpected value in unique folder check for ${ctx.sourcePath}`,
    };
  }
  const { directory } = value;
  const conflicts: string[] = [];
  for (const file of ctx.valFiles) {
    const otherModuleFilePath = `/${file}` as ModuleFilePath;
    if (otherModuleFilePath === ctx.moduleFilePath) continue;
    const otherModule = await ctx.service.get(
      otherModuleFilePath,
      "" as ModulePath,
      { source: false, schema: true, validate: false },
    );
    const schema = otherModule.schema as
      | { type?: string; directory?: string; mediaType?: string }
      | undefined;
    if (
      schema?.type === "record" &&
      schema.directory === directory &&
      schema.mediaType
    ) {
      conflicts.push(otherModuleFilePath);
    }
  }
  if (conflicts.length > 0) {
    return {
      success: false,
      errorMessage: `Gallery directory '${directory}' in ${ctx.moduleFilePath} is also used by: ${conflicts.join(", ")}. Each gallery must use a unique directory.`,
    };
  }
  return { success: true };
}

export async function handleCheckAllFiles(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  const value = ctx.validationError.value as
    | { directory: string; type: string }
    | undefined;
  if (!value || typeof value.directory !== "string") {
    return {
      success: false,
      errorMessage: `Unexpected value in check-all-files for ${ctx.sourcePath}`,
    };
  }
  const { directory } = value;

  const source = ctx.valModule.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {
      success: false,
      errorMessage: `Could not get source for ${ctx.sourcePath}`,
    };
  }
  const trackedFiles = new Set(Object.keys(source as Record<string, unknown>));

  // Check that all tracked files exist on disk
  const missingTrackedFiles = [...trackedFiles].filter((f) => {
    return !ctx.fs.fileExists(path.join(ctx.projectRoot, f));
  });
  if (missingTrackedFiles.length > 0) {
    if (!ctx.fix) {
      return {
        success: false,
        errorMessage: `Gallery in ${ctx.moduleFilePath} has tracked files that do not exist on disk: ${missingTrackedFiles.join(", ")}. Add the files or remove them from the gallery.`,
      };
    }
    // fix: true — let createFixPatch remove the missing entries
    return { success: true, shouldApplyPatch: true };
  }

  const dirPath = path.join(ctx.projectRoot, directory);

  const filesInDir: string[] = [];
  try {
    const entries = ctx.fs.readDirectory(dirPath, undefined, undefined, [
      "**/*",
    ]);
    for (const entry of entries) {
      const relPath =
        "/" + path.relative(ctx.projectRoot, entry).split(path.sep).join("/");
      filesInDir.push(relPath);
    }
  } catch {
    // directory doesn't exist — no untracked files possible
  }

  const untrackedFiles = filesInDir.filter((f) => !trackedFiles.has(f));
  if (untrackedFiles.length > 0) {
    return {
      success: false,
      errorMessage: `Gallery in ${ctx.moduleFilePath} has files not tracked: ${untrackedFiles.join(", ")}. Add these files to the gallery or remove them from the directory.`,
    };
  }

  // All files accounted for — trigger metadata verification via createFixPatch
  return { success: true, shouldApplyPatch: true };
}

// Fix handler registry. `keyof:check-keys` and `router:check-route` are
// resolved upfront by the shared resolveSchemaSourceFixes — they never reach
// this registry, so they're excluded from the key set.
export const currentFixHandlers: Record<
  Exclude<ValidationFix, "keyof:check-keys" | "router:check-route">,
  FixHandler
> = {
  "image:check-metadata": handleFileMetadata,
  "image:add-metadata": handleFileMetadata,
  "file:check-metadata": handleFileMetadata,
  "file:add-metadata": handleFileMetadata,
  "image:upload-remote": handleRemoteFileUpload,
  "file:upload-remote": handleRemoteFileUpload,
  "image:download-remote": handleRemoteFileDownload,
  "file:download-remote": handleRemoteFileDownload,
  "image:check-remote": handleRemoteFileCheck,
  "images:check-remote": handleRemoteFileCheck,
  "file:check-remote": handleRemoteFileCheck,
  "files:check-remote": handleRemoteFileCheck,
  "images:check-unique-folder": handleUniqueFolderCheck,
  "files:check-unique-folder": handleUniqueFolderCheck,
  "images:check-all-files": handleCheckAllFiles,
  "files:check-all-files": handleCheckAllFiles,
};
const deprecatedFixHandlers: Record<string, FixHandler> = {
  "image:replace-metadata": handleFileMetadata,
};
export const fixHandlers: Record<string, FixHandler> = {
  ...deprecatedFixHandlers,
  ...currentFixHandlers,
};

export function createDefaultValFSHost(): IValFSHost {
  return {
    ...ts.sys,
    writeFile: (fileName, data, encoding) => {
      nodeFs.mkdirSync(path.dirname(fileName), { recursive: true });
      nodeFs.writeFileSync(
        fileName,
        typeof data === "string" ? data : new Uint8Array(data),
        encoding,
      );
    },
    rmFile: nodeFs.rmSync,
    readBuffer: (fileName) => {
      try {
        return nodeFs.readFileSync(fileName);
      } catch {
        return undefined;
      }
    },
  };
}

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

  const service = await createService(projectRoot, {}, fs);

  // Modules registered in the project's val.modules. Files found on disk that
  // are not registered here are not validated (a warning is emitted instead).
  const registered = new Set<ModuleFilePath>(service.getModuleFilePaths());

  let errors = 0;

  // Build a single schema/source snapshot up front so the shared resolver
  // can resolve keyof:check-keys / router:check-route references that span
  // multiple val files. Use the full registry so cross-module references
  // resolve even against modules not in the validated subset.
  const snapshot: SchemaSourceSnapshot = { schemas: {}, sources: {} };
  for (const moduleFilePath of registered) {
    const valModule = await service.get(moduleFilePath, "" as ModulePath, {
      source: true,
      schema: true,
      validate: false,
    });
    if (valModule.schema) {
      snapshot.schemas[moduleFilePath] = valModule.schema;
    }
    if (valModule.source !== undefined) {
      snapshot.sources[moduleFilePath] = valModule.source as Json;
    }
  }

  async function* validateFile(file: string): AsyncGenerator<ValidationEvent> {
    const moduleFilePath = `/${file}` as ModuleFilePath; // TODO: check if this always works? (Windows?)
    if (!registered.has(moduleFilePath)) {
      yield { type: "unregistered-module", file };
      return;
    }
    const start = Date.now();
    const valModule = await service.get(moduleFilePath, "" as ModulePath, {
      source: true,
      schema: true,
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
                };
                fileErrors += 1;
                continue;
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
                  };
                }

                for (const e of fixPatch?.remainingErrors ?? []) {
                  fileErrors += 1;
                  yield {
                    type: "validation-fixable-error",
                    sourcePath,
                    message: e.message,
                    fixable: !!(e.fixes && e.fixes.length),
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
