/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  FILE_REF_PROP,
  FileSource,
  ImageSchema,
  Internal,
  ModuleId,
  PatchId,
  Schema,
  SelectorSource,
  Source,
  SourcePath,
  VAL_EXTENSION,
  ValModules,
  ValidationError,
  ValidationErrors,
  initVal,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { JSONOps, Patch, PatchError, applyPatch } from "@valbuild/core/patch";
import {
  bufferFromDataUrl,
  getMimeTypeFromBase64,
  guessMimeTypeFromPath,
} from "./ValServer";
import sizeOf from "image-size";
import { getSha256 } from "./extractMetadata";

const anotherSmallPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAABAQAAAADLe9LuAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";
describe("ValServerOps", () => {
  test("flow", async () => {
    const smallPngBuffer = bufferFromDataUrl(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==",
      null
    );
    if (!smallPngBuffer) {
      throw new Error("Could not create test buffer from data url");
    }
    const { s, c } = initVal();
    const ops = new MemoryValOps(
      {
        config: {},
        modules: [
          {
            def: async () => {
              return {
                default: c.define(
                  "/test/test",
                  s.object({
                    test: s.string().min(3),
                    testImage: s.image(),
                  }),
                  {
                    test: "",
                    testImage: c.file("/public/test.png", {
                      sha256:
                        "80d58a5b775debc85386b320c347a59ffeeae5eeb3ca30a3a3ca04b5aaed145d",
                      height: 1,
                      width: 1,
                      mimeType: "image/png",
                    }),
                  }
                ),
              };
            },
          },
        ],
      },
      {
        "/public/test.png": smallPngBuffer,
        // "/public/managed/images/smallest.png": {
        //   sha256:
        //     "80d58a5b775debc85386b320c347a59ffeeae5eeb3ca30a3a3ca04b5aaed145d",
        //   height: 1,
        //   width: 1,
        //   mimeType: "image/png",
        // },
      }
    );
    const schemas = await ops.getSchemas();
    // console.log(JSON.stringify(await ops.getTree(), null, 2));

    const { patchId: patchId1 } = await ops.createPatch(
      "/test/test" as ModuleId,
      [
        // {
        //   op: "replace",
        //   path: ["testImage"],
        //   value: {
        //     _ref: "/public/managed/images/smallest.png",
        //     _type: "file",
        //     metadata: {
        //       width: 11,
        //       height: 1,
        //       sha256:
        //         "a30094a4957f7ec5fb432c14eae0a0c178ab37bac55ef06ff8286ff087f01fd3",
        //       mimeType: "image/png",
        //     },
        //   },
        // },
        {
          op: "file",
          filePath: "/public/managed/images/smallest.png",
          path: ["image"],
          value: anotherSmallPng,
        },
      ]
    );
    const patchesByModule: {
      [path: ModuleId]: { patch: Patch; patchId: PatchId }[];
    } = {};
    const fileLastUpdatedByPatchId: Record<string, PatchId> = {};
    for (const [patchIdS, { path, patch }] of Object.entries(
      await ops.getPatches([patchId1])
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
        patch,
        patchId,
      });
    }
    const t1 = await ops.getTree(patchesByModule);
    // console.log(JSON.stringify(t1, null, 2));
    console.time("validateSources1");
    const v1 = await ops.validateSources(schemas, t1.sources);
    console.timeEnd("validateSources1");
    // console.time("validateSources2");
    // await ops.validateSources(schemas, t1.sources);
    // console.timeEnd("validateSources2");
    // console.time("validateSources3");
    // await ops.validateSources(schemas, t1.sources);
    // console.timeEnd("validateSources3");
    // console.time("validateSources4");
    // await ops.validateSources(schemas, t1.sources);
    // console.timeEnd("validateSources4");

    // console.log(JSON.stringify(v1, null, 2));
    // console.log(fileLastUpdatedByPatchId);
    const fv1 = await ops.validateFiles(
      schemas,
      t1.sources,
      fileLastUpdatedByPatchId,
      v1.files
    );
    console.log(JSON.stringify(fv1, null, 2));
  });
});

type BaseSha = string & { readonly _tag: unique symbol };
type PatchesSha = string & { readonly _tag: unique symbol };
type ValidationSha = string & { readonly _tag: unique symbol };

type ModulesError = { message: string };

type Schemas = {
  [key: ModuleId]: Schema<SelectorSource>;
};

type Sources = {
  [key: ModuleId]: Source;
};

const textEncoder = new TextEncoder();
const jsonOps = new JSONOps();
abstract class ValOps {
  /** Sources from val modules, immutable (without patches or anything)  */
  private sources: Sources | null;
  /** Schema from val modules, immutable  */
  private schemas: Schemas | null;
  /** The sha265 / hash of the current baseTree*/
  private baseSha: BaseSha | null;

