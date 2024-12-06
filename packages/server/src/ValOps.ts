/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  FILE_REF_PROP,
  FileMetadata,
  FileSchema,
  FileSource,
  ImageMetadata,
  ImageSchema,
  Internal,
  ModuleFilePath,
  PatchId,
  RichTextSchema,
  Schema,
  SelectorSource,
  SerializedSchema,
  Source,
  SourcePath,
  VAL_EXTENSION,
  ValConfig,
  ValModules,
  ValidationError,
  ValidationErrors,
} from "@valbuild/core";
import { pipe, result } from "@valbuild/core/fp";
import {
  JSONOps,
  JSONValue,
  ParentRef,
  Patch,
  PatchError,
  applyPatch,
  deepClone,
} from "@valbuild/core/patch";
import { TSOps } from "./patch/ts/ops";
import { analyzeValModule } from "./patch/ts/valModule";
import ts from "typescript";
import { ValSyntaxError, ValSyntaxErrorTree } from "./patch/ts/syntax";
import sizeOf from "image-size";
import { ParentPatchId } from "@valbuild/core";

export type BaseSha = string & { readonly _tag: unique symbol };
export type SchemaSha = string & { readonly _tag: unique symbol };
export type CommitSha = string & { readonly _tag: unique symbol };
export type AuthorId = string & { readonly _tag: unique symbol };
export type ModulesError = { message: string; path?: ModuleFilePath };

export type Schemas = {
  [key: ModuleFilePath]: Schema<SelectorSource>;
};

export type Sources = {
  [key: ModuleFilePath]: Source;
};

const textEncoder = new TextEncoder();
const jsonOps = new JSONOps();
const tsOps = new TSOps((document) => {
  return pipe(
    analyzeValModule(document),
    result.map(({ source }) => source),
  );
});

export type ValOpsOptions = {
  formatter?: (code: string, filePath: string) => string | Promise<string>;
  statPollingInterval?: number;
  statFilePollingInterval?: number;
  disableFilePolling?: boolean;
  disableFileWatcher?: boolean;
  config: ValConfig;
};
// #region ValOps
export abstract class ValOps {
  /** Sources from val modules, immutable (without patches or anything)  */
  private sources: Sources | null;
  /** The sha256 / hash of sources + schema + config */
  private baseSha: BaseSha | null;
  /** Schema from val modules, immutable  */
  private schemas: Schemas | null;
  /** The sha256 / hash of schema + config - if this changes users needs to reload */
  private schemaSha: SchemaSha | null;
  private modulesErrors: ModulesError[] | null;

  constructor(
    private readonly valModules: ValModules,
    protected readonly options?: ValOpsOptions,
  ) {
    this.sources = null;
    this.baseSha = null;
    this.schemas = null;
    this.schemaSha = null;
    this.modulesErrors = null;
  }

  private hash(input: string | object): string {
    if (typeof input === "object") {
      return this.hashObject(input);
    }
    return Internal.getSHA256Hash(textEncoder.encode(input));
  }

  private hashObject(obj: object): string {
    const collector: string[] = [];
    this.collectObjectRecursive(obj, collector);
    return Internal.getSHA256Hash(textEncoder.encode(collector.join("")));
  }

  private collectObjectRecursive(
    item: object | string | number,
    collector: string[],
  ): void {
    if (typeof item === "string") {
      collector.push(`"`, item, `"`);
      return;
    } else if (typeof item === "number") {
      collector.push(item.toString());
      return;
    } else if (typeof item === "object") {
      if (Array.isArray(item)) {
        collector.push("[");
        for (let i = 0; i < item.length; i++) {
          this.collectObjectRecursive(item[i], collector);
          i !== item.length - 1 && collector.push(",");
        }
        collector.push("]");
      } else {
        collector.push("{");
        const keys = Object.keys(item).sort();
        keys.forEach((key, i) => {
          collector.push(`"${key}":`);
          this.collectObjectRecursive(
            (item as Record<string, string | number | object>)[key],
            collector,
          );
          i !== keys.length - 1 && collector.push(",");
        });
        collector.push("}");
      }
      return;
    } else {
      console.warn(
        "Unknown type encountered when hashing object",
        typeof item,
        item,
      );
    }
  }

  // #region stat
  /**
   * Get the status from Val
   *
   * This works differently in ValOpsFS and ValOpsHttp:
   * - In ValOpsFS (for dev mode) works using long-polling operations since we cannot use WebSockets in the host Next.js server and we do not want to hammer the server with requests (though we could argue that it would be ok in dev, it is not up to our standards as a kick-ass CMS).
   * - In ValOpsHttp (in production) it returns a WebSocket URL so that the client can connect directly.
   *
   * The reason we do not use long polling in production is that Vercel (a very likely host for Next.js), bills by wall time and long polling would therefore be very expensive.
   */
  abstract getStat(
    params: {
      baseSha: BaseSha;
      schemaSha: SchemaSha;
      patches?: PatchId[];
      profileId?: AuthorId;
      // TODO: deployments: Record<DeploymentId, "deployed" | "deploying" | "failed">
    } | null,
  ): Promise<
    | {
        type: "request-again" | "no-change" | "did-change";
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        patches: PatchId[];
      }
    | {
        type: "use-websocket";
        url: string;
        nonce: string;
        baseSha: BaseSha;
        schemaSha: SchemaSha;
        commitSha: CommitSha;
        patches: PatchId[];
      }
    | {
        type: "error";
        error: GenericErrorMessage;
        unauthorized?: boolean;
        networkError?: boolean;
      }
  >;

