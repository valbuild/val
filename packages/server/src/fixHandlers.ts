/**
 * The fix handlers behind `val validate --fix`, and the editor quick fixes that
 * must agree with it.
 *
 * ## Why this lives in `@valbuild/server`
 *
 * A fix is two layers. `createFixPatch` is the second: given a validation
 * error it produces a patch. The first is everything that has to happen before a
 * patch can be produced — read the file, check it is actually on disk, extract
 * metadata, pick a remote bucket, upload the bytes, download them back. That
 * layer used to live in `packages/cli/src/runValidation.ts`, which made it
 * reachable only from the CLI: `@valbuild/cli` exports nothing but `./cli`, and
 * `@valbuild/language-server` cannot depend on it anyway without creating a
 * cycle (the CLI depends on the language server).
 *
 * The consequence was that an editor could offer the fixes needing no
 * precondition and had to reimplement or skip the rest. Both happened: the
 * VS Code extension grew its own remote-upload client, and the language server
 * declined to offer remote fixes at all.
 *
 * So the layer sits here, next to `createFixPatch`, and the CLI and the language
 * server are both callers. {@link FixHandlerContext} is deliberately made of
 * things any caller already has — a `Service`, an `IValFSHost`, a project root —
 * rather than of CLI concepts.
 *
 * What stays in the CLI is the driver: the `runValidation` async generator that
 * walks every module, decides what to report, and renders it to a terminal.
 */

import path from "path";
import ts from "typescript";
import nodeFs from "fs";
import {
  Internal,
  type Json,
  ModuleFilePath,
  ModulePath,
  SerializedFileSchema,
  SerializedImageSchema,
  SourcePath,
  ValidationFix,
} from "@valbuild/core";
import { extractJsonValuesEntry } from "./extractJsonValuesEntry";
import { getFileExt } from "./getFileExt";
import {
  getPersonalAccessTokenPath,
  parsePersonalAccessTokenFile,
} from "./personalAccessTokens";
import type { Service } from "./Service";
import type { IValFSHost } from "./ValFSHost";

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
  // True when the error is about an object/record key rather than its value.
  keyError?: boolean;
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
  // The handler repaired the source itself (it could not be expressed as a
  // patch, so `shouldApplyPatch` does not apply): count it as fixed.
  appliedFix?: boolean;
  // The handler did nothing because `--fix` was off, but the error IS fixable:
  // report it as such instead of as a plain validation error.
  fixableErrorMessage?: string;
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
  | {
      type: "validation-error";
      sourcePath: string;
      message: string;
      keyError?: boolean;
    }
  | {
      type: "validation-fixable-error";
      sourcePath: string;
      message: string;
      fixable: boolean;
      keyError?: boolean;
    }
  | {
      type: "unknown-fix";
      sourcePath: string;
      fixes: string[];
      keyError?: boolean;
    }
  /**
   * A file that default exports a Val module, but that val.modules does not
   * register — so Val will never serve it. Files that do NOT default export a
   * module are not reported at all, and one whose default export is not a
   * module is a `fatal-error`; see `reportUnregistered` in the CLI.
   */
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
  const fileRefProp = (fileSource.source as any)?.path;
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