  private modulesErrors: ModulesError[] | null;
  constructor(private readonly valModules: ValModules) {
    this.baseSha = null;
    this.modulesErrors = null;
    this.sources = null;
    this.schemas = null;
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

  private addModuleError(message: string, index: number) {
    if (!this.modulesErrors) {
      this.modulesErrors = [];
    }
    this.modulesErrors[index] = { message };
  }

  private async initTree(): Promise<{
    baseSha: BaseSha;
    sources: Sources;
    schemas: Schemas;
  }> {
    if (
      this.baseSha === null ||
      this.sources === null ||
      this.schemas === null
    ) {
      const currentSources: Sources = {};
      const currentSchemas: Schemas = {};
      let hash = this.hash(JSON.stringify(this.valModules.config));
      for (
        let moduleIdx = 0;
        moduleIdx < this.valModules.modules.length;
        moduleIdx++
      ) {
        const module = this.valModules.modules[moduleIdx];
        if (!module.def) {
          this.addModuleError("missing 'def' property", moduleIdx);
          continue;
        }
        if (typeof module.def !== "function") {
          this.addModuleError("'def' property is not a function", moduleIdx);
          continue;
        }
        await module.def().then((value) => {
          if (!value) {
            this.addModuleError(`did not return a value`, moduleIdx);
            return;
          }
          if (!value.default) {
            this.addModuleError(`did not return a default export`, moduleIdx);
            return;
          }

          const path = Internal.getValPath(value.default);
          if (path === undefined) {
            this.addModuleError(`path is undefined`, moduleIdx);
            return;
          }
          const schema = Internal.getSchema(value.default);
          if (schema === undefined) {
            this.addModuleError(`schema is undefined`, moduleIdx);
            return;
          }
          if (!(schema instanceof Schema)) {
            this.addModuleError(
              `schema is not an instance of Schema`,
              moduleIdx
            );
            return;
          }
          if (typeof schema.serialize !== "function") {
            this.addModuleError(
              `schema.serialize is not a function`,
              moduleIdx
            );
            return;
          }
          const source = Internal.getSource(value.default);
          if (source === undefined) {
            this.addModuleError(`source is undefined`, moduleIdx);
            return;
          }
          const pathM = path as string as ModuleId;
          currentSources[pathM] = source;
          currentSchemas[pathM] = schema;
          // make sure the checks above is enough that this does not fail - even if val modules are not set up correctly
          hash += this.hash({
            path,
            schema: schema.serialize(),
            source,
          });
        });
      }
      this.sources = currentSources;
      this.schemas = currentSchemas;
      this.baseSha = hash as BaseSha;
    }
    return {
      baseSha: this.baseSha,
      sources: this.sources,
      schemas: this.schemas,
    };
  }

  async init(): Promise<void> {
    await this.initTree();
  }

  async getBaseSources(): Promise<Sources> {
    return this.initTree().then((result) => result.sources);
  }
  async getSchemas(): Promise<Schemas> {
    return this.initTree().then((result) => result.schemas);
  }
  async getBaseSha(): Promise<BaseSha> {
    return this.initTree().then((result) => result.baseSha);
  }

  async getTree(patchesByModule?: {
    [path: ModuleId]: { patch: Patch; patchId: PatchId }[];
  }): Promise<{
    sources: Sources;
    errors: Record<
      ModuleId,
      { patchId?: PatchId; invalidPath?: boolean; error: PatchError }[]
    >;
  }> {
    if (!patchesByModule) {
      const { sources } = await this.initTree();
      return { sources, errors: {} };
    }
    const { sources } = await this.initTree();

    const patchedSources: Sources = {};
    const errors: Record<
      ModuleId,
      { patchId?: PatchId; invalidPath?: boolean; error: PatchError }[]
    > = {};
    for (const [pathS, patches] of Object.entries(patchesByModule)) {
      const path = pathS as ModuleId;
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
      for (const patchData of patches) {
        const patchRes = applyPatch(
          source,
          jsonOps,
          patchData.patch.filter((op) => op.op !== "file")
        );
        if (errors[path]) {
          errors[path].push({
            patchId: patchData.patchId,
            error: new PatchError(`Cannot apply patch: previous errors exists`),
          });
        } else {
          if (result.isErr(patchRes)) {
            if (!errors[path]) {
              errors[path] = [];
            }
            errors[path].push({
              patchId: patchData.patchId,
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

  async validateSources(
    schemas: Schemas,
    sources: Sources
  ): Promise<{
    errors: Record<
      ModuleId,
      {
        invalidSource?: { message: string };
        validations: Record<SourcePath, ValidationError[]>;
      }
    >;
    files: Record<SourcePath, FileSource>;
  }> {
    const errors: Record<
      ModuleId,
      {
        invalidSource?: { message: string };
        validations: Record<SourcePath, ValidationError[]>;
      }
    > = {};
    const files: Record<SourcePath, FileSource> = {};
    const entries = Object.entries(schemas);
    for (const [pathS, schema] of entries) {
      const path = pathS as ModuleId;
      const source = sources[path];
      if (source === undefined) {
        if (!errors[path]) {
          errors[path] = { validations: {} };
        }
        errors[path] = {
          ...errors[path],
          invalidSource: { message: ` path: '${path}' not found` },
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

  async validateFiles(
    schemas: Schemas,
    sources: Sources,
    fileRefLastUpdatedByPatchId: Record<string, PatchId>,
    files: Record<SourcePath, FileSource>
  ): Promise<Record<SourcePath, ValidationError[]>> {
    const validateFileAtSourcePath = async (
      sourcePath: SourcePath,
      value: FileSource
    ): Promise<ValidationErrors> => {
      const [moduleId, modulePath] =
        Internal.splitModuleIdAndModulePath(sourcePath);
      const { schema: schemaAtPath } = Internal.resolvePath(
        modulePath,
        sources[moduleId],
        schemas[moduleId]
      );
      const type = schemaAtPath instanceof ImageSchema ? "image" : "file";
      let fields = ["sha256", "mimeType"];
      if (type === "image") {
        fields = ["sha256", "mimeType", "height", "width"];
      }
      const filePath = value[FILE_REF_PROP];
      const patchId: PatchId | undefined =
        fileRefLastUpdatedByPatchId[filePath];
      let metadata;
      let metadataErrors;
      if (patchId) {
        const patchFileMetadata = await this.getPatchMetadata(
          filePath,
          type,
          fields,
          patchId
        );
        metadataErrors = patchFileMetadata.errors;
        metadata = patchFileMetadata.metadata;
      } else {
        const patchFileMetadata = await this.getFileMetadata(
          filePath,
          type,
          fields
        );
        metadata = patchFileMetadata.metadata;
        metadataErrors = patchFileMetadata.errors;
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
      for (const field of fields) {
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

  async createPatch(
    path: ModuleId,
    patch: Patch
  ): Promise<{
    patchId: PatchId;
    files: { filePath: string; error?: PatchError }[];
  }> {
    const pureOps: Patch = [];
    const files: Record<
      string,
      | {
          error?: undefined;
          value: string;
          sha256: string;
        }
      | {
          error: PatchError;
        }
    > = {};
    for (const op of patch) {
      if (op.op !== "file") {
        pureOps.push(op);
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
          };
          pureOps.push({
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
    const patchId = this.savePatch(path, pureOps);
    const saveFileRes: { filePath: string; error?: PatchError }[] =
      await Promise.all(
        Object.entries(files).map(async ([filePath, data]) => {
          if (data.error) {
            return { filePath, error: data.error };
          } else {
            const res = await this.saveFile(
              filePath,
              data.value,
              data.sha256,
              patchId
            );
            if (res === false) {
              return { filePath };
            } else {
              return { filePath, error: res };
            }
          }
        })
      );
    return {
      patchId,
      files: saveFileRes,
    };
  }

  getMimeTypeFromFile(filePath: string, buffer: Buffer) {
    return guessMimeTypeFromPath(filePath);
  }

  // #region public abstract ops
  abstract getPatches(patchIds: PatchId[]): Promise<{
    [patchId: PatchId]: { path: ModuleId; patch: Patch };
  }>;
  abstract getFile(
    fileRef: string,
    patchId: PatchId | null
  ): Promise<Buffer | null>;
  // #region protected abstract ops
  protected abstract savePatch(path: ModuleId, patch: Patch): PatchId;
  protected abstract saveFile(
    filePath: string,
    value: string,
    sha256: string,
    patchId: PatchId
  ): Promise<false | PatchError>;
  protected abstract getPatchMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[],
    patchId: PatchId
  ): Promise<OpsMetadata>;
  protected abstract getFileMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[]
  ): Promise<OpsMetadata>;
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

type OpsMetadata = {
  metadata: Record<string, string | number>;
  errors?: (
    | {
        message: string;
        field: string;
      }
    | {
        message: string;
        filePath?: string;
      }
  )[];
};

class MemoryValOps extends ValOps {
  patches: { [patchId: PatchId]: { path: ModuleId; patch: Patch } } = {};
  patchedFiles: {
    [patchId: PatchId]: Record<string, { value: string; sha256: string }>;
  } = {};
  patchIdCounter = 0;
  constructor(
    valModules: ValModules,
    private files: {
      [filePath: string]: Buffer;
    } = {}
  ) {
    super(valModules);
  }

  async getPatches(
    patchIds: PatchId[]
  ): Promise<{ [patchId: PatchId]: { path: ModuleId; patch: Patch } }> {
    const res: { [patchId: PatchId]: { path: ModuleId; patch: Patch } } = {};
    for (const patchId of patchIds) {
      res[patchId] = this.patches[patchId];
    }
    return res;
  }

  private createMetadataFromBuffer(
    filePath: string,
    type: "file" | "image",
    fields: string[],
    buffer: Buffer,
    value?: string
  ): OpsMetadata {
    let mimeType;
    if (value) {
      mimeType = getMimeTypeFromBase64(value);
      if (!mimeType) {
        return {
          metadata: {},
          errors: [
            {
              message: "Could not get mimeType from base 64 encoded value",
            },
          ],
        };
      }
    } else {
      mimeType = this.getMimeTypeFromFile(filePath, buffer);
      if (!mimeType) {
        return {
          metadata: {},
          errors: [
            {
              message: "Could not get mimeType from file",
              filePath,
            },
          ],
        };
      }
    }
    let sha256;
    if (value) {
      sha256 = Internal.getSHA256Hash(textEncoder.encode(value));
    } else {
      sha256 = getSha256(mimeType, buffer);
    }
    const errors = [];
    let availableMetadata: Record<string, string | number | undefined | null>;
    if (type === "image") {
      const { width, height, type } = sizeOf(buffer);
      availableMetadata = {
        sha256: sha256,
        mimeType: type && `image/${type}`,
        height,
        width,
      };
    } else {
      availableMetadata = {
        sha256: sha256,
        mimeType: this.getMimeTypeFromFile(filePath, buffer),
      };
    }
    const metadata: Record<string, string | number> = {};
    for (const field of fields) {
      const foundFieldData =
        field in availableMetadata ? availableMetadata[field] : null;
      if (foundFieldData !== undefined && foundFieldData !== null) {
        metadata[field] = foundFieldData;
      } else {
        errors.push({ message: `Field not found: '${field}'`, field });
      }
    }
    return { metadata, errors };
  }

  protected async getPatchMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[],
    patchId: PatchId
  ): Promise<OpsMetadata> {
    const patchedFiles = this.patchedFiles[patchId];
    if (!patchedFiles) {
      return {
        metadata: {},
        errors: [{ message: "Patch not found", filePath }],
      };
    }
    const patchedFile = patchedFiles[filePath];
    if (!patchedFile) {
      return {
        metadata: {},
        errors: [{ message: "File not found", filePath }],
      };
    }
    const buffer = bufferFromDataUrl(patchedFile.value, null);
    if (!buffer) {
      return {
        metadata: {},
        errors: [
          {
            message: "Could not create buffer from data url",
            filePath,
          },
        ],
      };
    }
    return this.createMetadataFromBuffer(
      filePath,
      type,
      fields,
      buffer,
      patchedFile.value
    );
  }

  protected async getFileMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[]
  ): Promise<OpsMetadata> {
    const buffer = this.files[filePath];
    if (!buffer) {
      return {
        metadata: {},
        errors: [{ message: "File not found", filePath }],
      };
    }
    return this.createMetadataFromBuffer(filePath, type, fields, buffer);
  }

  async getFile(
    fileRef: string,
    patchId: PatchId | null
  ): Promise<Buffer | null> {
    if (patchId) {
      const patchedFiles = this.patchedFiles[patchId];
      if (!patchedFiles) {
        return null;
      }
      const patchedFile = patchedFiles[fileRef];
      if (!patchedFile) {
        return null;
      }
      return bufferFromDataUrl(patchedFile.value, null) ?? null;
    }
    return this.files[fileRef] ?? null;
  }
  protected savePatch(path: ModuleId, patch: Patch): PatchId {
    const patchId = (this.patchIdCounter++).toString() as PatchId;
    this.patches[patchId] = { path, patch };
    return patchId;
  }
  protected async saveFile(
    filePath: string,
    value: string,
    sha256: string,
    patchId: PatchId
  ): Promise<false | PatchError> {
    if (!this.patchedFiles[patchId]) {
      this.patchedFiles[patchId] = {};
    }
    if (this.patchedFiles[patchId][filePath]) {
      return new PatchError("File already exists");
    }
    this.patchedFiles[patchId][filePath] = { value, sha256 };
    return false;
  }
}