  // #region initTree
  private async initSources(): Promise<{
    baseSha: BaseSha;
    schemaSha: SchemaSha;
    sources: Sources;
    schemas: Schemas;
    moduleErrors: ModulesError[];
  }> {
    if (
      this.baseSha === null ||
      this.schemaSha === null ||
      this.sources === null ||
      this.schemas === null ||
      this.modulesErrors === null
    ) {
      const currentModulesErrors: ModulesError[] = [];
      const addModuleError = (
        message: string,
        index: number,
        path?: SourcePath,
      ) => {
        currentModulesErrors[index] = {
          message,
          path: path as string as ModuleFilePath,
        };
      };
      const currentSources: Sources = {};
      const currentSchemas: Schemas = {};
      let baseSha = this.hash(JSON.stringify(this.valModules.config));
      let schemaSha = baseSha;
      for (
        let moduleIdx = 0;
        moduleIdx < this.valModules.modules.length;
        moduleIdx++
      ) {
        const module = this.valModules.modules[moduleIdx];
        if (!module.def) {
          addModuleError("val.modules is missing 'def' property", moduleIdx);
          continue;
        }
        if (typeof module.def !== "function") {
          addModuleError(
            "val.modules 'def' property is not a function",
            moduleIdx,
          );
          continue;
        }
        await module.def().then((value) => {
          if (!value) {
            addModuleError(
              `val.modules 'def' did not return a value`,
              moduleIdx,
            );
            return;
          }
          if (!value.default) {
            addModuleError(
              `val.modules 'def' did not return a default export`,
              moduleIdx,
            );
            return;
          }

          const path = Internal.getValPath(value.default);
          if (path === undefined) {
            addModuleError(`path is undefined`, moduleIdx);
            return;
          }
          const schema = Internal.getSchema(value.default);
          if (schema === undefined) {
            addModuleError(
              `schema in path '${path}' is undefined`,
              moduleIdx,
              path,
            );
            return;
          }
          if (!(schema instanceof Schema)) {
            addModuleError(
              `schema in path '${path}' is not an instance of Schema`,
              moduleIdx,
              path,
            );
            return;
          }
          if (typeof schema.serialize !== "function") {
            addModuleError(
              `schema.serialize in path '${path}' is not a function`,
              moduleIdx,
              path,
            );
            return;
          }
          const source = Internal.getSource(value.default);
          if (source === undefined) {
            addModuleError(`source in ${path} is undefined`, moduleIdx, path);
            return;
          }
          let serializedSchema: SerializedSchema;
          try {
            serializedSchema = schema.serialize();
          } catch (e) {
            const message = e instanceof Error ? e.message : JSON.stringify(e);
            addModuleError(
              `Could not serialize module: '${path}'. Error: ${message}`,
              moduleIdx,
              path,
            );
            return;
          }
          const pathM = path as string as ModuleFilePath;
          currentSources[pathM] = source;
          currentSchemas[pathM] = schema;
          // make sure the checks above is enough that this does not fail - even if val modules are not set up correctly
          baseSha = this.hash(
            baseSha +
              JSON.stringify({
                path,
                schema: serializedSchema,
                source,
                modulesErrors: currentModulesErrors,
              }),
          );
          schemaSha = this.hash(schemaSha + JSON.stringify(serializedSchema));
        });
      }
      this.sources = currentSources;
      this.schemas = currentSchemas;
      this.baseSha = baseSha as BaseSha;
      this.schemaSha = schemaSha as SchemaSha;
      this.modulesErrors = currentModulesErrors;
    }
    return {
      baseSha: this.baseSha,
      schemaSha: this.schemaSha,
      sources: this.sources,
      schemas: this.schemas,
      moduleErrors: this.modulesErrors,
    };
  }

  async init(): Promise<void> {
    const { baseSha, schemaSha } = await this.initSources();
    await this.onInit(baseSha, schemaSha);
  }

  async getBaseSources(): Promise<Sources> {
    return this.initSources().then((result) => result.sources);
  }
  async getSchemas(): Promise<Schemas> {
    return this.initSources().then((result) => result.schemas);
  }
  async getModuleErrors(): Promise<ModulesError[]> {
    return this.initSources().then((result) => result.moduleErrors);
  }
  async getBaseSha(): Promise<BaseSha> {
    return this.initSources().then((result) => result.baseSha);
  }
  async getSchemaSha(): Promise<SchemaSha> {
    return this.initSources().then((result) => result.schemaSha);
  }

  // #region analyzePatches
  analyzePatches(
    sortedPatches: OrderedPatches["patches"],
    commits?: {
      commitSha: CommitSha;
      clientCommitSha: CommitSha;
      parentCommitSha: CommitSha;
      branch: string;
      creator: AuthorId;
      createdAt: string;
    }[],
    currentCommitSha?: CommitSha,
  ): PatchAnalysis {
    const patchesByModule: {
      [path: ModuleFilePath]: {
        patchId: PatchId;
      }[];
    } = {};
    const fileLastUpdatedByPatchId: Record<string, PatchId> = {};
    for (const patch of sortedPatches) {
      if (patch.appliedAt) {
        continue;
      }
      for (const op of patch.patch) {
        if (op.op === "file") {
          const filePath = op.filePath;
          fileLastUpdatedByPatchId[filePath] = patch.patchId;
        }
        const path = patch.path;
        if (!patchesByModule[path]) {
          patchesByModule[path] = [];
        }
        patchesByModule[path].push({ patchId: patch.patchId });
      }
    }
    return {
      patchesByModule,
      fileLastUpdatedByPatchId,
    };
  }