// Shared upload core used by both the single-field (handleRemoteFileUpload)
// and gallery (handleRemoteGalleryFileUpload) handlers. The two differ only in
// how they derive the local file ref, metadata and serialized image/file
// schema; everything from auth through upload is identical.
async function uploadRemoteFileCore(
  ctx: FixHandlerContext,
  fileRef: string,
  metadata: Record<string, unknown> | undefined,
  schema: SerializedImageSchema | SerializedFileSchema,
): Promise<FixHandlerResult> {
  const filePath = path.join(ctx.projectRoot, fileRef);
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
    metadata,
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

export async function handleRemoteFileUpload(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  if (!ctx.fix) {
    return {
      success: false,
      // No sourcePath in the message: the reported location already points at it.
      errorMessage: `Remote file needs to be uploaded (use --fix to upload)`,
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
  const fileRefProp = (resolvedRemoteFileAtSourcePath.source as any)?.path;
  if (!fileRefProp) {
    return {
      success: false,
      errorMessage: `Expected file to be defined at: ${ctx.sourcePath} but no file was found`,
    };
  }

  const resolveRemoteFileSchema = resolvedRemoteFileAtSourcePath.schema;
  if (!resolveRemoteFileSchema) {
    return {
      success: false,
      errorMessage: `Cannot upload remote file: schema not found for ${ctx.sourcePath}`,
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

  // The metadata is everything the media source carries besides its path: the
  // schema above already established that this IS media.
  const actualRemoteFileSource = resolvedRemoteFileAtSourcePath.source;
  const fileSourceMetadata =
    actualRemoteFileSource &&
    typeof actualRemoteFileSource === "object" &&
    "path" in actualRemoteFileSource
      ? (() => {
          const { path: _path, ...metadata } = actualRemoteFileSource;
          return metadata;
        })()
      : undefined;

  return uploadRemoteFileCore(
    ctx,
    fileRefProp,
    fileSourceMetadata,
    resolveRemoteFileSchema,
  );
}

// Gallery (s.images({ remote: true }) / s.files({ remote: true })) upload.
// Unlike a single image/file field, a gallery entry is keyed by its local file
// path and the value is bare metadata (no FileSource), so we derive the file
// ref from the key and synthesize the image/file schema from the record's
// media options.
export async function handleRemoteGalleryFileUpload(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  if (!ctx.fix) {
    return {
      success: false,
      // No sourcePath in the message: the reported location already points at it.
      errorMessage: `Remote file needs to be uploaded (use --fix to upload)`,
    };
  }

  const fix = ctx.validationError.fixes?.[0];
  const mediaType = fix === "files:upload-remote" ? "file" : "image";

  // The gallery entry is keyed by its local file path; validateMediaKey carries
  // that key as the error value.
  const fileRef = ctx.validationError.value;
  if (typeof fileRef !== "string") {
    return {
      success: false,
      errorMessage: `Expected a local file path for gallery entry at ${ctx.sourcePath}`,
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

  const resolved = Internal.resolvePath(
    modulePath,
    ctx.valModule.source,
    ctx.valModule.schema,
  );
  const entrySource = resolved.source;
  const metadata =
    entrySource &&
    typeof entrySource === "object" &&
    !Array.isArray(entrySource)
      ? (entrySource as Record<string, unknown>)
      : undefined;

  // The gallery item schema is an ObjectSchema, not an image/file schema, so
  // synthesize the serialized image/file schema (matching how single fields
  // serialize) for the remote ref's validation hash.
  //
  // `accept`/`directory` come from the RECORD that holds the entry, resolved
  // from the entry's PARENT path - not from the module root, which is only the
  // record when the gallery is the whole module. A nested gallery
  // (s.object({ gallery: s.images(...) })) would otherwise synthesize a schema
  // with no options and bake a validation hash into the remote ref that can
  // never validate, so a mismatch fails fast instead of uploading.
  const [, parentModulePath] = Internal.splitModuleFilePathAndModulePath(
    Internal.parentOfSourcePath(ctx.sourcePath),
  );
  const recordSchema = Internal.resolvePath(
    parentModulePath,
    ctx.valModule.source,
    ctx.valModule.schema,
  ).schema;
  if (recordSchema?.type !== "record") {
    return {
      success: false,
      errorMessage: `Expected a gallery record at the parent of ${ctx.sourcePath}, got ${
        recordSchema?.type ?? "nothing"
      }`,
    };
  }
  const { accept, directory } = recordSchema;
  const schema: SerializedImageSchema | SerializedFileSchema =
    mediaType === "image"
      ? {
          type: "image",
          opt: false,
          options: {
            ...(accept ? { accept } : {}),
            ...(directory ? { directory } : {}),
          },
        }
      : {
          type: "file",
          opt: false,
          options: {
            ...(accept ? { accept } : {}),
          },
        };

  return uploadRemoteFileCore(ctx, fileRef, metadata, schema);
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
      { validate: false },
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

// Maps a gallery key to its on-disk local path. Remote galleries key uploaded
// entries by a remote URL while keeping the file on disk; everything else is
// already a local path and is returned unchanged.
function remoteKeyToLocalPath(key: string): string {
  const remoteRefRes = Internal.remote.splitRemoteRef(key);
  if (remoteRefRes.status === "success") {
    return `/${remoteRefRes.filePath}`;
  }
  return key;
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
  // Gallery entries are keyed by their file path. Remote galleries key uploaded
  // entries by a remote URL, but the file is kept on disk at its local path, so
  // normalize remote-URL keys back to that local path for the on-disk checks.
  const trackedFiles = new Set(
    Object.keys(source as Record<string, unknown>).map(remoteKeyToLocalPath),
  );

  // Check that all tracked files exist on disk
  const missingTrackedFiles = Array.from(trackedFiles).filter((f) => {
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

export async function handleJsonValuesExtractEntry(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    ctx.sourcePath,
  );
  const parts = Internal.splitModulePath(modulePath);
  // Root-only by contract (see findNestedJsonValuesRecords): the entry is a
  // direct child of the module's root record/router, so the path is one segment.
  if (parts.length !== 1) {
    return {
      success: false,
      errorMessage: `Cannot extract .jsonValues() entry at ${ctx.sourcePath}: expected a root record entry`,
    };
  }
  const entryKey = parts[0];
  const source = ctx.valModule.source;
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return {
      success: false,
      errorMessage: `Could not get source for ${ctx.moduleFilePath}`,
    };
  }
  const content = (source as Record<string, Json>)[entryKey];
  if (content === undefined) {
    return {
      success: false,
      errorMessage: `Could not find .jsonValues() entry '${entryKey}' in ${ctx.moduleFilePath}`,
    };
  }
  if (!ctx.fix) {
    return {
      success: true,
      fixableErrorMessage: ctx.validationError.message,
    };
  }
  try {
    extractJsonValuesEntry(
      ctx.moduleFilePath,
      ctx.projectRoot,
      entryKey,
      content,
      ctx.service.sourceFileHandler,
    );
  } catch (err) {
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
  return { success: true, appliedFix: true };
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
  "images:upload-remote": handleRemoteGalleryFileUpload,
  "files:upload-remote": handleRemoteGalleryFileUpload,
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
  "jsonValues:extract-entry": handleJsonValuesExtractEntry,
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
