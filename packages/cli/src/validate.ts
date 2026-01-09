import path from "path";
import {
  createFixPatch,
  createService,
  getSettings,
  getPersonalAccessTokenPath,
  parsePersonalAccessTokenFile,
  uploadRemoteFile,
  Service,
} from "@valbuild/server";
import {
  DEFAULT_CONTENT_HOST,
  DEFAULT_VAL_REMOTE_HOST,
  FILE_REF_PROP,
  Internal,
  ModuleFilePath,
  ModulePath,
  SerializedFileSchema,
  SerializedImageSchema,
  SourcePath,
  ValidationFix,
} from "@valbuild/core";
import { glob } from "fast-glob";
import picocolors from "picocolors";
import fs from "fs/promises";
import { evalValConfigFile } from "./utils/evalValConfigFile";
import { getFileExt } from "./utils/getFileExt";

const textEncoder = new TextEncoder();

// Types for handler system
type ValModule = Awaited<ReturnType<Service["get"]>>;

type ValidationError = {
  message: string;
  value?: unknown;
  fixes?: ValidationFix[];
};

type FixHandlerContext = {
  sourcePath: SourcePath;
  validationError: ValidationError;
  valModule: ValModule;
  projectRoot: string;
  fix: boolean;
  service: Service;
  valFiles: string[];
  moduleFilePath: ModuleFilePath;
  file: string;
  // Shared state
  remoteFiles: Record<
    SourcePath,
    { ref: string; metadata?: Record<string, unknown> }
  >;
  publicProjectId?: string;
  remoteFileBuckets?: string[];
  remoteFilesCounter: number;
  valRemoteHost: string;
  contentHostUrl: string;
  valConfigFile?: { project?: string };
};

type FixHandlerResult = {
  success: boolean;
  errorMessage?: string;
  shouldApplyPatch?: boolean;
  // Updated shared state
  publicProjectId?: string;
  remoteFileBuckets?: string[];
  remoteFilesCounter?: number;
};

type FixHandler = (ctx: FixHandlerContext) => Promise<FixHandlerResult>;

// Handler functions
async function handleFileMetadata(
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

  let filePath: string | null = null;
  try {
    filePath = path.join(
      ctx.projectRoot,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fileSource.source as any)?.[FILE_REF_PROP],
    );
    await fs.access(filePath);
  } catch {
    if (filePath) {
      return {
        success: false,
        errorMessage: `File ${filePath} does not exist`,
      };
    } else {
      return {
        success: false,
        errorMessage: `Expected file to be defined at: ${ctx.sourcePath} but no file was found`,
      };
    }
  }

  return { success: true, shouldApplyPatch: true };
}

async function handleKeyOfCheck(
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

  const res = await checkKeyIsValid(key, sourcePath, ctx.service);
  if (res.error) {
    return {
      success: false,
      errorMessage: res.message,
    };
  }

  return { success: true };
}