  // #region getTree
  async getSources(analysis?: PatchAnalysis & OrderedPatches): Promise<{
    sources: Sources;
    errors: Record<
      ModuleFilePath,
      {
        patchId: PatchId;
        skipped: boolean;
        error: GenericErrorMessage;
      }[]
    >;
  }> {
    if (!analysis) {
      const { sources } = await this.initSources();
      return { sources, errors: {} };
    }
    const { sources } = await this.initSources();

    const patchedSources: Sources = {};
    const errors: Record<
      ModuleFilePath,
      {
        patchId: PatchId;
        skipped: boolean;
        error: GenericErrorMessage;
      }[]
    > = {};
    for (const patchData of analysis.patches) {
      const path = patchData.path;
      if (sources[path] === undefined) {
        if (!errors[path]) {
          errors[path] = [];
        }
        console.error("Module not found", path);
        errors[path].push({
          patchId: patchData.patchId,
          skipped: true,
          error: new PatchError(`Module not found`),
        });
        continue;
      }
      if (!patchedSources[path]) {
        patchedSources[path] = sources[path];
      }
      const patchId = patchData.patchId;
      if (errors[path]) {
        console.error(
          "Cannot apply patch: previous errors exists",
          path,
          errors[path],
        );
        errors[path].push({
          patchId: patchId,
          skipped: true,
          error: new PatchError(`Cannot apply patch: previous errors exists`),
        });
      } else {
        const applicableOps: Patch = [];
        const fileFixOps: Record<string, Patch> = {};
        for (const op of patchData.patch) {
          if (op.op === "file") {
            // NOTE: We insert the last patch_id that modify a file
            // when constructing the url we use the patch id (and the file path)
            // to fetch the right file
            // NOTE: overwrite and use last patch_id if multiple patches modify the same file
            fileFixOps[op.path.join("/")] = [
              {
                op: "add",
                path: op.path
                  .concat(...(op.nestedFilePath || []))
                  .concat("patch_id"),
                value: patchId,
              },
            ];
          } else {
            applicableOps.push(op);
          }
        }
        const patchRes = applyPatch(
          deepClone(patchedSources[path]) as JSONValue, // applyPatch mutates the source. On add operations it adds more than once? There is something strange going on... deepClone seems to fix, but is that the right solution?
          jsonOps,
          applicableOps.concat(...Object.values(fileFixOps)),
        );
        if (result.isErr(patchRes)) {
          console.error(
            "Could not apply patch",
            JSON.stringify(
              {
                path,
                patchId,
                error: patchRes.error,
                applicableOps,
              },
              null,
              2,
            ),
          );
          if (!errors[path]) {
            errors[path] = [];
          }
          errors[path].push({
            patchId: patchId,
            skipped: false,
            error: patchRes.error,
          });
        } else {
          patchedSources[path] = patchRes.value;
        }
      }
    }
    return { sources: patchedSources, errors };
  }

  // #region validateSources
  async validateSources(
    schemas: Schemas,
    sources: Sources,
    patchesByModule?: PatchAnalysis["patchesByModule"],
  ): Promise<{
    errors: Record<
      ModuleFilePath,
      {
        invalidSource?: { message: string };
        validations: Record<SourcePath, ValidationError[]>;
      }
    >;
    files: Record<SourcePath, FileSource>;
  }> {
    const errors: Record<
      ModuleFilePath,
      {
        invalidSource?: { message: string };
        validations: Record<SourcePath, ValidationError[]>;
      }
    > = {};
    const files: Record<SourcePath, FileSource> = {};
    const entries = Object.entries(schemas);
    const modulePathsToValidate =
      patchesByModule && Object.keys(patchesByModule);
    for (const [pathS, schema] of entries) {
      if (modulePathsToValidate && !modulePathsToValidate.includes(pathS)) {
        continue;
      }
      const path = pathS as ModuleFilePath;
      const source = sources[path];
      if (source === undefined) {
        if (!errors[path]) {
          errors[path] = { validations: {} };
        }
        errors[path] = {
          ...errors[path],
          invalidSource: {
            message: `Module at path: '${path}' does not exist`,
          },
        };
        continue;
      }
      const res = schema.validate(path as string as SourcePath, source);
      if (res === false) {
        continue;
      }
      for (const [sourcePathS, validationErrors] of Object.entries(res)) {
        const sourcePath = sourcePathS as SourcePath;
        if (validationErrors) {
          for (const validationError of validationErrors) {
            if (isOnlyFileCheckValidationError(validationError)) {
              if (files[sourcePath]) {
                throw new Error(
                  "Cannot have multiple files with same path. Path: " +
                    sourcePath +
                    "; Module: " +
                    path,
                );
              }
              const value = validationError.value;
              if (isFileSource(value)) {
                files[sourcePath] = value;
              }
            } else {
              if (!errors[path]) {
                errors[path] = { validations: {} };
              }
              if (!errors[path].validations[sourcePath]) {
                errors[path].validations[sourcePath] = [];
              }
              errors[path].validations[sourcePath].push(validationError);
            }
          }
        }
      }
    }
    return { errors, files };
  }

