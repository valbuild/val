import { PatchId, ModuleFilePath, ValModules, Internal } from "@valbuild/core";
import {
  AuthorId,
  BaseSha,
  BinaryFileType,
  PatchesMetadata,
  GenericErrorMessage,
  MetadataOfType,
  OpsMetadata,
  Patches,
  PreparedCommit,
  ValOps,
  ValOpsOptions,
  WithGenericError,
  bufferFromDataUrl,
  createMetadataFromBuffer,
  getFieldsForType,
} from "./ValOps";
import fsPath from "path";
import ts from "typescript";
import { z } from "zod";
import fs from "fs";
import { fromError } from "zod-validation-error";
import { Patch } from "./patch/validation";
import { guessMimeTypeFromPath } from "./ValServer";

export class ValOpsFS extends ValOps {
  private static readonly VAL_DIR = ".val";
  private readonly host: FSOpsHost;
  constructor(
    private readonly rootDir: string,
    valModules: ValModules,
    options?: ValOpsOptions
  ) {
    super(valModules, options);
    this.host = new FSOpsHost();
  }

  override async onInit(): Promise<void> {
    // do nothing
  }

  private async readPatches(includes?: PatchId[]): Promise<Patches> {
    const patchesCacheDir = this.getPatchesDir();
    let patchJsonFiles: readonly string[] = [];
    if (
      !this.host.directoryExists ||
      (this.host.directoryExists && this.host.directoryExists(patchesCacheDir))
    ) {
      patchJsonFiles = this.host.readDirectory(
        patchesCacheDir,
        ["patch.json"],
        [],
        []
      );
    }
    const patches: Patches["patches"] = {};
    const errors: NonNullable<Patches["errors"]> = {};

    const sortedPatchIds = patchJsonFiles
      .map((file) => parseInt(fsPath.basename(fsPath.dirname(file)), 10))
      .sort();
    for (const patchIdNum of sortedPatchIds) {
      if (Number.isNaN(patchIdNum)) {
        throw new Error(
          "Could not parse patch id from file name. Files found: " +
            patchJsonFiles.join(", ")
        );
      }
      const patchId = patchIdNum.toString() as PatchId;
      if (includes && includes.length > 0 && !includes.includes(patchId)) {
        continue;
      }
      const parsedFSPatchRes = this.parseJsonFile(
        this.getPatchFilePath(patchId),
        FSPatch
      );

      let parsedFSPatchBaseRes = undefined;
      if (this.host.fileExists(this.getPatchBaseFile(patchId))) {
        parsedFSPatchBaseRes = this.parseJsonFile(
          this.getPatchBaseFile(patchId),
          FSPatchBase
        );
      }
      if (parsedFSPatchRes.error) {
        errors[patchId] = parsedFSPatchRes.error;
      } else if (parsedFSPatchBaseRes && parsedFSPatchBaseRes.error) {
        errors[patchId] = parsedFSPatchBaseRes.error;
      } else {
        patches[patchId] = {
          ...(parsedFSPatchRes.data as {
            // parseFile does keep refined types?
            path: ModuleFilePath;
            patch: Patch;
            createdAt: string;
            authorId: AuthorId | null;
            coreVersion: string;
          }),
          appliedAt: parsedFSPatchBaseRes
            ? (parsedFSPatchBaseRes.data as {
                // parseFile does keep refined types?
                baseSha: BaseSha;
                timestamp: string;
              })
            : null,
        };
      }
    }
    if (Object.keys(errors).length > 0) {
      return { patches, errors };
    }
    return { patches };
  }

