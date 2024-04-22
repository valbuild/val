import { Service } from "./Service";
import { result } from "@valbuild/core/fp";
import { Patch } from "./patch/validation";
import {
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ModuleId,
  PatchId,
  ApiDeletePatchResponse,
  Internal,
  ModulePath,
  FileMetadata,
  ImageMetadata,
} from "@valbuild/core";
import {
  VAL_ENABLE_COOKIE_NAME,
  VAL_SESSION_COOKIE,
  VAL_STATE_COOKIE,
  ValServerError,
  ValServerJsonResult,
  ValServerRedirectResult,
  ValServerResult,
  ValSession,
} from "@valbuild/shared/internal";
import path from "path";
import { z } from "zod";
import {
  ValServer,
  ValServerCallbacks,
  bufferFromDataUrl,
  bufferToReadableStream,
  getMimeTypeFromBase64,
  guessMimeTypeFromPath,
  isCachedPatchFileOp,
} from "./ValServer";
import { SerializedModuleContent } from "./SerializedModuleContent";
import { getSha256 } from "./extractMetadata";
import { IValFSHost } from "./ValFSHost";

export type LocalValServerOptions = {
  service: Service;
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
  cacheDir?: string;
  git: {
    commit?: string;
    branch?: string;
  };
};

export interface ValServerBufferHost {
  readBuffer: (fileName: string) => Promise<Buffer | undefined>;
}

const textEncoder = new TextEncoder();
export class LocalValServer extends ValServer {
  private readonly host: IValFSHost;
  private static readonly PATCHES_DIR = "patches";
  private static readonly FILES_DIR = "files";
  private readonly patchesRootPath: string;
  constructor(
    readonly options: LocalValServerOptions,
    readonly callbacks: ValServerCallbacks
  ) {
    super(options.service.sourceFileHandler.projectRoot, options, callbacks);

    this.patchesRootPath =
      options.cacheDir ||
      path.join(options.service.sourceFileHandler.projectRoot, ".val");
    this.host = this.options.service.sourceFileHandler.host;
  }

  async session(): Promise<ValServerJsonResult<ValSession>> {
    return {
      status: 200,
      json: {
        mode: "local",
        enabled: await this.callbacks.isEnabled(),
      },
    };
  }

  async deletePatches(query: {
    id?: string[];
  }): Promise<ValServerJsonResult<ApiDeletePatchResponse>> {
    const deletedPatches: ApiDeletePatchResponse = [];
    for (const patchId of query.id ?? []) {
      const rawPatchFileContent = this.host.readFile(
        this.getPatchFilePath(patchId as PatchId)
      );

      if (!rawPatchFileContent) {
        console.warn("Val: Patch not found", patchId);
        continue;
      }
      const parsedPatchesRes = z
        .record(Patch)
        .safeParse(JSON.parse(rawPatchFileContent));
      if (!parsedPatchesRes.success) {
        console.warn(
          "Val: Could not parse patch file",
          patchId,
          parsedPatchesRes.error
        );
        continue;
      }

      const files = Object.values(parsedPatchesRes.data).flatMap((ops) =>
        ops
          .filter(isCachedPatchFileOp)
          .map((op) => ({ filePath: op.filePath, sha256: op.value.sha256 }))
      );
      for (const file of files) {
        this.host.rmFile(this.getFilePath(file.filePath, file.sha256));
        this.host.rmFile(this.getFileMetadataPath(file.filePath, file.sha256));
      }
      this.host.rmFile(
        path.join(this.patchesRootPath, LocalValServer.PATCHES_DIR, patchId)
      );
      deletedPatches.push(patchId as PatchId);
    }
    return {
      status: 200,
      json: deletedPatches,
    };
  }

