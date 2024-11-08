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
  SchemaSha,
  CommitSha,
} from "./ValOps";
import fsPath from "path";
import ts from "typescript";
import { z } from "zod";
import fs from "fs";
import nodePath from "path";
import { fromError } from "zod-validation-error";
import { Patch } from "./patch/validation";
import { guessMimeTypeFromPath } from "./ValServer";

export class ValOpsFS extends ValOps {
  private static readonly VAL_DIR = ".val";
  private readonly host: FSOpsHost;
  constructor(
    private readonly rootDir: string,
    valModules: ValModules,
    options?: ValOpsOptions,
  ) {
    super(valModules, options);
    this.host = new FSOpsHost();
  }

  override async onInit(): Promise<void> {
    // do nothing
  }

  async getStat(
    params: {
      baseSha: BaseSha;
      schemaSha: SchemaSha;
      patches: PatchId[];
      profileId?: AuthorId;
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
    | { type: "error"; error: GenericErrorMessage }
  > {
    // In ValOpsFS, we don't have a websocket server to listen to file changes so we use long-polling.
    // If a file that Val depends on changes, we break the connection and tell the client to request again to get the latest values.
    try {
      const currentBaseSha = await this.getBaseSha();
      const currentSchemaSha = await this.getSchemaSha();
      const moduleFilePaths = Object.keys(await this.getSchemas());

      const patchData = await this.readPatches();
      const patches: PatchId[] = [];
      // TODO: use proper patch sequences when available:
      for (const [patchId] of Object.entries(patchData.patches).sort(
        ([, a], [, b]) => {
          return a.createdAt.localeCompare(b.createdAt, undefined);
        },
      )) {
        patches.push(patchId as PatchId);
      }
      // something changed: return immediately
      const didChange =
        !params ||
        currentBaseSha !== params.baseSha ||
        currentSchemaSha !== params.schemaSha ||
        patches.length !== params.patches.length ||
        patches.some((p, i) => p !== params.patches[i]);
      if (didChange) {
        return {
          type: "did-change",
          baseSha: currentBaseSha,
          schemaSha: currentSchemaSha,
          patches,
        };
      }
      let fsWatcher: fs.FSWatcher | null = null;
      let stopPolling = false;
      const didDirectoryChangeUsingPolling = (
        dir: string,
        interval: number,
        setHandle: (h: NodeJS.Timeout) => void,
      ): Promise<"request-again"> => {
        const mtimeInDir: Record<string, number> = {};
        if (fs.existsSync(dir)) {
          for (const file of fs.readdirSync(dir)) {
            mtimeInDir[file] = fs
              .statSync(nodePath.join(dir, file))
              .mtime.getTime();
          }
        }
        return new Promise<"request-again">((resolve) => {
          const go = (resolve: (v: "request-again") => void) => {
            const start = Date.now();
            if (fs.existsSync(dir)) {
              const subDirs = fs.readdirSync(dir);
              // amount of files changed
              if (subDirs.length !== Object.keys(mtimeInDir).length) {
                resolve("request-again");
              }
              for (const file of fs.readdirSync(dir)) {
                const mtime = fs
                  .statSync(nodePath.join(dir, file))
                  .mtime.getTime();
                if (mtime !== mtimeInDir[file]) {
                  resolve("request-again");
                }
              }
            } else {
              // dir had files, but now is deleted
              if (Object.keys(mtimeInDir).length > 0) {
                resolve("request-again");
              }
            }
            if (Date.now() - start > interval) {
              console.warn("Val: polling interval of patches exceeded");
            }
            if (stopPolling) {
              return;
            }
            setHandle(setTimeout(() => go(resolve), interval));
          };
          setHandle(setTimeout(() => go(resolve), interval));
        });
      };

      const didFilesChangeUsingPolling = (
        files: string[],
        interval: number,
        setHandle: (h: NodeJS.Timeout) => void,
      ): Promise<"request-again"> => {
        const mtimes: Record<string, number> = {};
        for (const file of files) {
          if (fs.existsSync(file)) {
            mtimes[file] = fs.statSync(file).mtime.getTime();
          } else {
            mtimes[file] = -1;
          }
        }
        return new Promise<"request-again">((resolve) => {
          const go = (resolve: (v: "request-again") => void) => {
            const start = Date.now();
            for (const file of files) {
              const mtime = fs.existsSync(file)
                ? fs.statSync(file).mtime.getTime()
                : -1;
              if (mtime !== mtimes[file]) {
                resolve("request-again");
              }
            }
            if (Date.now() - start > interval) {
              console.warn("Val: polling interval of files exceeded");
            }
            setHandle(setTimeout(() => go(resolve), interval));
          };
          if (stopPolling) {
            return;
          }
          setHandle(setTimeout(() => go(resolve), interval));
        });
      };

      const statFilePollingInterval =
        this.options?.statFilePollingInterval || 250; // relatively low interval, but there would typically not be that many files (less than 1000 at the very least) - hopefully if we have customers with more files than that, we also have devs working on Val that easily can fix this :) Besides this is just the default
      const disableFilePolling = this.options?.disableFilePolling || false;
      let patchesDirHandle: NodeJS.Timeout;
      let valFilesIntervalHandle: NodeJS.Timeout;
      const type = await Promise.race([
        // we poll the patches directory for changes since fs.watch does not work reliably on all system (in particular on WSL) and just checking the patches dir is relatively cheap
        disableFilePolling
          ? new Promise<"request-again">(() => {})
          : didDirectoryChangeUsingPolling(
              this.getPatchesDir(),
              statFilePollingInterval,
              (handle) => {
                patchesDirHandle = handle;
              },
            ),
        // we poll the files that Val depends on for changes
        disableFilePolling
          ? new Promise<"request-again">(() => {})
          : didFilesChangeUsingPolling(
              [
                nodePath.join(this.rootDir, "val.config.ts"),
                nodePath.join(this.rootDir, "val.modules.ts"),
                nodePath.join(this.rootDir, "val.config.js"),
                nodePath.join(this.rootDir, "val.modules.js"),
                ...moduleFilePaths.map((p) => nodePath.join(this.rootDir, p)),
              ],
              statFilePollingInterval,
              (handle) => {
                valFilesIntervalHandle = handle;
              },
            ),
        new Promise<"request-again">((resolve) => {
          fsWatcher = fs.watch(
            this.rootDir,
            {
              recursive: true,
            },
            (eventType, filename) => {
              if (!filename) {
                return;
              }
              const isChange =
                filename.startsWith(
                  this.getPatchesDir().slice(this.rootDir.length + 1),
                ) ||
                filename.endsWith(".val.ts") ||
                filename.endsWith(".val.js") ||
                filename.endsWith("val.config.ts") ||
                filename.endsWith("val.config.js") ||
                filename.endsWith("val.modules.ts") ||
                filename.endsWith("val.modules.js");
              if (isChange) {
                // a file that Val depends on just changed or a patch was created, break connection and request stat again to get the new values
                resolve("request-again");
              }
            },
          );
        }),
        new Promise<"no-change">((resolve) =>
          setTimeout(
            () => resolve("no-change"),
            this.options?.statPollingInterval || 20000,
          ),
        ),
      ]).finally(() => {
        if (fsWatcher) {
          fsWatcher.close();
        }
        stopPolling = true;
        clearInterval(patchesDirHandle);
        clearInterval(valFilesIntervalHandle);
      });
      return {
        type,
        baseSha: currentBaseSha,
        schemaSha: currentSchemaSha,
        patches,
      };
    } catch (err) {
      if (err instanceof Error) {
        return { type: "error", error: { message: err.message } };
      }
      return { type: "error", error: { message: "Unknown error (getStat)" } };
    }
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
        [],
      );
    }
    const patches: Patches["patches"] = {};
    const errors: NonNullable<Patches["errors"]> = {};

    const edPatchIds = patchJsonFiles
      .map((file) => parseInt(fsPath.basename(fsPath.dirname(file)), 10))
      .sort();
    for (const patchIdNum of edPatchIds) {
      if (Number.isNaN(patchIdNum)) {
        throw new Error(
          "Could not parse patch id from file name. Files found: " +
            patchJsonFiles.join(", "),
        );
      }
      const patchId = patchIdNum.toString() as PatchId;
      if (includes && includes.length > 0 && !includes.includes(patchId)) {
        continue;
      }
      const parsedFSPatchRes = this.parseJsonFile(
        this.getPatchFilePath(patchId),
        FSPatch,
      );

      let parsedFSPatchBaseRes = undefined;
      if (this.host.fileExists(this.getPatchBaseFile(patchId))) {
        parsedFSPatchBaseRes = this.parseJsonFile(
          this.getPatchBaseFile(patchId),
          FSPatchBase,
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
      filters.patchIds,
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
    parser?: z.ZodType<T>,
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
              fromError(parsed.error).toString(),
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
    authorId: AuthorId | null,
  ): Promise<WithGenericError<{ patchId: PatchId }>> {
    let fileId = Date.now();
    try {
      while (
        this.host.fileExists(
          this.getPatchFilePath(fileId.toString() as PatchId),
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
        JSON.stringify(data),
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
    path: ModuleFilePath,
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
    data: string,
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
    metadata: MetadataOfType<BinaryFileType>,
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
    T extends BinaryFileType,
  >(filePath: string, type: T, patchId: PatchId): Promise<OpsMetadata<T>> {
    const metadataFilePath = this.getBinaryFileMetadataPath(filePath, patchId);
    if (!this.host.fileExists(metadataFilePath)) {
      return {
        errors: [{ message: "Metadata file not found", filePath }],
      };
    }
    const metadataParseRes = this.parseJsonFile(
      metadataFilePath,
      z.record(z.union([z.string(), z.number()])),
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
    patchId: PatchId,
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
      preparedCommit.patchedSourceFiles,
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
      preparedCommit.patchedBinaryFilesDescriptors,
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
    type: T,
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
              filePath,
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

  private getBinaryFilePath(filePath: string, patchId: PatchId) {
    return fsPath.join(
      this.getPatchDir(patchId),
      "files",
      filePath,
      fsPath.basename(filePath),
    );
  }

  private getBinaryFileMetadataPath(filePath: string, patchId: PatchId) {
    return fsPath.join(
      this.getPatchDir(patchId),
      "files",
      filePath,
      "metadata.json",
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
    include: readonly string[],
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
      "Path is not valid. Must start with '/' and include '.val.'",
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