  // #region validateFiles
  async validateFiles(
    schemas: Schemas,
    sources: Sources,
    files: Record<SourcePath, FileSource>,
    fileLastUpdatedByPatchId?: PatchAnalysis["fileLastUpdatedByPatchId"],
  ): Promise<Record<SourcePath, ValidationError[]>> {
    const validateFileAtSourcePath = async (
      sourcePath: SourcePath,
      value: FileSource,
    ): Promise<ValidationErrors> => {
      const [fullModulePath, modulePath] =
        Internal.splitModuleFilePathAndModulePath(sourcePath);
      const schema = schemas[fullModulePath];
      if (!schema) {
        return {
          [sourcePath]: [
            {
              message: `Schema not found for path: '${fullModulePath}'`,
              value,
            } satisfies ValidationError,
          ],
        };
      }

      const source = sources[fullModulePath];
      if (!source) {
        return {
          [sourcePath]: [
            {
              message: `Source not found for path: '${fullModulePath}'`,
              value,
            } satisfies ValidationError,
          ],
        };
      }

      let schemaAtPath;
      try {
        const { schema: resolvedSchema } = Internal.resolvePath(
          modulePath,
          sources[fullModulePath],
          schemas[fullModulePath],
        );
        schemaAtPath = resolvedSchema;
      } catch (e) {
        if (e instanceof Error) {
          return {
            [sourcePath]: [
              {
                message: `Could not resolve schema at path: ${modulePath}. Error: ${e.message}`,
                value,
              } satisfies ValidationError,
            ],
          };
        }
        return {
          [sourcePath]: [
            {
              message: `Could not resolve schema at path: ${modulePath}. Unknown error.`,
              value,
            } satisfies ValidationError,
          ],
        };
      }
      const type = schemaAtPath instanceof ImageSchema ? "image" : "file";
      const filePath = value[FILE_REF_PROP];
      const patchId: PatchId | null =
        fileLastUpdatedByPatchId?.[filePath] || null;
      let metadata;
      let metadataErrors;

      // TODO: refactor so we call get metadata once instead of iterating like this. Reason: should be a lot faster
      if (patchId) {
        const patchFileMetadata =
          await this.getBase64EncodedBinaryFileMetadataFromPatch(
            filePath,
            type,
            patchId,
          );
        if (patchFileMetadata.errors) {
          metadataErrors = patchFileMetadata.errors;
        } else {
          metadata = patchFileMetadata.metadata;
        }
      } else {
        const patchFileMetadata = await this.getBinaryFileMetadata(
          filePath,
          type,
        );
        if (patchFileMetadata.errors) {
          metadataErrors = patchFileMetadata.errors;
        } else {
          metadata = patchFileMetadata.metadata;
        }
      }
      if (metadataErrors && metadataErrors.length > 0) {
        return {
          [sourcePath]: metadataErrors.map((e) => ({
            message: e.message,
            value: { filePath, patchId },
          })),
        };
      }
      if (!metadata) {
        return {
          [sourcePath]: [
            {
              message: "Unexpectedly got no metadata",
              value: { filePath },
            } satisfies ValidationError,
          ],
        };
      }
      const metadataSourcePath = Internal.createValPathOfItem(
        sourcePath,
        "metadata",
      );
      if (!metadataSourcePath) {
        throw new Error("Could not create metadata path");
      }
      const currentValueMetadata = value.metadata;
      if (!currentValueMetadata) {
        return {
          [metadataSourcePath]: [
            {
              message: "Missing metadata field: 'metadata'",
              value,
            } satisfies ValidationError,
          ],
        };
      }

      const fieldErrors: Record<SourcePath, ValidationError[]> = {};
      for (const field of getFieldsForType(type)) {
        const fieldMetadata = metadata[field];
        const fieldSourcePath = Internal.createValPathOfItem(
          metadataSourcePath,
          field,
        );
        if (!fieldSourcePath) {
          throw new Error("Could not create field path");
        }
        if (!(field in currentValueMetadata)) {
          return {
            [fieldSourcePath]: [
              {
                message: `Missing metadata field: '${field}'`,
                value,
              } satisfies ValidationError,
            ],
          };
        }
        if (fieldMetadata !== currentValueMetadata[field]) {
          fieldErrors[fieldSourcePath] = [
            {
              message: `Metadata field '${field}' of value: ${JSON.stringify(
                currentValueMetadata[field],
              )} does not match expected value: ${JSON.stringify(
                fieldMetadata,
              )}`,
              value: {
                actual: currentValueMetadata[field],
                expected: fieldMetadata,
              },
              fixes: ["image:check-metadata"],
            },
          ];
        }
      }
      return fieldErrors;
    };

    const allErrors: [SourcePath, ValidationError[]][] = (
      await Promise.all(
        Object.entries(files).map(([sourcePathS, value]) =>
          validateFileAtSourcePath(sourcePathS as SourcePath, value).then(
            (res) => {
              if (res) {
                return Object.entries(res) as [SourcePath, ValidationError[]][];
              } else {
                return [];
              }
            },
          ),
        ),
      )
    ).flat();
    return Object.fromEntries(allErrors);
  }