  override async fetchPatches<OmitPatch extends boolean>(filters: {
    authors?: AuthorId[];
    patchIds?: PatchId[];
    moduleFilePaths?: ModuleFilePath[];
    omitPatch: OmitPatch;
  }): Promise<OmitPatch extends true ? PatchesMetadata : Patches> {
    const patches: (OmitPatch extends true
      ? PatchesMetadata
      : Patches)["patches"] = {};
    const errors: NonNullable<
      (OmitPatch extends true ? PatchesMetadata : Patches)["errors"]
    > = {};
    const { errors: allErrors, patches: allPatches } = await this.readPatches(
      filters.patchIds
    );
    for (const [patchIdS, patch] of Object.entries(allPatches)) {
      const patchId = patchIdS as PatchId;
      if (
        filters.authors &&
        !(patch.authorId === null || filters.authors.includes(patch.authorId))
      ) {
        continue;
      }
      if (
        filters.moduleFilePaths &&
        !filters.moduleFilePaths.includes(patch.path)
      ) {
        continue;
      }
      patches[patchId] = {
        patch: filters.omitPatch ? undefined : patch.patch,
        path: patch.path,
        createdAt: patch.createdAt,
        authorId: patch.authorId,
        appliedAt: patch.appliedAt,
      };
      const error = allErrors && allErrors[patchId];
      if (error) {
        errors[patchId] = error;
      }
    }
    if (errors && Object.keys(errors).length > 0) {
      return { patches, errors } as OmitPatch extends true
        ? PatchesMetadata
        : Patches;
    }
    return { patches } as OmitPatch extends true ? PatchesMetadata : Patches;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseJsonFile<T = any>(
    filePath: string,
    parser?: z.ZodType<T>
  ):
    | { data: T; error?: undefined }
    | { error: GenericErrorMessage & { filePath: string } } {
    if (!this.host.fileExists(filePath)) {
      return {
        error: {
          message: `File not found: ${filePath}`,
          filePath,
        },
      };
    }
    const data = this.host.readUtf8File(filePath);
    if (!data) {
      return {
        error: {
          message: `File is empty: ${filePath}`,
          filePath,
        },
      };
    }
    let jsonData;
    try {
      jsonData = JSON.parse(data);
    } catch (err) {
      if (
        typeof err === "object" &&
        err &&
        "message" in err &&
        typeof err.message === "string"
      ) {
        return {
          error: {
            message: `Could not parse JSON of file: ${filePath}. Message: ${err.message}`,
            filePath,
          },
        };
      }
      return {
        error: {
          message: "Unknown error",
          filePath,
        },
      };
    }
    if (!parser) {
      return { data: jsonData };
    }
    try {
      const parsed = parser.safeParse(jsonData);
      if (!parsed.success) {
        return {
          error: {
            message: `Could not parse file: ${filePath}. Details: ${JSON.stringify(
              fromError(parsed.error).toString()
            )}`,
            details: parsed.error,
            filePath,
          },
        };
      }
      return { data: parsed.data };
    } catch (err) {
      if (
        typeof err === "object" &&
        err &&
        "message" in err &&
        typeof err.message === "string"
      ) {
        return {
          error: {
            message: `Could not parse JSON of file: ${filePath}. Message: ${err.message}`,
            filePath,
          },
        };
      }
      return {
        error: {
          message: "Unknown error",
          filePath,
        },
      };
    }
  }

  protected override async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: Patch,
    authorId: AuthorId | null
  ): Promise<WithGenericError<{ patchId: PatchId }>> {
    let fileId = Date.now();
    try {
      while (
        this.host.fileExists(
          this.getPatchFilePath(fileId.toString() as PatchId)
        )
      ) {
        // ensure unique file / patch id
        fileId++;
      }
      const patchId = fileId.toString() as PatchId;
      const data: z.infer<typeof FSPatch> = {
        patch,
        path,
        authorId,
        coreVersion: Internal.VERSION.core,
        createdAt: new Date().toISOString(),
      };
      this.host.writeUf8File(
        this.getPatchFilePath(patchId),
        JSON.stringify(data)
      );
      return { patchId };
    } catch (err) {
      if (err instanceof Error) {
        return { error: { message: err.message } };
      }
      return { error: { message: "Unknown error" } };
    }
  }

  protected override async getSourceFile(
    path: ModuleFilePath
  ): Promise<WithGenericError<{ data: string }>> {
    const filePath = fsPath.join(this.rootDir, path);
    if (!this.host.fileExists(filePath)) {
      return {
        error: { message: `File not found: ${filePath}` },
      };
    }
    return {
      data: this.host.readUtf8File(filePath),
    };
  }

  protected async saveSourceFile(
    path: ModuleFilePath,
    data: string
  ): Promise<WithGenericError<{ path: ModuleFilePath }>> {
    const filePath = fsPath.join(this.rootDir, ...path.split("/"));
    try {
      this.host.writeUf8File(filePath, data);
      return { path };
    } catch (err) {
      if (err instanceof Error) {
        return { error: { message: err.message } };
      }
      return { error: { message: "Unknown error" } };
    }
  }