  async postPatches(
    body: unknown
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>> {
    const patches = z.record(Patch).safeParse(body);
    if (!patches.success) {
      return {
        status: 404,
        json: {
          message: `Invalid patch: ${patches.error.message}`,
          details: patches.error.issues,
        },
      };
    }
    let fileId = Date.now();
    while (
      this.host.fileExists(this.getPatchFilePath(fileId.toString() as PatchId))
    ) {
      // ensure unique file / patch id
      fileId++;
    }
    const patchId = fileId.toString() as PatchId;
    const res: ApiPostPatchResponse = {};
    const parsedPatches: Record<ModuleId, Patch> = {};
    for (const moduleIdStr in patches.data) {
      const moduleId = moduleIdStr as ModuleId; // TODO: validate that this is a valid module id
      res[moduleId] = {
        patch_id: patchId,
      };
      parsedPatches[moduleId] = [];
      for (const op of patches.data[moduleId]) {
        // We do not want to include value of a file op in the patch as they potentially contain a lot of data,
        // therefore we store the file in a separate file and only store the sha256 hash in the patch.
        // I.e. the patch that frontend sends is not the same as the one stored.
        // Large amount of text is one thing, but one could easily imagine a lot of patches being accumulated over time with a lot of images which would then consume a non-negligible amount of memory.
        //
        // This is potentially confusing for us working on Val internals, however, the alternative was expected to cause a lot of issues down the line: low performance, a lot of data moved, etc
        // In the worst scenario we imagine this being potentially crashing the server runtime, especially on smaller edge runtimes.
        // Potential crashes are bad enough to warrant this workaround.
        if (Internal.isFileOp(op)) {
          const sha256 = Internal.getSHA256Hash(textEncoder.encode(op.value));
          const mimeType = getMimeTypeFromBase64(op.value);
          if (!mimeType) {
            console.error(
              "Val: Cannot determine mimeType from base64 data",
              op
            );
            throw Error(
              "Cannot determine mimeType from base64 data: " + op.filePath
            );
          }
          const buffer = bufferFromDataUrl(op.value, mimeType);
          if (!buffer) {
            console.error("Val: Cannot parse base64 data", op);
            throw Error("Cannot parse base64 data: " + op.filePath);
          }
          this.host.writeFile(
            this.getFilePath(op.filePath, sha256),
            buffer,
            "binary"
          );
          this.host.writeFile(
            this.getFileMetadataPath(op.filePath, sha256),
            JSON.stringify(
              {
                mimeType,
                sha256,
                // useful for debugging / manual inspection
                patchId,
                createdAt: new Date().toISOString(),
              } satisfies PatchFileMetadata,
              null,
              2
            ),
            "utf8"
          );
          parsedPatches[moduleId].push({
            ...op,
            value: { sha256, mimeType },
          });
        } else {
          parsedPatches[moduleId].push(op);
        }
      }
    }
    this.host.writeFile(
      this.getPatchFilePath(patchId),
      JSON.stringify(parsedPatches),
      "utf8"
    );
    return {
      status: 200,
      json: res,
    };
  }

  async getMetadata(): Promise<FileMetadata | ImageMetadata | undefined> {
    return undefined;
  }

  async getFiles(
    filePath: string,
    query: { sha256?: string }
  ): Promise<ValServerResult<never, ReadableStream<Uint8Array>>> {
    if (query.sha256) {
      const fileExists = this.host.fileExists(
        this.getFilePath(filePath, query.sha256)
      );
      if (fileExists) {
        const metadataFileContent = this.host.readFile(
          this.getFileMetadataPath(filePath, query.sha256)
        );
        const fileContent = await this.readStaticBinaryFile(
          this.getFilePath(filePath, query.sha256)
        );
        if (!fileContent) {
          throw Error(
            "Could not read cached patch file / asset. Cache corrupted?"
          );
        }
        if (!metadataFileContent) {
          throw Error(
            "Missing metadata of cached patch file / asset. Cache corrupted?"
          );
        }
        const metadata: PatchFileMetadata = JSON.parse(metadataFileContent);

        return {
          status: 200,
          headers: {
            "Content-Type": metadata.mimeType,
            "Content-Length": fileContent.byteLength.toString(),
            "Cache-Control": "public, max-age=31536000, immutable",
          },
          body: bufferToReadableStream(fileContent),
        };
      }
    }
    const buffer = await this.readStaticBinaryFile(
      path.join(this.cwd, filePath)
    );
    const mimeType =
      guessMimeTypeFromPath(filePath) || "application/octet-stream";
    if (!buffer) {
      return {
        status: 404,
        json: {
          message: "File not found",
        },
      };
    }
    if (query.sha256) {
      const sha256 = getSha256(mimeType, buffer);
      if (sha256 === query.sha256) {
        return {
          status: 200,
          headers: {
            "Content-Type": mimeType,
            "Content-Length": buffer.byteLength.toString(),
            "Cache-Control": "public, max-age=31536000, immutable",
          },
          body: bufferToReadableStream(buffer),
        };
      }
    }
    return {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": buffer.byteLength.toString(),
      },
      body: bufferToReadableStream(buffer),
    };
  }