  // #region prepareCommit
  async prepare(
    patchAnalysis: PatchAnalysis & OrderedPatches,
  ): Promise<PreparedCommit> {
    const { patchesByModule, fileLastUpdatedByPatchId } = patchAnalysis;
    const patchedSourceFiles: Record<ModuleFilePath, string> = {};
    const previousSourceFiles: Record<ModuleFilePath, string> = {};

    const applySourceFilePatches = async (
      path: ModuleFilePath,
      patches: { patchId: PatchId }[],
    ): Promise<
      | {
          path: ModuleFilePath;
          result: string;
          appliedPatches: PatchId[];
          errors?: undefined;
        }
      | {
          path: ModuleFilePath;
          appliedPatches?: PatchId[];
          triedPatches?: PatchId[];
          skippedPatches?: PatchId[];
          errors: PatchSourceError[];
        }
    > => {
      const sourceFileRes = await this.getSourceFile(path);

      const errors: PatchSourceError[] = [];
      if (sourceFileRes.error) {
        errors.push({
          message: sourceFileRes.error.message,
          filePath: path,
        });
        return {
          path,
          errors,
          skippedPatches: patches.map((p) => p.patchId),
        };
      }
      const sourceFile = sourceFileRes.data;
      previousSourceFiles[path] = sourceFile;
      let tsSourceFile = ts.createSourceFile(
        "<val>",
        sourceFile,
        ts.ScriptTarget.ES2015,
      );
      const appliedPatches: PatchId[] = [];
      const triedPatches: PatchId[] = [];
      for (const { patchId } of patches) {
        const patchData = patchAnalysis.patches.find(
          (p) => p.patchId === patchId,
        );
        if (!patchData) {
          errors.push({
            message: `Analysis required non-existing patch: ${patchId}`,
          });
          break;
        }
        const patch = patchData.patch;
        const sourceFileOps = patch.filter((op) => op.op !== "file"); // file is not a valid source file op
        const patchRes = applyPatch(tsSourceFile, tsOps, sourceFileOps);
        if (result.isErr(patchRes)) {
          if (Array.isArray(patchRes.error)) {
            for (const error of patchRes.error) {
              console.error(
                "Could not patch",
                JSON.stringify(
                  {
                    path,
                    patchId,
                    error,
                    sourceFileOps,
                  },
                  null,
                  2,
                ),
              );
            }
            errors.push(...patchRes.error);
          } else {
            console.error(
              "Could not patch",
              JSON.stringify(
                {
                  path,
                  patchId,
                  error: patchRes.error,
                  sourceFileOps,
                },
                null,
                2,
              ),
            );
            errors.push(patchRes.error);
          }
          triedPatches.push(patchId);
          break;
        }
        appliedPatches.push(patchId);
        tsSourceFile = patchRes.value;
      }
      if (errors.length === 0) {
        // https://github.com/microsoft/TypeScript/issues/36174
        let sourceFileText = unescape(
          tsSourceFile.getText(tsSourceFile).replace(/\\u/g, "%u"),
        );
        if (this.options?.formatter) {
          try {
            sourceFileText = await this.options.formatter(sourceFileText, path);
          } catch (err) {
            errors.push({
              message:
                "Could not format source file: " +
                (err instanceof Error ? err.message : "Unknown error"),
            });
          }
        }
        return {
          path,
          appliedPatches,
          result: sourceFileText,
        };
      } else {
        const skippedPatches = patches
          .slice(appliedPatches.length + triedPatches.length)
          .map((p) => p.patchId);

        return {
          path,
          appliedPatches,
          triedPatches,
          skippedPatches,
          errors,
        };
      }
    };
    const allResults = await Promise.all(
      Object.entries(patchesByModule).map(([path, patches]) =>
        applySourceFilePatches(path as ModuleFilePath, patches),
      ),
    );
    let hasErrors = false;
    const sourceFilePatchErrors: Record<ModuleFilePath, PatchSourceError[]> =
      {};
    const appliedPatches: Record<ModuleFilePath, PatchId[]> = {};
    const triedPatches: Record<ModuleFilePath, PatchId[]> = {};
    const skippedPatches: Record<ModuleFilePath, PatchId[]> = {};

    //
    const globalAppliedPatches: PatchId[] = [];
    for (const res of allResults) {
      if (res.errors) {
        hasErrors = true;
        sourceFilePatchErrors[res.path] = res.errors;
        appliedPatches[res.path] = res.appliedPatches ?? [];
        triedPatches[res.path] = res.triedPatches ?? [];
        skippedPatches[res.path] = res.skippedPatches ?? [];
      } else {
        patchedSourceFiles[res.path] = res.result;
        appliedPatches[res.path] = res.appliedPatches ?? [];
      }
      for (const patchId of res.appliedPatches ?? []) {
        globalAppliedPatches.push(patchId);
      }
    }
    const patchedBinaryFilesDescriptors: Record<
      string,
      {
        patchId: PatchId;
      }
    > = {};
    const binaryFilePatchErrors: Record<string, { message: string }> = {};
    await Promise.all(
      Object.entries(fileLastUpdatedByPatchId).map(
        async ([filePath, patchId]) => {
          if (globalAppliedPatches.includes(patchId)) {
            // TODO: do we want to make sure the file is there? Then again, it should be rare that it happens (unless there's a Val bug) so it might be enough to fail later (at commit)
            // TODO: include sha256? This way we can make sure we pick the right file since theoretically there could be multiple files with the same path in the same patch
            // or is that the case? We are picking the latest file by path so, that should be enough?
            patchedBinaryFilesDescriptors[filePath] = {
              patchId,
            };
          } else {
            hasErrors = true;
            binaryFilePatchErrors[filePath] = {
              message: "Patch not applied",
            };
          }
        },
      ),
    );

    const res: PreparedCommit = {
      hasErrors,
      sourceFilePatchErrors,
      binaryFilePatchErrors,
      patchedSourceFiles,
      previousSourceFiles,
      patchedBinaryFilesDescriptors,
      appliedPatches,
      skippedPatches,
      triedPatches,
    };
    return res;
  }