  protected override async saveBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId,
    data: string,
    _type: BinaryFileType,
    metadata: MetadataOfType<BinaryFileType>
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    const patchFilePath = this.getBinaryFilePath(filePath, patchId);
    const metadataFilePath = this.getBinaryFileMetadataPath(filePath, patchId);
    try {
      const buffer = bufferFromDataUrl(data);
      if (!buffer) {
        return {
          error: {
            message:
              "Could not create buffer from data url. Not a data url? First chars were: " +
              data.slice(0, 20),
          },
        };
      }
      this.host.writeUf8File(metadataFilePath, JSON.stringify(metadata));
      this.host.writeBinaryFile(patchFilePath, buffer);
      return { patchId, filePath };
    } catch (err) {
      if (err instanceof Error) {
        return { error: { message: err.message } };
      }
      return { error: { message: "Unknown error" } };
    }
  }

  protected override async getBase64EncodedBinaryFileMetadataFromPatch<
    T extends BinaryFileType
  >(filePath: string, type: T, patchId: PatchId): Promise<OpsMetadata<T>> {
    const metadataFilePath = this.getBinaryFileMetadataPath(filePath, patchId);
    if (!this.host.fileExists(metadataFilePath)) {
      return {
        errors: [{ message: "Metadata file not found", filePath }],
      };
    }
    const metadataParseRes = this.parseJsonFile(
      metadataFilePath,
      z.record(z.union([z.string(), z.number()]))
    );
    if (metadataParseRes.error) {
      return { errors: [metadataParseRes.error] };
    }
    const parsed = metadataParseRes.data;
    const expectedFields = getFieldsForType(type);
    const fieldErrors = [];
    for (const field of expectedFields) {
      if (!(field in parsed)) {
        fieldErrors.push({
          message: `Expected fields for type: ${type}. Field not found: '${field}'`,
          field,
        });
      }
    }
    if (fieldErrors.length > 0) {
      return { errors: fieldErrors };
    }
    return { metadata: parsed } as OpsMetadata<T>;
  }

  override async getBase64EncodedBinaryFileFromPatch(
    filePath: string,
    patchId: PatchId
  ): Promise<Buffer | null> {
    const absPath = this.getBinaryFilePath(filePath, patchId);

    if (!this.host.fileExists(absPath)) {
      return null;
    }
    return this.host.readBinaryFile(absPath);
  }

  override async deletePatches(patchIds: PatchId[]): Promise<
    | { deleted: PatchId[]; errors?: undefined; error?: undefined }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage>;
      }
    | { error: GenericErrorMessage; errors?: undefined; deleted?: undefined }
  > {
    const deleted: PatchId[] = [];
    let errors: Record<PatchId, GenericErrorMessage> | null = null;
    for (const patchId of patchIds) {
      try {
        this.host.deleteDir(this.getPatchDir(patchId));
        deleted.push(patchId);
      } catch (err) {
        if (!errors) {
          errors = {};
        }
        errors[patchId] = {
          message: err instanceof Error ? err.message : "Unknown error",
        };
      }
    }
    if (errors) {
      return { deleted, errors };
    }
    return { deleted };
  }

  async saveFiles(preparedCommit: PreparedCommit): Promise<{
    updatedFiles: string[];
    errors: Record<string, GenericErrorMessage & { filePath: string }>;
  }> {
    const updatedFiles: string[] = [];
    const errors: Record<string, GenericErrorMessage & { filePath: string }> =
      {};

    for (const [filePath, data] of Object.entries(
      preparedCommit.patchedSourceFiles
    )) {
      const absPath = fsPath.join(this.rootDir, ...filePath.split("/"));
      try {
        this.host.writeUf8File(absPath, data);
        updatedFiles.push(absPath);
      } catch (err) {
        errors[absPath] = {
          message: err instanceof Error ? err.message : "Unknown error",
          filePath,
        };
      }
    }

    for (const [filePath, { patchId }] of Object.entries(
      preparedCommit.patchedBinaryFilesDescriptors
    )) {
      const absPath = fsPath.join(this.rootDir, ...filePath.split("/"));
      try {
        this.host.copyFile(this.getBinaryFilePath(filePath, patchId), absPath);
        updatedFiles.push(absPath);
      } catch (err) {
        errors[absPath] = {
          message: err instanceof Error ? err.message : "Unknown error",
          filePath,
        };
      }
    }

    for (const patchId of Object.values(preparedCommit.appliedPatches).flat()) {
      const appliedAt: z.infer<typeof FSPatchBase> = {
        baseSha: await this.getBaseSha(),
        timestamp: new Date().toISOString(),
      };
      const absPath = this.getPatchBaseFile(patchId);
      try {
        this.host.writeUf8File(absPath, JSON.stringify(appliedAt));
      } catch (err) {
        errors[absPath] = {
          message: err instanceof Error ? err.message : "Unknown error",
          filePath: absPath,
        };
      }
    }
    return {
      updatedFiles,
      errors,
    };
  }

  override async getBinaryFile(filePath: string): Promise<Buffer | null> {
    const absPath = fsPath.join(this.rootDir, ...filePath.split("/"));
    if (!this.host.fileExists(absPath)) {
      return null;
    }
    const buffer = this.host.readBinaryFile(absPath);
    return buffer;
  }

  protected override async getBinaryFileMetadata<T extends BinaryFileType>(
    filePath: string,
    type: T
  ): Promise<OpsMetadata<T>> {
    const buffer = await this.getBinaryFile(filePath);
    if (!buffer) {
      return {
        errors: [{ message: "File not found", filePath }],
      };
    }
    const mimeType = guessMimeTypeFromPath(filePath);
    if (!mimeType) {
      return {
        errors: [
          {
            message: `Could not guess mime type of file ext: ${fsPath.extname(
              filePath
            )}`,
            filePath,
          },
        ],
      };
    }
    return createMetadataFromBuffer(type, mimeType, buffer);
  }

  // #region fs file path helpers
  private getPatchesDir() {
    return fsPath.join(this.rootDir, ValOpsFS.VAL_DIR, "patches");
  }

  private getPatchDir(patchId: PatchId) {
    return fsPath.join(this.getPatchesDir(), patchId);
  }

  private getBinaryFilePath(filename: string, patchId: PatchId) {
    return fsPath.join(
      this.getPatchDir(patchId),
      "files",
      filename,
      fsPath.basename(filename)
    );
  }

  private getBinaryFileMetadataPath(filename: string, patchId: PatchId) {
    return fsPath.join(
      this.getPatchDir(patchId),
      "files",
      filename,
      "metadata.json"
    );
  }

  private getPatchFilePath(patchId: PatchId) {
    return fsPath.join(this.getPatchDir(patchId), "patch.json");
  }

  private getPatchBaseFile(patchId: PatchId) {
    return fsPath.join(this.getPatchDir(patchId), "base.json");
  }
}

