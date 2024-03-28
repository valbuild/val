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
  PatchFileMetadata,
  ValServer,
  ValServerCallbacks,
  bufferFromDataUrl,
  bufferToReadableStream,
  getMimeTypeFromBase64,
  guessMimeTypeFromPath,
} from "./ValServer";
import { SerializedModuleContent } from "./SerializedModuleContent";

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
  private static readonly PATCHES_DIR = "patches";
  private static readonly FILES_DIR = "files";
  private readonly patchesRootPath: string;
  constructor(
    readonly options: LocalValServerOptions,
    readonly callbacks: ValServerCallbacks
  ) {
    super(
      options.service.sourceFileHandler.projectRoot,
      options.service.sourceFileHandler.host,
      options,
      callbacks
    );

    this.patchesRootPath =
      options.cacheDir ||
      path.join(options.service.sourceFileHandler.projectRoot, ".val");
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
      deletedPatches.push(patchId as PatchId);
      this.host.rmFile(
        path.join(this.patchesRootPath, LocalValServer.PATCHES_DIR, patchId)
      );
    }

    throw Error("TODO: implement delete files when deleting patches");
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
            created_at: createdAt.toString(),
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

  protected async ensureRemoteFSInitialized(): Promise<
    result.Result<undefined, ValServerError>
  > {
    // No RemoteFS so nothing to ensure
    return result.ok(undefined);
  }

  protected getModule(moduleId: ModuleId): Promise<SerializedModuleContent> {
    return this.options.service.get(moduleId);
  }

  protected async execCommit(
    patches: [PatchId, ModuleId, Patch][]
  ): Promise<Record<ModuleId, { patches: { applied: PatchId[] } }>> {
    for (const [patchId, moduleId, patch] of patches) {
      // TODO: patch the entire module content directly by using a { path: "", op: "replace", value: patchedData }?
      // Reason: that would be more atomic? Not doing it now, because there are currently already too many moving pieces.
      // Other things we could do would be to patch in a temp directory and ONLY when all patches are applied we move back in.
      // This would improve reliability
      this.host.rmFile(this.getPatchFilePath(patchId));
      await this.options.service.patch(moduleId, patch);
    }
    return this.getPatchedModules(patches);
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