  // #region createPatch
  async createPatch(
    path: ModuleFilePath,
    patch: Patch,
    parentRef: ParentRef,
    authorId: AuthorId | null,
  ): Promise<
    result.Result<
      {
        patchId: PatchId;
        error?: undefined;
        createdAt: string;
        files: {
          filePath: string;
          error?: PatchError;
        }[];
      },
      | { errorType: "other"; error: GenericErrorMessage }
      | { errorType: "patch-head-conflict" }
    >
  > {
    const initTree = await this.initSources();
    const schemas = initTree.schemas;
    const moduleErrors = initTree.moduleErrors;
    let sources = initTree.sources;

    if (parentRef.type !== "head") {
      // There's room for some optimizations here: we could do this once, then re-use every time we create a patch, then again we only create one patch at a time
      const patchOps = await this.fetchPatches({ excludePatchOps: false });
      const patchAnalysis = this.analyzePatches(patchOps.patches);
      const tree = await this.getSources({
        ...patchAnalysis,
        ...patchOps,
      });
      sources = {
        ...sources,
        ...tree.sources,
      };
    }
    const source = sources[path];
    const schema = schemas[path];
    const moduleError = moduleErrors.find((e) => e.path === path);
    if (moduleError) {
      console.error(
        `Cannot patch. Module at path: '${path}' has fatal errors: "${moduleError.message}"`,
      );
      return result.err({
        errorType: "other",
        error: {
          message:
            `Cannot patch. Module at path: '${path}' has fatal errors: ` +
            moduleErrors.map((m) => `"${m.message}"`).join(" and "),
        },
      });
    }
    if (source === undefined) {
      console.error(
        `Cannot patch. Module source at path: '${path}' does not exist`,
      );
      return result.err({
        errorType: "other",
        error: {
          message: `Cannot patch. Module source at path: '${path}' does not exist`,
        },
      });
    }
    if (!schema) {
      console.error(
        `Cannot patch. Module schema at path: '${path}' does not exist`,
      );
      return result.err({
        errorType: "other",
        error: {
          message: `Cannot patch. Module schema at path: '${path}' does not exist`,
        },
      });
    }

    const sourceFileOps: Patch = [];
    const files: Record<
      string,
      | {
          error?: undefined;
          value: string;
          path: string[];
          sha256: string;
        }
      | {
          error: PatchError;
        }
    > = {};
    for (const op of patch) {
      if (op.op !== "file") {
        sourceFileOps.push(op);
      } else {
        const { value, filePath } = op;

        if (files[filePath]) {
          console.error(
            `Cannot have multiple files with same path in same patch. Path: ${filePath}`,
          );
          files[filePath] = {
            error: new PatchError(
              "Cannot have multiple files with same path in same patch",
            ),
          };
        } else if (typeof value !== "string") {
          console.error(
            `Value is not a string. Path: ${filePath}. Value: ${value}`,
          );
          files[filePath] = { error: new PatchError("Value is not a string") };
        } else {
          const sha256 = Internal.getSHA256Hash(textEncoder.encode(value));
          files[filePath] = {
            value,
            sha256,
            path: op.path,
          };
          sourceFileOps.push({
            op: "file",
            path: op.path,
            filePath,
            nestedFilePath: op.nestedFilePath,
            value: sha256,
          });
        }
      }
    }
    const saveRes = await this.saveSourceFilePatch(
      path,
      patch,
      parentRef,
      authorId,
    );
    if (result.isErr(saveRes)) {
      console.error(
        `Could not save source patch at path: '${path}'. Error: ${saveRes.error.errorType === "other" ? saveRes.error.message : saveRes.error.errorType}`,
      );
      if (saveRes.error.errorType === "patch-head-conflict") {
        return result.err({ errorType: "patch-head-conflict" });
      }
      return result.err({ errorType: "other", error: saveRes.error });
    }
    const patchId = saveRes.value.patchId;
    const saveFileRes: { filePath: string; error?: PatchError }[] =
      await Promise.all(
        Object.entries(files).map(
          async ([filePath, data]): Promise<{
            filePath: string;
            error?: PatchError;
          }> => {
            if (data.error) {
              return { filePath, error: data.error };
            } else {
              let type: string | null;
              const modulePath = Internal.patchPathToModulePath(data.path);
              try {
                const { schema: schemaAtPath } = Internal.resolvePath(
                  modulePath,
                  source,
                  schema,
                );
                type =
                  schemaAtPath instanceof ImageSchema ||
                  schemaAtPath instanceof RichTextSchema // if it's a rich text schema, we assume it's an image - hope this assumption holds!
                    ? "image"
                    : schemaAtPath instanceof FileSchema
                      ? "file"
                      : schemaAtPath.serialize().type;
              } catch (e) {
                if (e instanceof Error) {
                  console.error(
                    `Could not resolve file type at: ${modulePath}. Error: ${e.message}`,
                  );
                  return {
                    filePath,
                    error: new PatchError(
                      `Could not resolve file type at: ${modulePath}. Error: ${e.message}`,
                    ),
                  };
                }
                console.error(
                  `Could not resolve file type at: ${modulePath}. Unknown error.`,
                );
                return {
                  filePath,
                  error: new PatchError(
                    `Could not resolve file type at: ${modulePath}. Unknown error.`,
                  ),
                };
              }
              if (type !== "image" && type !== "file") {
                console.error(
                  "Unknown file type (resolved from schema): " + type,
                );
                return {
                  filePath,
                  error: new PatchError(
                    "Unknown file type (resolved from schema): " + type,
                  ),
                };
              }
              const mimeType = getMimeTypeFromBase64(data.value);
              if (!mimeType) {
                console.error(
                  "Could not get mimeType from base 64 encoded value",
                );
                return {
                  filePath,
                  error: new PatchError(
                    "Could not get mimeType from base 64 encoded value. First chars were: " +
                      data.value.slice(0, 20),
                  ),
                };
              }
              const buffer = bufferFromDataUrl(data.value);
              if (!buffer) {
                console.error(
                  "Could not create buffer from base 64 encoded value",
                );
                return {
                  filePath,
                  error: new PatchError(
                    "Could not create buffer from base 64 encoded value",
                  ),
                };
              }
              const metadataOps = createMetadataFromBuffer(
                type,
                mimeType,
                buffer,
              );
              if (metadataOps.errors) {
                console.error(
                  `Could not get metadata. Errors: ${metadataOps.errors
                    .map((error) => error.message)
                    .join(", ")}`,
                );
                return {
                  filePath,
                  error: new PatchError(
                    `Could not get metadata. Errors: ${metadataOps.errors
                      .map((error) => error.message)
                      .join(", ")}`,
                  ),
                };
              }
              const MaxRetries = 3;
              let lastRes;
              for (let i = 0; i < MaxRetries; i++) {
                lastRes = await this.saveBase64EncodedBinaryFileFromPatch(
                  filePath,
                  parentRef,
                  patchId,
                  data.value,
                  type,
                  metadataOps.metadata,
                );
                if (!lastRes.error) {
                  return { filePath };
                }
              }
              return {
                filePath,
                error: new PatchError(
                  lastRes?.error?.message ||
                    "Unexpectedly could not save patch file",
                ),
              };
            }
          },
        ),
      );

    const errors = saveFileRes.filter(
      (f): f is { filePath: string; error: PatchError } => !!f.error,
    );
    if (errors.length > 0) {
      return result.err({
        errorType: "other",
        error: {
          message:
            "Could not save patch: " +
            errors.map((e) => e.error.message).join(", "),
        },
      });
    }
    return result.ok({
      patchId,
      files: saveFileRes,
      createdAt: new Date().toISOString(),
    });
  }