class FSOpsHost {
  constructor() {}

  // TODO: do we want async operations here?
  deleteDir(dir: string) {
    if (this.directoryExists(dir)) {
      fs.rmdirSync(dir, {
        recursive: true,
      });
    }
  }

  directoryExists(path: string): boolean {
    return ts.sys.directoryExists(path);
  }

  readDirectory(
    path: string,
    extensions: readonly string[],
    exclude: readonly string[],
    include: readonly string[]
  ): readonly string[] {
    return ts.sys.readDirectory(path, extensions, exclude, include);
  }

  fileExists(path: string): boolean {
    return ts.sys.fileExists(path);
  }

  readBinaryFile(path: string): Buffer {
    return fs.readFileSync(path);
  }

  readUtf8File(path: string): string {
    return fs.readFileSync(path, "utf-8");
  }

  writeUf8File(path: string, data: string): void {
    fs.mkdirSync(fsPath.dirname(path), { recursive: true });
    fs.writeFileSync(path, data, "utf-8");
  }

  writeBinaryFile(path: string, data: Buffer): void {
    fs.mkdirSync(fsPath.dirname(path), { recursive: true });
    fs.writeFileSync(path, data, "base64url");
  }

  copyFile(from: string, to: string): void {
    fs.mkdirSync(fsPath.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

const FSPatch = z.object({
  path: z
    .string()
    .refine(
      (p): p is ModuleFilePath => p.startsWith("/") && p.includes(".val."),
      "Path is not valid. Must start with '/' and include '.val.'"
    ),
  patch: Patch,
  authorId: z
    .string()
    .refine((p): p is AuthorId => true)
    .nullable(),
  createdAt: z.string().datetime(),
  coreVersion: z.string().nullable(), // TODO: use this to check if patch is compatible with current core version?
});

const FSPatchBase = z.object({
  baseSha: z.string().refine((p): p is BaseSha => true),
  timestamp: z.string().datetime(),
});
