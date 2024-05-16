import { PatchId, ModuleFilePath, ValModules, Internal } from "@valbuild/core";
import {
  AuthorId,
  BaseSha,
  BinaryFileType,
  FindPatches,
  GenericErrorMessage,
  OpsMetadata,
  Patches,
  PreparedCommit,
  ValOps,
  ValOpsOptions,
  WithGenericError,
  getFieldsForType,
} from "./ValOps";
import fsPath from "path";
import ts from "typescript";
import { z } from "zod";
import fs from "fs";
import { getSha256 } from "./extractMetadata";
import sizeOf from "image-size";
import { fromError } from "zod-validation-error";
import { Patch } from "./patch/validation";

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
      if (includes && !includes.includes(patchId)) {
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
            created_at: string;
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

  override async getPatchOpsById(patchIds: PatchId[]): Promise<Patches> {
    return this.readPatches(patchIds);
  }

  override async findPatches(filters: {
    authors?: AuthorId[];
  }): Promise<FindPatches> {
    const patches: FindPatches["patches"] = {};
    const errors: NonNullable<FindPatches["errors"]> = {};
    const { errors: allErrors, patches: allPatches } = await this.readPatches();
    for (const [patchIdS, patch] of Object.entries(allPatches)) {
      const patchId = patchIdS as PatchId;
      if (
        filters.authors &&
        !(patch.authorId === null || filters.authors.includes(patch.authorId))
      ) {
        continue;
      }
      patches[patchId] = {
        path: patch.path,
        created_at: patch.created_at,
        authorId: patch.authorId,
        appliedAt: patch.appliedAt,
      };
      const error = allErrors && allErrors[patchId];
      if (error) {
        errors[patchId] = error;
      }
    }
    if (errors) {
      return { patches, errors };
    }
    return { patches };
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
        created_at: new Date().toISOString(),
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
    type: BinaryFileType,
    patchId: PatchId,
    data: string
    // sha256: string
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
      const mimeType = getMimeTypeFromBase64(data);
      if (!mimeType) {
        return {
          error: {
            message:
              "Could not get mimeType from base 64 encoded value. First chars were: " +
              data.slice(0, 20),
          },
        };
      }
      this.host.writeUf8File(
        metadataFilePath,
        JSON.stringify(createMetadataFromBuffer(filePath, type, buffer))
      );
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
      z.object({
        metadata: z.record(z.union([z.string(), z.number()])),
        errors: z.array(z.object({ message: z.string() })).optional(),
      })
    );
    if (metadataParseRes.error) {
      return { errors: [metadataParseRes.error] };
    }
    const parsed = metadataParseRes.data;
    const expectedFields = getFieldsForType(type);
    const fieldErrors = [];
    for (const field of expectedFields) {
      if (!(field in parsed.metadata)) {
        fieldErrors.push({
          message: `Expected fields for type: ${type}. Field not found: '${field}'`,
          field,
        });
      }
    }
    if (fieldErrors.length > 0) {
      return { errors: fieldErrors };
    }
    return parsed as OpsMetadata<T>;
  }

  protected override async deletePatches(patchIds: PatchId[]): Promise<
    | { deleted: PatchId[]; errors?: undefined }
    | {
        deleted: PatchId[];
        errors: Record<PatchId, GenericErrorMessage & { patchId: PatchId }>;
      }
  > {
    const deleted: PatchId[] = [];
    let errors: Record<
      PatchId,
      GenericErrorMessage & { patchId: PatchId }
    > | null = null;
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
          patchId,
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

  protected override async getBinaryFileMetadata<T extends BinaryFileType>(
    filePath: string,
    type: T
  ): Promise<OpsMetadata<T>> {
    const absPath = fsPath.join(this.rootDir, ...filePath.split("/"));
    if (!this.host.fileExists(absPath)) {
      return {
        errors: [{ message: "File not found", filePath }],
      };
    }
    const buffer = this.host.readBinaryFile(absPath);
    return createMetadataFromBuffer(absPath, type, buffer);
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
  created_at: z.string().datetime(),
  coreVersion: z.string().nullable(), // TODO: use this to check if patch is compatible with current core version?
});

const FSPatchBase = z.object({
  baseSha: z.string().refine((p): p is BaseSha => true),
  timestamp: z.string().datetime(),
});

export function createMetadataFromBuffer<T extends BinaryFileType>(
  filePath: string,
  type: BinaryFileType,
  buffer: Buffer
): OpsMetadata<T> {
  const mimeType = guessMimeTypeFromPath(filePath);
  if (!mimeType) {
    return {
      errors: [
        {
          message: "Could not get mimeType from file",
          filePath,
        },
      ],
    };
  }
  const sha256 = getSha256(mimeType, buffer);

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
      mimeType: guessMimeTypeFromPath(filePath),
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
      base64Index
    );
    return mimeType;
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

function bufferFromDataUrl(dataUrl: string): Buffer | undefined {
  let base64Data;
  const base64Index = dataUrl.indexOf(";base64,");
  if (base64Index > -1) {
    base64Data = dataUrl.slice(base64Index + ";base64,".length);
  }
  if (base64Data) {
    return Buffer.from(
      base64Data,
      "base64" // TODO: why does it not work with base64url?
    );
  }
}
