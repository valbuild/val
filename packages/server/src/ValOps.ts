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
  Schema,
  SelectorSource,
  Source,
  SourcePath,
  VAL_EXTENSION,
  ValModules,
  ValidationError,
  ValidationErrors,
} from "@valbuild/core";
import { pipe, result } from "@valbuild/core/fp";
import { JSONOps, Patch, PatchError, applyPatch } from "@valbuild/core/patch";
import { TSOps } from "./patch/ts/ops";
import { analyzeValModule } from "./patch/ts/valModule";
import ts from "typescript";
import { ValSyntaxError, ValSyntaxErrorTree } from "./patch/ts/syntax";

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
    result.map(({ source }) => source)
  );
});

export type ValOpsOptions = {
  formatter?: (code: string, filePath: string) => string;
};
// #region ValOps
export abstract class ValOps {
  /** Sources from val modules, immutable (without patches or anything)  */
  private sources: Sources | null;
  /** The sha265 / hash of sources + schema + config */
  private baseSha: BaseSha | null;
  /** Schema from val modules, immutable  */
  private schemas: Schemas | null;
  /** The sha265 / hash of schema + config - if this changes users needs to reload */
  private schemaSha: SchemaSha | null;
  private modulesErrors: ModulesError[] | null;

  constructor(
    private readonly valModules: ValModules,
    private readonly options?: ValOpsOptions
  ) {
    this.sources = null;
    this.baseSha = null;
    this.schemas = null;
    this.schemaSha = null;
    this.modulesErrors = null;
  }

  private hash(input: string | object): string {
    let str;
    if (typeof input === "string") {
      str = input;
    } else {
      str = JSON.stringify(input);
    }
    return Internal.getSHA256Hash(textEncoder.encode(str));
  }

