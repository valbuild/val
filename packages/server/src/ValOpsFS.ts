import { PatchId, ModuleFilePath, ValModules, Internal } from "@valbuild/core";
import { OpsMetadata, ValOps, WithGenericError } from "./ValOps";
import fsPath from "path";
import ts from "typescript";
import { Patch } from "./patch/validation";
import { z } from "zod";
import fs from "fs";
import { getSha256 } from "./extractMetadata";
import sizeOf from "image-size";

const FSPatch = z.object({
  path: z
    .string()
    .refine(
      (p): p is ModuleFilePath => p.startsWith("/") && p.includes(".val."),
      "Path is not valid. Must start with '/' and include '.val.'"
    ),
  patch: Patch,
  created_at: z.string().datetime(),
});
export class ValOpsFS extends ValOps {
  protected getPatchBase64File(
    filePath: string,
    patchId: PatchId
  ): Promise<WithGenericError<{ data: string }>> {
    throw new Error("Method not implemented.");
  }
  private static readonly PATCHES_DIR = "patches";
  private static readonly FILES_DIR = "files";
  private readonly patchesRootPath: string;
  private readonly host: FSOpsHost;
  constructor(
    private readonly cwd: string,
    valModules: ValModules,
    private rootDir: string
  ) {
    super(valModules);
    this.patchesRootPath = fsPath.join(this.rootDir, ValOpsFS.PATCHES_DIR);
    this.host = new FSOpsHost(cwd);
  }

  async getPatchesById(patchIds: PatchId[]): Promise<{
    [patchId: PatchId]: WithGenericError<{
      path: ModuleFilePath;
      patch: Patch;
      created_at: string;
    }>;
  }> {
    const patchesCacheDir = fsPath.join(
      this.patchesRootPath,
      ValOpsFS.PATCHES_DIR
    );
    let files: readonly string[] = [];
    if (
      !this.host.directoryExists ||
      (this.host.directoryExists && this.host.directoryExists(patchesCacheDir))
    ) {
      files = this.host.readDirectory(patchesCacheDir, [""], [], []);
    }
    const res: {
      [patchId: PatchId]: WithGenericError<{
        path: ModuleFilePath;
        patch: Patch;
        created_at: string;
      }>;
    } = {};
    const sortedPatchIds = files
      .map((file) => parseInt(fsPath.basename(file), 10))
      .sort();
    for (const patchIdStr of sortedPatchIds) {
      const patchId = patchIdStr.toString() as PatchId;
      if (!patchIds.includes(patchId)) {
        continue;
      }
      const parsedFSPatchRes = FSPatch.safeParse(
        JSON.parse(
          this.host.readUtf8File(
            fsPath.join(
              this.patchesRootPath,
              ValOpsFS.PATCHES_DIR,
              `${patchId}`
            )
          ) || ""
        )
      );
      if (!parsedFSPatchRes.success) {
        res[patchId] = {
          error: {
            message:
              "Unexpected error reading patch. Patch did not parse correctly. Is there a mismatch in Val versions? Perhaps Val is misconfigured?",
          },
        };
      } else {
        res[patchId] = parsedFSPatchRes.data;
      }
    }
    return res;
  }

  protected async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: Patch
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

  protected getSourceFile(
    path: ModuleFilePath
  ): Promise<WithGenericError<{ data: string }>> {
    const filePath = fsPath.join(this.rootDir, path);
    if (!this.host.fileExists(filePath)) {
      return Promise.resolve({
        error: { message: `File not found: ${filePath}` },
      });
    }
    return Promise.resolve({
      data: this.host.readUtf8File(filePath),
    });
  }

  protected saveSourceFile(
    path: ModuleFilePath,
    data: string
  ): Promise<WithGenericError<{ path: ModuleFilePath }>> {
    const filePath = fsPath.join(this.rootDir, ...path.split("/"));
    try {
      this.host.writeUf8File(filePath, data);
      return Promise.resolve({ path });
    } catch (err) {
      if (err instanceof Error) {
        return Promise.resolve({ error: { message: err.message } });
      }
      return Promise.resolve({ error: { message: "Unknown error" } });
    }
  }

  protected savePatchBase64File(
    filePath: string,
    patchId: PatchId,
    data: string,
    sha256: string
  ): Promise<WithGenericError<{ patchId: PatchId; filePath: string }>> {
    throw new Error("Method not implemented.");
  }
  protected getPatchBase64FileMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[],
    patchId: PatchId
  ): Promise<OpsMetadata> {
    throw new Error("Method not implemented.");
  }
  protected getBinaryFileMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[]
  ): Promise<OpsMetadata> {
    throw new Error("Method not implemented.");
  }

  // #region fs file path helpers
  private getBinaryFilePath(filename: string, patchId: PatchId) {
    return fsPath.join(
      this.patchesRootPath,
      ValOpsFS.PATCHES_DIR,
      patchId,
      "files",
      filename,
      "patch.json"
    );
  }

  private getBinaryFileMetadataPath(filename: string, patchId: PatchId) {
    return fsPath.join(
      this.patchesRootPath,
      ValOpsFS.PATCHES_DIR,
      patchId,
      "files",
      filename,
      "metadata.json"
    );
  }

  private getPatchFilePath(patchId: PatchId) {
    return fsPath.join(
      this.patchesRootPath,
      ValOpsFS.PATCHES_DIR,
      patchId,
      "patch.json"
    );
  }
}

class FSOpsHost {
  constructor(private readonly cwd: string) {}

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
    fs.writeFileSync(path, data, "utf-8");
  }

  writeBinaryFile(path: string, data: Buffer): void {
    fs.writeFileSync(path, data);
  }
}

const textEncoder = new TextEncoder();
export function createMetadataFromBuffer(
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
    mimeType = guessMimeTypeFromPath(filePath);
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
      mimeType: guessMimeTypeFromPath(filePath),
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