async function handleRemoteFileUpload(
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

  let filePath: string | null = null;
  try {
    filePath = path.join(
      ctx.projectRoot,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (resolvedRemoteFileAtSourcePath.source as any)?.[FILE_REF_PROP],
    );
    await fs.access(filePath);
  } catch {
    if (filePath) {
      return {
        success: false,
        errorMessage: `File ${filePath} does not exist`,
      };
    } else {
      return {
        success: false,
        errorMessage: `Expected file to be defined at: ${ctx.sourcePath} but no file was found`,
      };
    }
  }

  const patFile = getPersonalAccessTokenPath(ctx.projectRoot);
  try {
    await fs.access(patFile);
  } catch {
    return {
      success: false,
      errorMessage: `File: ${path.join(ctx.projectRoot, ctx.file)} has remote images that are not uploaded and you are not logged in.\n\nFix this error by logging in:\n\t"npx val login"\n`,
    };
  }

  const parsedPatFile = parsePersonalAccessTokenFile(
    await fs.readFile(patFile, "utf-8"),
  );
  if (!parsedPatFile.success) {
    return {
      success: false,
      errorMessage: `Error parsing personal access token file: ${parsedPatFile.error}. You need to login again.`,
    };
  }
  const { pat } = parsedPatFile.data;

  if (ctx.remoteFiles[ctx.sourcePath]) {
    console.log(
      picocolors.yellow("⚠"),
      `Remote file ${filePath} already uploaded`,
    );
    return { success: true };
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

  let publicProjectId = ctx.publicProjectId;
  let remoteFileBuckets = ctx.remoteFileBuckets;
  let remoteFilesCounter = ctx.remoteFilesCounter;

  if (!publicProjectId || !remoteFileBuckets) {
    let projectName = process.env.VAL_PROJECT;
    if (!projectName) {
      projectName = ctx.valConfigFile?.project;
    }
    if (!projectName) {
      return {
        success: false,
        errorMessage:
          "Project name not found. Set VAL_PROJECT environment variable or add project name to val.config",
      };
    }
    const settingsRes = await getSettings(projectName, { pat });
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

  if (!ctx.valConfigFile?.project) {
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

  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(filePath);
  } catch (e) {
    return {
      success: false,
      errorMessage: `Error reading file: ${e}`,
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
  const ref = Internal.remote.createRemoteRef(ctx.valRemoteHost, {
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

  console.log(picocolors.yellow("⚠"), `Uploading remote file: '${ref}'...`);

  const remoteFileUpload = await uploadRemoteFile(
    ctx.contentHostUrl,
    ctx.valConfigFile.project,
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

  console.log(
    picocolors.green("✔"),
    `Completed upload of remote file: '${ref}'`,
  );

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
  };
}

async function handleRemoteFileDownload(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  if (ctx.fix) {
    console.log(
      picocolors.yellow("⚠"),
      `Downloading remote file in ${ctx.sourcePath}...`,
    );
    return { success: true, shouldApplyPatch: true };
  } else {
    return {
      success: false,
      errorMessage: `Remote file ${ctx.sourcePath} needs to be downloaded (use --fix to download)`,
    };
  }
}

async function handleRemoteFileCheck(): Promise<FixHandlerResult> {
  // Skip - no action needed
  return { success: true, shouldApplyPatch: true };
}

// Helper function
async function checkKeyIsValid(
  key: string,
  sourcePath: string,
  service: Service,
): Promise<{ error: false } | { error: true; message: string }> {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);
  const keyOfModule = await service.get(moduleFilePath, modulePath, {
    source: true,
    schema: false,
    validate: false,
  });

  const keyOfModuleSource = keyOfModule.source;
  const keyOfModuleSchema = keyOfModule.schema;
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
async function checkRouteIsValid(
  route: string,
  include: { source: string; flags: string } | undefined,
  exclude: { source: string; flags: string } | undefined,
  service: Service,
  valFiles: string[],
): Promise<{ error: false } | { error: true; message: string }> {
  // Reconstruct RegExp from serialized form
  const includePattern = include
    ? new RegExp(include.source, include.flags)
    : undefined;
  const excludePattern = exclude
    ? new RegExp(exclude.source, exclude.flags)
    : undefined;

  // 1. Scan all val files to find modules with routers
  const routerModules: Record<string, Record<string, unknown>> = {};

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
        routerModules[moduleFilePath] = valModule.source as Record<
          string,
          unknown
        >;
      }
    }
  }

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
    allRoutes = allRoutes.filter((r) => {
      if (includePattern && !includePattern.test(r)) {
        return false;
      }
      if (excludePattern && excludePattern.test(r)) {
        return false;
      }
      return true;
    });

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

  // 3. Validate against include pattern if provided
  if (includePattern && !includePattern.test(route)) {
    return {
      error: true,
      message: `Route '${route}' does not match include pattern: ${includePattern}`,
    };
  }

  // 4. Validate against exclude pattern if provided
  if (excludePattern && excludePattern.test(route)) {
    return {
      error: true,
      message: `Route '${route}' matches exclude pattern: ${excludePattern}`,
    };
  }

  return { error: false };
}

/**
 * Handler for router:check-route validation fix
 */
async function handleRouteCheck(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  const { sourcePath, validationError, service, valFiles } = ctx;

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
  );

  if (result.error) {
    return {
      success: false,
      errorMessage: `${sourcePath}: ${result.message}`,
    };
  }

  // Route is valid - no fix needed
  console.log(
    picocolors.green("✓"),
    `Route '${route}' is valid in`,
    sourcePath,
  );
  return { success: true };
}

// Fix handler registry
const currentFixHandlers: Record<ValidationFix, FixHandler> = {
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
  "file:check-remote": handleRemoteFileCheck,
};
const deprecatedFixHandlers: Record<string, FixHandler> = {
  "image:replace-metadata": handleFileMetadata,
};
const fixHandlers: Record<string, FixHandler> = {
  ...deprecatedFixHandlers,
  ...currentFixHandlers,
};

export async function validate({
  root,
  fix,
}: {
  root?: string;
  fix?: boolean;
}) {
  const valRemoteHost = process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST;
  const contentHostUrl = process.env.VAL_CONTENT_URL || DEFAULT_CONTENT_HOST;
  const projectRoot = root ? path.resolve(root) : process.cwd();
  const valConfigFile =
    (await evalValConfigFile(projectRoot, "val.config.ts")) ||
    (await evalValConfigFile(projectRoot, "val.config.js"));
  console.log(
    picocolors.greenBright(
      `Validating project${valConfigFile?.project ? ` '${picocolors.inverse(valConfigFile?.project)}'` : ""}...`,
    ),
  );
  const service = await createService(projectRoot, {});
  let prettier;
  try {
    prettier = (await import("prettier")).default;
  } catch {
    console.log("Prettier not found, skipping formatting");
  }

  const valFiles: string[] = await glob("**/*.val.{js,ts}", {
    ignore: ["node_modules/**"],
    cwd: projectRoot,
  });

  let errors = 0;
  console.log(picocolors.greenBright(`Found ${valFiles.length} files...`));
  let publicProjectId: string | undefined;
  let didFix = false;
  async function validateFile(file: string): Promise<number> {
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
      console.log(
        picocolors.green("✔"),
        moduleFilePath,
        "is valid (" + (Date.now() - start) + "ms)",
      );
      return 0;
    } else {
      let errors = 0;
      let fixedErrors = 0;
      if (valModule.errors) {
        if (valModule.errors.validation) {
          for (const [sourcePath, validationErrors] of Object.entries(
            valModule.errors.validation,
          )) {
            for (const v of validationErrors) {
              if (!v.fixes || v.fixes.length === 0) {
                // No fixes available - just report error
                errors += 1;
                console.log(
                  picocolors.red("✘"),
                  "Got error in",
                  `${sourcePath}:`,
                  v.message,
                );
                continue;
              }

              // Find and execute appropriate handler
              const fixType = v.fixes[0]; // Take first fix
              const handler = fixHandlers[fixType];

              if (!handler) {
                console.log(
                  picocolors.red("✘"),
                  "Unknown fix",
                  v.fixes,
                  "for",
                  sourcePath,
                );
                errors += 1;
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
                remoteFiles,
                publicProjectId,
                remoteFileBuckets,
                remoteFilesCounter,
                valRemoteHost,
                contentHostUrl,
                valConfigFile: valConfigFile ?? undefined,
              });

              // Update shared state from handler result
              if (result.publicProjectId !== undefined) {
                publicProjectId = result.publicProjectId;
              }
              if (result.remoteFileBuckets !== undefined) {
                remoteFileBuckets = result.remoteFileBuckets;
              }
              if (result.remoteFilesCounter !== undefined) {
                remoteFilesCounter = result.remoteFilesCounter;
              }

              if (!result.success) {
                console.log(picocolors.red("✘"), result.errorMessage);
                errors += 1;
                continue;
              }

              // Apply patch if needed
              if (result.shouldApplyPatch) {
                const fixPatch = await createFixPatch(
                  { projectRoot, remoteHost: valRemoteHost },
                  !!fix,
                  sourcePath as SourcePath,
                  v,
                  remoteFiles,
                  valModule.source,
                  valModule.schema,
                );

                if (fix && fixPatch?.patch && fixPatch?.patch.length > 0) {
                  await service.patch(moduleFilePath, fixPatch.patch);
                  didFix = true;
                  fixedErrors += 1;
                  console.log(
                    picocolors.yellow("⚠"),
                    "Applied fix for",
                    sourcePath,
                  );
                }

                fixPatch?.remainingErrors?.forEach((e) => {
                  errors += 1;
                  console.log(
                    e.fixes && e.fixes.length
                      ? picocolors.yellow("⚠")
                      : picocolors.red("✘"),
                    `Got ${e.fixes && e.fixes.length ? "fixable " : ""}error in`,
                    `${sourcePath}:`,
                    e.message,
                  );
                });
              }
            }
          }
        }
        if (
          fixedErrors === errors &&
          (!valModule.errors.fatal || valModule.errors.fatal.length == 0)
        ) {
          console.log(
            picocolors.green("✔"),
            moduleFilePath,
            "is valid (" + (Date.now() - start) + "ms)",
          );
        }
        for (const fatalError of valModule.errors.fatal || []) {
          errors += 1;
          console.log(
            picocolors.red("✘"),
            moduleFilePath,
            "is invalid:",
            fatalError.message,
          );
        }
      } else {
        console.log(
          picocolors.green("✔"),
          moduleFilePath,
          "is valid (" + (Date.now() - start) + "ms)",
        );
      }
      if (errors > 0) {
        console.log(
          picocolors.red("✘"),
          `${`/${file}`} contains ${errors} error${errors > 1 ? "s" : ""}`,
          " (" + (Date.now() - start) + "ms)",
        );
      }
      return errors;
    }
  }

  for (const file of valFiles.sort()) {
    didFix = false;
    errors += await validateFile(file);
    if (prettier && didFix) {
      const filePath = path.join(projectRoot, file);
      const fileContent = await fs.readFile(filePath, "utf-8");
      const formattedContent = await prettier?.format(fileContent, {
        filepath: filePath,
      });
      await fs.writeFile(filePath, formattedContent);
    }
  }
  if (errors > 0) {
    console.log(
      picocolors.red("✘"),
      "Got",
      errors,
      "error" + (errors > 1 ? "s" : ""),
    );
    process.exit(1);
  } else {
    console.log(picocolors.green("✔"), "No validation errors found");
  }

  service.dispose();
  return;
}

// GPT generated levenshtein distance algorithm:
const levenshtein = (a: string, b: string): number => {
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

function findSimilar(key: string, targets: string[]) {
  return targets
    .map((target) => ({ target, distance: levenshtein(key, target) }))
    .sort((a, b) => a.distance - b.distance);
}