  async getPatches(query: {
    id?: string[];
  }): Promise<ValServerJsonResult<ApiGetPatchResponse>> {
    const patchesCacheDir = path.join(
      this.patchesRootPath,
      LocalValServer.PATCHES_DIR
    );
    let files: readonly string[] = [];
    try {
      if (
        !this.host.directoryExists ||
        (this.host.directoryExists &&
          this.host.directoryExists(patchesCacheDir))
      ) {
        files = this.host.readDirectory(patchesCacheDir, [""], [], []);
      }
    } catch (e) {
      console.debug("Failed to read directory (no patches yet?)", e);
    }
    const res: ApiGetPatchResponse = {};
    const sortedPatchIds = files
      .map((file) => parseInt(path.basename(file), 10))
      .sort();
    for (const patchIdStr of sortedPatchIds) {
      const patchId = patchIdStr.toString() as PatchId;
      if (query.id && query.id.length > 0 && !query.id.includes(patchId)) {
        continue;
      }
      try {
        const currentParsedPatches = z
          .record(Patch)
          .safeParse(
            JSON.parse(
              this.host.readFile(
                path.join(
                  this.patchesRootPath,
                  LocalValServer.PATCHES_DIR,
                  `${patchId}`
                )
              ) || ""
            )
          );
        if (!currentParsedPatches.success) {
          const msg =
            "Unexpected error reading patch. Patch did not parse correctly. Is there a mismatch in Val versions? Perhaps Val is misconfigured?";
          console.error(`Val: ${msg}`, {
            patchId,
            error: currentParsedPatches.error,
          });
          return {
            status: 500,
            json: {
              message: msg,
              details: {
                patchId,
                error: currentParsedPatches.error,
              },
            },
          };
        }
        const createdAt = patchId;
        for (const moduleIdStr in currentParsedPatches.data) {
          const moduleId = moduleIdStr as ModuleId;
          if (!res[moduleId]) {
            res[moduleId] = [];
          }
          res[moduleId].push({
            patch: currentParsedPatches.data[moduleId],
            patch_id: patchId,
            created_at: new Date(Number(createdAt)).toISOString(),
          });
        }
      } catch (err) {
        const msg = `Unexpected error while reading patch file. The cache may be corrupted or Val may be misconfigured. Try deleting the cache directory.`;
        console.error(`Val: ${msg}`, {
          patchId,
          error: err,
          dir: this.patchesRootPath,
        });
        return {
          status: 500,
          json: {
            message: msg,
            details: {
              patchId,
              error: err?.toString(),
            },
          },
        };
      }
    }
    return {
      status: 200,
      json: res,
    };
  }

  private getFilePath(filename: string, sha256: string) {
    return path.join(
      this.patchesRootPath,
      LocalValServer.FILES_DIR,
      filename,
      sha256,
      "file"
    );
  }

  private getFileMetadataPath(filename: string, sha256: string) {
    return path.join(
      this.patchesRootPath,
      LocalValServer.FILES_DIR,
      filename,
      sha256,
      "metadata.json"
    );
  }

  private getPatchFilePath(patchId: PatchId) {
    return path.join(
      this.patchesRootPath,
      LocalValServer.PATCHES_DIR,
      patchId.toString()
    );
  }

  private badRequest(): ValServerError {
    return {
      status: 400,
      json: {
        message: "Local server does not handle this request",
      },
    };
  }

  protected async ensureInitialized(): Promise<
    result.Result<undefined, ValServerError>
  > {
    // No RemoteFS so nothing to ensure
    return result.ok(undefined);
  }

  protected getModule(
    moduleId: ModuleId,
    options: { validate: boolean; source: boolean; schema: boolean }
  ): Promise<SerializedModuleContent> {
    return this.options.service.get(moduleId, "" as ModulePath, options);
  }

  protected async getAllModules(treePath: string): Promise<ModuleId[]> {
    const moduleIds: ModuleId[] = this.host
      .readDirectory(
        this.cwd,
        ["ts", "js"],
        ["node_modules", ".*"],
        ["**/*.val.ts", "**/*.val.js"]
      )
      .filter((file) => {
        if (treePath) {
          return file.replace(this.cwd, "").startsWith(treePath);
        }
        return true;
      })
      .map(
        (file) =>
          file
            .replace(this.cwd, "")
            .replace(".val.js", "")
            .replace(".val.ts", "")
            .split(path.sep)
            .join("/") as ModuleId
      );

    return moduleIds;
  }

  protected async execCommit(patches: [PatchId, ModuleId, Patch][]): Promise<
    | {
        status: 200;
        json: Record<
          ModuleId,
          {
            patches: {
              applied: PatchId[];
            };
          }
        >;
      }
    | ValServerError
  > {
    for (const [patchId, moduleId, patch] of patches) {
      // TODO: patch the entire module content directly by using a { path: "", op: "replace", value: patchedData }?
      // Reason: that would be more atomic? Not doing it now, because there are currently already too many moving pieces.
      // Other things we could do would be to patch in a temp directory and ONLY when all patches are applied we move back in.
      // This would improve reliability
      this.host.rmFile(this.getPatchFilePath(patchId));
      await this.options.service.patch(moduleId, patch);
    }
    return { status: 200, json: await this.getPatchedModules(patches) };
  }

  /* Bad requests on Local Server: */

  async authorize(): Promise<ValServerRedirectResult<VAL_STATE_COOKIE>> {
    return this.badRequest();
  }

  async callback(): Promise<
    ValServerRedirectResult<
      VAL_STATE_COOKIE | VAL_SESSION_COOKIE | VAL_ENABLE_COOKIE_NAME
    >
  > {
    return this.badRequest();
  }

  async logout(): Promise<
    ValServerResult<VAL_STATE_COOKIE | VAL_SESSION_COOKIE>
  > {
    return this.badRequest();
  }
}

type PatchFileMetadata = {
  mimeType: string;
  sha256: string;
  patchId: PatchId;
  createdAt: string;
};