  // #region abstract ops
  abstract getCommitSummary(preparedCommit: PreparedCommit): Promise<
    | {
        commitSummary: string | null;
        error?: undefined;
      }
    | {
        commitSummary?: undefined;
        error: GenericErrorMessage;
      }
  >;
  abstract onInit(baseSha: BaseSha, schemaSha: SchemaSha): Promise<void>;
  abstract fetchPatches<ExcludePatchOps extends boolean>(filters: {
    patchIds?: PatchId[];
    excludePatchOps: ExcludePatchOps;
  }): Promise<
    ExcludePatchOps extends true ? OrderedPatchesMetadata : OrderedPatches
  >;
  protected abstract saveSourceFilePatch(
    path: ModuleFilePath,
    patch: Patch,
    parentRef: ParentRef | null,
    authorId: AuthorId | null,
  ): Promise<SaveSourceFilePatchResult>;
  protected abstract getSourceFile(
    path: ModuleFilePath,
  ): Promise<WithGenericError<{ data: string }>>;
  protected abstract saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    parentRef: ParentRef,
    patchId: PatchId,
    data: string,
    type: "file" | "image",
    metadata: MetadataOfType<"file" | "image">,
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>>;
  abstract getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId,
  ): Promise<Buffer | null>;
  protected abstract getBase64EncodedBinaryFileMetadataFromPatch<
    T extends "file" | "image",
  >(filePath: string, type: T, patchId: PatchId): Promise<OpsMetadata<T>>;
  abstract getBinaryFile(filePath: string): Promise<Buffer | null>;
  protected abstract getBinaryFileMetadata<T extends "file" | "image">(
    filePath: string,
    type: T,
  ): Promise<OpsMetadata<T>>;
  abstract deletePatches(patchIds: PatchId[]): Promise<
    | { deleted: PatchId[]; errors?: undefined; error?: undefined }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage>;
      }
    | { error: GenericErrorMessage; errors?: undefined; deleted?: undefined }
  >;
  abstract getProfiles(): Promise<
    {
      profileId: string;
      fullName: string;
      avatar: {
        url: string;
      } | null;
    }[]
  >;
}

function isOnlyFileCheckValidationError(validationError: ValidationError) {
  if (
    validationError.fixes?.every(
      (f) => f === "file:check-metadata" || f === "image:check-metadata",
    )
  ) {
    return true;
  }
  return false;
}

function isFileSource(value: unknown): value is FileSource {
  if (
    typeof value === "object" &&
    value !== null &&
    FILE_REF_PROP in value &&
    VAL_EXTENSION in value &&
    value[VAL_EXTENSION] === "file" &&
    FILE_REF_PROP
  ) {
    return true;
  }
  return false;
}

export type WithGenericError<T extends Record<string, unknown>> =
  | (T & { error?: undefined })
  | GenericError;
export type GenericError = {
  error: {
    message: string;
  };
};
export type GenericErrorMessage = {
  message: string;
  details?: unknown;
};

export type SaveSourceFilePatchResult = result.Result<
  { patchId: PatchId },
  | ({ errorType: "other" } & GenericErrorMessage)
  | { errorType: "patch-head-conflict" }
>;

export type PatchAnalysis = {
  patchesByModule: {
    [path: ModuleFilePath]: {
      patchId: PatchId;
    }[];
  };
  fileLastUpdatedByPatchId: Record<string, PatchId>;
};

export type PatchSourceError =
  | {
      message: string;
      filePath?: string;
    }
  | PatchError
  | ValSyntaxError
  | ValSyntaxErrorTree;

export type MetadataOfType<T extends "file" | "image"> = T extends "image"
  ? Omit<ImageMetadata, "hotspot">
  : FileMetadata;
export type OpsMetadata<T extends "file" | "image"> =
  | {
      metadata: MetadataOfType<T>;
      errors?: undefined;
    }
  | {
      errors: (
        | (GenericErrorMessage & {
            field: string;
          })
        | (GenericErrorMessage & {
            filePath?: string;
          })
      )[];
    };

export type BinaryFileType = "file" | "image";

export type PreparedCommit = {
  /**
   * Updated / new source files that are ready to be committed / saved
   */
  patchedSourceFiles: Record<ModuleFilePath, string>;
  /**
   * Previous source files that were patched
   */
  previousSourceFiles: Record<ModuleFilePath, string>;
  /**
   * The file path and patch id in which they appear of binary files that are ready to be committed / saved
   */
  patchedBinaryFilesDescriptors: Record<string, { patchId: PatchId }>;
  /**
   * Source file patches that were successfully applied to get to this result
   */
  appliedPatches: Record<ModuleFilePath, PatchId[]>;
  //
  hasErrors: boolean;
  sourceFilePatchErrors: Record<ModuleFilePath, PatchSourceError[]>;
  binaryFilePatchErrors: Record<string, { message: string }>;
  skippedPatches: Record<ModuleFilePath, PatchId[]>;
  triedPatches: Record<ModuleFilePath, PatchId[]>;
};

export type PatchErrors = Record<PatchId, GenericErrorMessage>;

export type PatchReadError =
  | {
      patchId: PatchId;
      message: string;
    }
  | {
      parentPatchId: ParentPatchId;
      message: string;
    };

