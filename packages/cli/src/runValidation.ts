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
  ModuleFilePath,
  ModulePath,
  SerializedFileSchema,
  SerializedImageSchema,
  SourcePath,
  ValidationFix,
} from "@valbuild/core";
import {
  filterRoutesByPatterns,
  validateRoutePatterns,
  type SerializedRegExpPattern,
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

// Cache types for avoiding redundant service.get() calls
export type KeyOfCache = Map<
  string, // moduleFilePath + modulePath key
  { source: unknown; schema: { type: string } | undefined }
>;
export type RouterModulesCache = {
  loaded: boolean;
  modules: Record<string, Record<string, unknown>>;
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
  // Caches for validation
  keyOfCache: KeyOfCache;
  routerModulesCache: RouterModulesCache;
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

export async function handleKeyOfCheck(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  if (
    !ctx.validationError.value ||
    typeof ctx.validationError.value !== "object" ||
    !("key" in ctx.validationError.value) ||
    !("sourcePath" in ctx.validationError.value)
  ) {
    return {
      success: false,
      errorMessage: `Unexpected error in ${ctx.sourcePath}: ${ctx.validationError.message} (Expected value to be an object with 'key' and 'sourcePath' properties - this is likely a bug in Val)`,
    };
  }

  const { key, sourcePath } = ctx.validationError.value as {
    key: unknown;
    sourcePath: unknown;
  };

  if (typeof key !== "string") {
    return {
      success: false,
      errorMessage: `Unexpected error in ${sourcePath}: ${ctx.validationError.message} (Expected value property 'key' to be a string - this is likely a bug in Val)`,
    };
  }

  if (typeof sourcePath !== "string") {
    return {
      success: false,
      errorMessage: `Unexpected error in ${sourcePath}: ${ctx.validationError.message} (Expected value property 'sourcePath' to be a string - this is likely a bug in Val)`,
    };
  }

  const res = await checkKeyIsValid(
    key,
    sourcePath,
    ctx.service,
    ctx.keyOfCache,
  );
  if (res.error) {
    return {
      success: false,
      errorMessage: res.message,
    };
  }

  return { success: true };
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
    .join("/") as `public/val/${string}`;

  if (!relativeFilePath.startsWith("public/val/")) {
    return {
      success: false,
      errorMessage: `File path must be within the public/val/ directory (e.g. public/val/path/to/file.txt). Got: ${relativeFilePath}`,
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

// Helper function
export async function checkKeyIsValid(
  key: string,
  sourcePath: string,
  service: Service,
  cache: KeyOfCache,
): Promise<{ error: false } | { error: true; message: string }> {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);

  const cacheKey = `${moduleFilePath}::${modulePath}`;
  let keyOfModuleSource: unknown;
  let keyOfModuleSchema: { type: string } | undefined;

  const cached = cache.get(cacheKey);
  if (cached) {
    keyOfModuleSource = cached.source;
    keyOfModuleSchema = cached.schema;
  } else {
    const keyOfModule = await service.get(moduleFilePath, modulePath, {
      source: true,
      schema: true,
      validate: false,
    });
    keyOfModuleSource = keyOfModule.source;
    keyOfModuleSchema = keyOfModule.schema as { type: string } | undefined;
    cache.set(cacheKey, {
      source: keyOfModuleSource,
      schema: keyOfModuleSchema,
    });
  }

  if (keyOfModuleSchema && keyOfModuleSchema.type !== "record") {
    return {
      error: true,
      message: `Expected key at ${sourcePath} to be of type 'record'`,
    };
  }
  if (
    keyOfModuleSource &&
    typeof keyOfModuleSource === "object" &&
    key in keyOfModuleSource
  ) {
    return { error: false };
  }
  if (!keyOfModuleSource || typeof keyOfModuleSource !== "object") {
    return {
      error: true,
      message: `Expected ${sourcePath} to be a truthy object`,
    };
  }
  const alternatives = findSimilar(key, Object.keys(keyOfModuleSource));
  return {
    error: true,
    message: `Key '${key}' does not exist in ${sourcePath}. Closest match: '${alternatives[0].target}'. Other similar: ${alternatives
      .slice(1, 4)
      .map((a) => `'${a.target}'`)
      .join(", ")}${alternatives.length > 4 ? ", ..." : ""}`,
  };
}

/**
 * Check if a route is valid by scanning all router modules
 * and validating against include/exclude patterns
 */
export async function checkRouteIsValid(
  route: string,
  include: SerializedRegExpPattern | undefined,
  exclude: SerializedRegExpPattern | undefined,
  service: Service,
  valFiles: string[],
  cache: RouterModulesCache,
): Promise<{ error: false } | { error: true; message: string }> {
  // 1. Scan all val files to find modules with routers (use cache if available)
  if (!cache.loaded) {
    for (const file of valFiles) {
      const moduleFilePath = `/${file}` as ModuleFilePath;
      const valModule = await service.get(moduleFilePath, "" as ModulePath, {
        source: true,
        schema: true,
        validate: false,
      });

      // Check if this module has a router defined
      if (valModule.schema?.type === "record" && valModule.schema.router) {
        if (valModule.source && typeof valModule.source === "object") {
          cache.modules[moduleFilePath] = valModule.source as Record<
            string,
            unknown
          >;
        }
      }
    }
    cache.loaded = true;
  }

  const routerModules = cache.modules;

  // 2. Check if route exists in any router module
  let foundInModule: string | null = null;
  for (const [moduleFilePath, source] of Object.entries(routerModules)) {
    if (route in source) {
      foundInModule = moduleFilePath;
      break;
    }
  }

  if (!foundInModule) {
    // Route not found in any router module
    let allRoutes = Object.values(routerModules).flatMap((source) =>
      Object.keys(source),
    );

    if (allRoutes.length === 0) {
      return {
        error: true,
        message: `Route '${route}' could not be validated: No router modules found in the project. Use s.record(...).router(...) to define router modules.`,
      };
    }

    // Filter routes by include/exclude patterns for suggestions
    allRoutes = filterRoutesByPatterns(allRoutes, include, exclude);

    const alternatives = findSimilar(route, allRoutes);

    return {
      error: true,
      message: `Route '${route}' does not exist in any router module. ${
        alternatives.length > 0
          ? `Closest match: '${alternatives[0].target}'. Other similar: ${alternatives
              .slice(1, 4)
              .map((a) => `'${a.target}'`)
              .join(", ")}${alternatives.length > 4 ? ", ..." : ""}`
          : "No similar routes found."
      }`,
    };
  }

  // 3. Validate against include/exclude patterns
  const patternValidation = validateRoutePatterns(route, include, exclude);
  if (!patternValidation.valid) {
    return {
      error: true,
      message: patternValidation.message,
    };
  }

  return { error: false };
}

/**
 * Handler for router:check-route validation fix
 */
export async function handleRouteCheck(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  const { sourcePath, validationError, service, valFiles, routerModulesCache } =
    ctx;

  // Extract route and patterns from validation error value
  const value = validationError.value as
    | {
        route: unknown;
        include?: { source: string; flags: string };
        exclude?: { source: string; flags: string };
      }
    | undefined;

  if (!value || typeof value.route !== "string") {
    return {
      success: false,
      errorMessage: `Invalid route value in validation error: ${JSON.stringify(value)}`,
    };
  }

  const route = value.route;

  // Check if the route is valid
  const result = await checkRouteIsValid(
    route,
    value.include,
    value.exclude,
    service,
    valFiles,
    routerModulesCache,
  );

  if (result.error) {
    return {
      success: false,
      errorMessage: `${sourcePath}: ${result.message}`,
    };
  }

  return { success: true };
}

// Fix handler registry
export const currentFixHandlers: Record<ValidationFix, FixHandler> = {
  "image:check-metadata": handleFileMetadata,
  "image:add-metadata": handleFileMetadata,
  "file:check-metadata": handleFileMetadata,
  "file:add-metadata": handleFileMetadata,
  "keyof:check-keys": handleKeyOfCheck,
  "router:check-route": handleRouteCheck,
  "image:upload-remote": handleRemoteFileUpload,
  "file:upload-remote": handleRemoteFileUpload,
  "image:download-remote": handleRemoteFileDownload,
  "file:download-remote": handleRemoteFileDownload,
  "image:check-remote": handleRemoteFileCheck,
  "images:check-remote": handleRemoteFileCheck,
  "file:check-remote": handleRemoteFileCheck,
  "files:check-remote": handleRemoteFileCheck,
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

  let errors = 0;

  // Create caches that persist across all file validations
  const keyOfCache: KeyOfCache = new Map();
  const routerModulesCache: RouterModulesCache = {
    loaded: false,
    modules: {},
  };

  async function* validateFile(file: string): AsyncGenerator<ValidationEvent> {
    const moduleFilePath = `/${file}` as ModuleFilePath; // TODO: check if this always works? (Windows?)
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
          for (const [sourcePath, validationErrors] of Object.entries(
            valModule.errors.validation,
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
                keyOfCache,
                routerModulesCache,
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

// GPT generated levenshtein distance algorithm:
export const levenshtein = (a: string, b: string): number => {
  const [m, n] = [a.length, b.length];
  if (!m || !n) return Math.max(m, n);

  const dp = Array.from({ length: m + 1 }, (_, i) => i);

  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;

    for (let i = 1; i <= m; i++) {
      const temp = dp[i];
      dp[i] =
        a[i - 1] === b[j - 1]
          ? prev
          : Math.min(prev + 1, dp[i - 1] + 1, dp[i] + 1);
      prev = temp;
    }
  }

  return dp[m];
};

export function findSimilar(key: string, targets: string[]) {
  return targets
    .map((target) => ({ target, distance: levenshtein(key, target) }))
    .sort((a, b) => a.distance - b.distance);
}