  // #region initTree
  private async initTree(): Promise<{
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
        path?: SourcePath
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
            moduleIdx
          );
          continue;
        }
        await module.def().then((value) => {
          if (!value) {
            addModuleError(
              `val.modules 'def' did not return a value`,
              moduleIdx
            );
            return;
          }
          if (!value.default) {
            addModuleError(
              `val.modules 'def' did not return a default export`,
              moduleIdx
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
              path
            );
            return;
          }
          if (!(schema instanceof Schema)) {
            addModuleError(
              `schema in path '${path}' is not an instance of Schema`,
              moduleIdx,
              path
            );
            return;
          }
          if (typeof schema.serialize !== "function") {
            addModuleError(
              `schema.serialize in path '${path}' is not a function`,
              moduleIdx,
              path
            );
            return;
          }
          const source = Internal.getSource(value.default);
          if (source === undefined) {
            addModuleError(`source in ${path} is undefined`, moduleIdx, path);
            return;
          }
          const pathM = path as string as ModuleFilePath;
          currentSources[pathM] = source;
          currentSchemas[pathM] = schema;
          // make sure the checks above is enough that this does not fail - even if val modules are not set up correctly
          baseSha += this.hash({
            path,
            schema: schema.serialize(),
            source,
            modulesErrors: currentModulesErrors,
          });
          schemaSha += this.hash(schema.serialize());
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
    const { baseSha, schemaSha } = await this.initTree();
    await this.onInit(baseSha, schemaSha);
  }

  async getBaseSources(): Promise<Sources> {
    return this.initTree().then((result) => result.sources);
  }
  async getSchemas(): Promise<Schemas> {
    return this.initTree().then((result) => result.schemas);
  }
  async getModuleErrors(): Promise<ModulesError[]> {
    return this.initTree().then((result) => result.moduleErrors);
  }
  async getBaseSha(): Promise<BaseSha> {
    return this.initTree().then((result) => result.baseSha);
  }
  async getSchemaSha(): Promise<SchemaSha> {
    return this.initTree().then((result) => result.schemaSha);
  }

  // #region analyzePatches
  analyzePatches(patchesById: Patches["patches"]): PatchAnalysis {
    const patchesByModule: {
      [path: ModuleFilePath]: {
        patchId: PatchId;
        createdAt: string;
      }[];
    } = {};
    const fileLastUpdatedByPatchId: Record<string, PatchId> = {};
    for (const [patchIdS, { path, patch, created_at }] of Object.entries(
      patchesById
    )) {
      const patchId = patchIdS as PatchId;
      for (const op of patch) {
        if (op.op === "file") {
          fileLastUpdatedByPatchId[op.filePath] = patchId;
        }
      }
      if (!patchesByModule[path]) {
        patchesByModule[path] = [];
      }
      patchesByModule[path].push({
        patchId,
        createdAt: created_at,
      });
    }
    for (const path in patchesByModule) {
      patchesByModule[path as ModuleFilePath].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      );
    }

    return {
      patchesByModule,
      fileLastUpdatedByPatchId,
    };
  }

  // #region getTree
  async getTree(analysis?: PatchAnalysis & Patches): Promise<{
    sources: Sources;
    errors: Record<
      ModuleFilePath,
      { patchId?: PatchId; invalidPath?: boolean; error: PatchError }[]
    >;
  }> {
    if (!analysis) {
      const { sources } = await this.initTree();
      return { sources, errors: {} };
    }
    const { sources } = await this.initTree();

    const patchedSources: Sources = {};
    const errors: Record<
      ModuleFilePath,
      { patchId?: PatchId; invalidPath?: boolean; error: PatchError }[]
    > = {};
    for (const [pathS, patches] of Object.entries(analysis.patchesByModule)) {
      const path = pathS as ModuleFilePath;
      if (!sources[path]) {
        if (!errors[path]) {
          errors[path] = [];
        }
        errors[path].push({
          invalidPath: true,
          error: new PatchError(`Module at path: '${path}' not found`),
        });
      }
      const source = sources[path];
      for (const { patchId } of patches) {
        const patchData = analysis.patches[patchId];
        const patchRes = applyPatch(
          source,
          jsonOps,
          patchData.patch.filter((op) => op.op !== "file")
        );
        if (errors[path]) {
          errors[path].push({
            patchId: patchId,
            error: new PatchError(`Cannot apply patch: previous errors exists`),
          });
        } else {
          if (result.isErr(patchRes)) {
            if (!errors[path]) {
              errors[path] = [];
            }
            errors[path].push({
              patchId: patchId,
              error: patchRes.error,
            });
          } else {
            patchedSources[path] = patchRes.value;
          }
        }
      }
    }
    return { sources: patchedSources, errors };
  }

  // #region validateSources
  async validateSources(
    schemas: Schemas,
    sources: Sources,
    patchesByModule?: PatchAnalysis["patchesByModule"]
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
        for (const validationError of validationErrors) {
          if (isOnlyFileCheckValidationError(validationError)) {
            if (files[sourcePath]) {
              throw new Error(
                "Cannot have multiple files with same path. Path: " +
                  sourcePath +
                  "; Module: " +
                  path
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
    return { errors, files };
  }

  // #region validateFiles
  async validateFiles(
    schemas: Schemas,
    sources: Sources,
    files: Record<SourcePath, FileSource>,
    fileLastUpdatedByPatchId?: PatchAnalysis["fileLastUpdatedByPatchId"]
  ): Promise<Record<SourcePath, ValidationError[]>> {
    const validateFileAtSourcePath = async (
      sourcePath: SourcePath,
      value: FileSource
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
          schemas[fullModulePath]
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
            patchId
          );
        if (patchFileMetadata.errors) {
          metadataErrors = patchFileMetadata.errors;
        } else {
          metadata = patchFileMetadata.metadata;
        }
      } else {
        const patchFileMetadata = await this.getBinaryFileMetadata(
          filePath,
          type
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
        "metadata"
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
          field
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
                currentValueMetadata[field]
              )} does not match expected value: ${JSON.stringify(
                fieldMetadata
              )}`,
              value: {
                actual: currentValueMetadata[field],
                expected: fieldMetadata,
              },
              fixes: ["image:replace-metadata"],
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
            }
          )
        )
      )
    ).flat();
    return Object.fromEntries(allErrors);
  }

  // #region prepareCommit
  async prepare(
    patchAnalysis: PatchAnalysis & Patches
  ): Promise<PreparedCommit> {
    const { patchesByModule, fileLastUpdatedByPatchId } = patchAnalysis;
    const applySourceFilePatches = async (
      path: ModuleFilePath,
      patches: { patchId: PatchId }[]
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
      let tsSourceFile = ts.createSourceFile(
        "<val>",
        sourceFile,
        ts.ScriptTarget.ES2015
      );
      const appliedPatches: PatchId[] = [];
      const triedPatches: PatchId[] = [];
      for (const { patchId } of patches) {
        const patch = patchAnalysis.patches?.[patchId]?.patch;
        if (!patch) {
          errors.push({
            message: `Analysis required non-existing patch: ${patchId}`,
          });
          break;
        }
        const sourceFileOps = patch.filter((op) => op.op !== "file"); // file is not a valid source file op
        const patchRes = applyPatch(tsSourceFile, tsOps, sourceFileOps);
        if (result.isErr(patchRes)) {
          if (Array.isArray(patchRes.error)) {
            errors.push(...patchRes.error);
          } else {
            errors.push(patchRes.error);
          }
          triedPatches.push(patchId);
          break;
        }
        appliedPatches.push(patchId);
        tsSourceFile = patchRes.value;
      }
      if (errors.length === 0) {
        let sourceFileText = tsSourceFile.getText(tsSourceFile);
        if (this.options?.formatter) {
          try {
            sourceFileText = this.options.formatter(sourceFileText, path);
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
        applySourceFilePatches(path as ModuleFilePath, patches)
      )
    );
    let hasErrors = false;
    const sourceFilePatchErrors: Record<ModuleFilePath, PatchSourceError[]> =
      {};
    const appliedPatches: Record<ModuleFilePath, PatchId[]> = {};
    const triedPatches: Record<ModuleFilePath, PatchId[]> = {};
    const skippedPatches: Record<ModuleFilePath, PatchId[]> = {};
    const patchedSourceFiles: Record<ModuleFilePath, string> = {};

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
        }
      )
    );

    const res: PreparedCommit = {
      hasErrors,
      sourceFilePatchErrors,
      binaryFilePatchErrors,
      patchedSourceFiles,
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
    authorId: AuthorId | null
  ): Promise<
    | {
        patchId: PatchId;
        error?: undefined;
        created_at: string;
        files: {
          filePath: string;
          error?: PatchError;
        }[];
      }
    | { error: GenericErrorMessage }
  > {
    const { sources, schemas, moduleErrors } = await this.initTree();
    const source = sources[path];
    const schema = schemas[path];
    const moduleError = moduleErrors.find((e) => e.path === path);
    if (moduleError) {
      return {
        error: {
          message:
            `Cannot patch. Module at path: '${path}' has fatal errors: ` +
            moduleErrors.map((m) => `"${m.message}"`).join(" and "),
        },
      };
    }
    if (!source) {
      return {
        error: {
          message: `Cannot patch. Module source at path: '${path}' does not exist`,
        },
      };
    }
    if (!schema) {
      return {
        error: {
          message: `Cannot patch. Module schema at path: '${path}' does not exist`,
        },
      };
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
          files[filePath] = {
            error: new PatchError(
              "Cannot have multiple files with same path in same patch"
            ),
          };
        } else if (typeof value !== "string") {
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
            value: {
              sha256,
            },
          });
        }
      }
    }
    const saveRes = await this.saveSourceFilePatch(
      path,
      sourceFileOps,
      authorId
    );
    if (saveRes.error) {
      return { error: saveRes.error };
    }
    const patchId = saveRes.patchId;

    const saveFileRes: { filePath: string; error?: PatchError }[] =
      await Promise.all(
        Object.entries(files).map(async ([filePath, data]) => {
          if (data.error) {
            return { filePath, error: data.error };
          } else {
            let type: string | null;
            const modulePath = Internal.patchPathToModulePath(data.path);
            try {
              const { schema: schemaAtPath } = Internal.resolvePath(
                modulePath,
                source,
                schema
              );
              type =
                schemaAtPath instanceof ImageSchema
                  ? "image"
                  : schemaAtPath instanceof FileSchema
                  ? "file"
                  : schema.serialize().type;
            } catch (e) {
              if (e instanceof Error) {
                return {
                  filePath,
                  error: new PatchError(
                    `Could not resolve file type at: ${modulePath}. Error: ${e.message}`
                  ),
                };
              }
              return {
                filePath,
                error: new PatchError(
                  `Could not resolve file type at: ${modulePath}. Unknown error.`
                ),
              };
            }
            if (type !== "image" && type !== "file") {
              return {
                filePath,
                error: new PatchError(
                  "Unknown file type (resolved from schema): " + type
                ),
              };
            }
            const res = await this.saveBase64EncodedBinaryFileFromPatch(
              filePath,
              type,
              patchId,
              data.value,
              data.sha256
            );
            if (!res.error) {
              return { filePath };
            } else {
              return { filePath, error: new PatchError(res.error.message) };
            }
          }
        })
      );
    return {
      patchId,
      files: saveFileRes,
      created_at: new Date().toISOString(),
    };
  }

  // #region abstract ops
  abstract onInit(baseSha: BaseSha, schemaSha: SchemaSha): Promise<void>;
  abstract getPatchOpsById(patchIds: PatchId[]): Promise<Patches>;
  abstract findPatches(filters: { authors?: AuthorId[] }): Promise<FindPatches>;
  protected abstract saveSourceFilePatch(
    path: ModuleFilePath,
    patch: Patch,
    authorId: AuthorId | null
  ): Promise<WithGenericError<{ patchId: PatchId }>>;
  protected abstract getSourceFile(
    path: ModuleFilePath
  ): Promise<WithGenericError<{ data: string }>>;
  protected abstract saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    type: "file" | "image",
    patchId: PatchId,
    data: string,
    sha256: string
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>>;
  protected abstract getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId
  ): Promise<Buffer | null>;
  protected abstract getBase64EncodedBinaryFileMetadataFromPatch<
    T extends "file" | "image"
  >(filePath: string, type: T, patchId: PatchId): Promise<OpsMetadata<T>>;
  protected abstract getBinaryFile(filePath: string): Promise<Buffer | null>;
  protected abstract getBinaryFileMetadata<T extends "file" | "image">(
    filePath: string,
    type: T
  ): Promise<OpsMetadata<T>>;
  protected abstract deletePatches(patchIds: PatchId[]): Promise<
    | { deleted: PatchId[]; errors?: undefined }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage & { patchId: PatchId }>;
      }
  >;
}

function isOnlyFileCheckValidationError(validationError: ValidationError) {
  if (
    validationError.fixes?.every(
      (f) => f === "file:check-metadata" || f === "image:replace-metadata"
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

type MetadataOfType<T extends "file" | "image"> = T extends "image"
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
  patchedSourceFiles: Record<ModuleFilePath, string>;
  patchedBinaryFilesDescriptors: Record<string, { patchId: PatchId }>;
  appliedPatches: Record<ModuleFilePath, PatchId[]>;
  //
  hasErrors: boolean;
  sourceFilePatchErrors: Record<ModuleFilePath, PatchSourceError[]>;
  binaryFilePatchErrors: Record<string, { message: string }>;
  skippedPatches: Record<ModuleFilePath, PatchId[]>;
  triedPatches: Record<ModuleFilePath, PatchId[]>;
};

export type Patches = {
  patches: Record<
    PatchId,
    {
      path: ModuleFilePath;
      patch: Patch;
      created_at: string;
      authorId: AuthorId | null;
      appliedAt: {
        baseSha: BaseSha;
        git?: { commitSha: CommitSha };
        timestamp: string;
      } | null;
    }
  >;
  errors?: Record<PatchId, GenericErrorMessage>;
};

export type PatchErrors = Record<PatchId, GenericErrorMessage>;

export type FindPatches = {
  patches: Record<PatchId, Omit<Patches["patches"][PatchId], "patch">>;
  errors?: Patches["errors"];
};

export function getFieldsForType<T extends BinaryFileType>(
  type: T
): (keyof MetadataOfType<T> & string)[] {
  if (type === "file") {
    return ["sha256", "mimeType"] as (keyof MetadataOfType<"file"> & string)[];
  } else if (type === "image") {
    return [
      "sha256",
      "mimeType",
      "height",
      "width",
    ] as (keyof MetadataOfType<"image">)[] as (keyof MetadataOfType<T> &
      string)[];
  }
  throw new Error("Unknown type: " + type);
}