type ValCommit = {
  commitSha: CommitSha;
  clientCommitSha: CommitSha;
  parentCommitSha: CommitSha;
  branch: string;
  creator: AuthorId;
  createdAt: string;
};
export type OrderedPatches = {
  patches: {
    path: ModuleFilePath;
    patchId: PatchId;
    patch: Patch;
    createdAt: string;
    authorId: AuthorId | null;
    baseSha: BaseSha;
    appliedAt: {
      commitSha: CommitSha;
    } | null;
  }[];
  commits?: ValCommit[];
  error?: GenericErrorMessage;
  errors?: PatchReadError[];
  unauthorized?: boolean;
  networkError?: boolean;
};

export type OrderedPatchesMetadata = {
  patches: (Omit<OrderedPatches["patches"][number], "patch"> & {
    patch?: undefined;
  })[];
  commits?: ValCommit[];
  error?: GenericErrorMessage;
  errors?: OrderedPatches["errors"];
  unauthorized?: boolean;
  networkError?: boolean;
};

export function getFieldsForType<T extends BinaryFileType>(
  type: T,
): (keyof MetadataOfType<T> & string)[] {
  if (type === "file") {
    return ["mimeType"] as (keyof MetadataOfType<"file"> & string)[];
  } else if (type === "image") {
    return [
      "mimeType",
      "height",
      "width",
    ] as (keyof MetadataOfType<"image">)[] as (keyof MetadataOfType<T> &
      string)[];
  }
  throw new Error("Unknown type: " + type);
}

export function createMetadataFromBuffer<T extends BinaryFileType>(
  type: BinaryFileType,
  mimeType: string,
  buffer: Buffer,
): OpsMetadata<T> {
  const errors = [];
  let availableMetadata: Record<string, string | number | undefined | null>;
  if (type === "image") {
    const { width, height, type } = sizeOf(buffer);
    const normalizedType =
      type === "jpg" ? "jpeg" : type === "svg" ? "svg+xml" : type;
    if (type !== undefined && `image/${normalizedType}` !== mimeType) {
      return {
        errors: [
          {
            message: `Mime type does not match image type: ${mimeType} vs ${type}`,
          },
        ],
      };
    }
    availableMetadata = {
      mimeType,
      height,
      width,
    };
  } else {
    availableMetadata = {
      mimeType,
    };
  }
  const metadata: Record<string, string | number> = {};
  for (const field of getFieldsForType(type)) {
    const foundFieldData =
      field in availableMetadata ? availableMetadata[field] : null;
    if (foundFieldData !== undefined && foundFieldData !== null) {
      metadata[field] = foundFieldData;
    } else {
      errors.push({ message: `Field not found: '${field}'`, field });
    }
  }
  if (errors.length > 0) {
    return { errors };
  }
  return { metadata } as OpsMetadata<T>;
}

const base64DataAttr = "data:";
export function getMimeTypeFromBase64(content: string): string | null {
  const dataIndex = content.indexOf(base64DataAttr);
  const base64Index = content.indexOf(";base64,");
  if (dataIndex > -1 || base64Index > -1) {
    const mimeType = content.slice(
      dataIndex + base64DataAttr.length,
      base64Index,
    );
    const normalizedMimeType =
      mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    return normalizedMimeType;
  }
  return null;
}

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
const COMMON_MIME_TYPES: Record<string, string> = {
  aac: "audio/aac",
  abw: "application/x-abiword",
  arc: "application/x-freearc",
  avif: "image/avif",
  avi: "video/x-msvideo",
  azw: "application/vnd.amazon.ebook",
  bin: "application/octet-stream",
  bmp: "image/bmp",
  bz: "application/x-bzip",
  bz2: "application/x-bzip2",
  cda: "application/x-cdf",
  csh: "application/x-csh",
  css: "text/css",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  eot: "application/vnd.ms-fontobject",
  epub: "application/epub+zip",
  gz: "application/gzip",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  ico: "image/vnd.microsoft.icon",
  ics: "text/calendar",
  jar: "application/java-archive",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  jsonld: "application/ld+json",
  mid: "audio/midi",
  midi: "audio/midi",
  mjs: "text/javascript",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpkg: "application/vnd.apple.installer+xml",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  oga: "audio/ogg",
  ogv: "video/ogg",
  ogx: "application/ogg",
  opus: "audio/opus",
  otf: "font/otf",
  png: "image/png",
  pdf: "application/pdf",
  php: "application/x-httpd-php",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rar: "application/vnd.rar",
  rtf: "application/rtf",
  sh: "application/x-sh",
  svg: "image/svg+xml",
  tar: "application/x-tar",
  tif: "image/tiff",
  tiff: "image/tiff",
  ts: "video/mp2t",
  ttf: "font/ttf",
  txt: "text/plain",
  vsd: "application/vnd.visio",
  wav: "audio/wav",
  weba: "audio/webm",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xhtml: "application/xhtml+xml",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  xul: "application/vnd.mozilla.xul+xml",
  zip: "application/zip",
  "3gp": "video/3gpp; audio/3gpp if it doesn't contain video",
  "3g2": "video/3gpp2; audio/3gpp2 if it doesn't contain video",
  "7z": "application/x-7z-compressed",
};

export function guessMimeTypeFromPath(filePath: string): string | null {
  const fileExt = filePath.split(".").pop();
  if (fileExt) {
    return COMMON_MIME_TYPES[fileExt.toLowerCase()] || null;
  }
  return null;
}

export function bufferFromDataUrl(dataUrl: string): Buffer | undefined {
  let base64Data;
  const base64Index = dataUrl.indexOf(";base64,");
  if (base64Index > -1) {
    base64Data = dataUrl.slice(base64Index + ";base64,".length);
  }
  if (base64Data) {
    return Buffer.from(
      base64Data,
      "base64", // TODO: why does it not work with base64url?
    );
  }
}
