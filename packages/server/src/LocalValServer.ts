import { Service } from "./Service";
import { result } from "@valbuild/core/fp";
import { Patch } from "./patch/validation";
import {
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ModuleId,
  PatchId,
  ApiDeletePatchResponse,
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
import { ValServer, ValServerCallbacks } from "./ValServer";
import fs from "fs";
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

export class LocalValServer extends ValServer {
  private static readonly PATCHES_DIR = "patches";
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

  async getFiles(): Promise<
    ValServerResult<never, ReadableStream<Uint8Array>>
  > {
    return this.badRequest();
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
    const parsedPatches: Record<ModuleId, Patch> = {};
    const fileId = Date.now().toString() as PatchId;
    const res: ApiPostPatchResponse = {};
    for (const moduleIdStr in patches.data) {
      const moduleId = moduleIdStr as ModuleId; // TODO: validate that this is a valid module id
      res[moduleId] = {
        patch_id: fileId.toString() as PatchId,
      };
      parsedPatches[moduleId] = patches.data[moduleId];
    }
    this.host.writeFile(
      this.getPatchFilePath(fileId),
      JSON.stringify(patches.data),
      "utf8"
    );
    return {
      status: 200,
      json: res,
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
      files = this.host.readDirectory(patchesCacheDir, [""], [], []);
    } catch (e) {
      // no patches to apply
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

  protected async readBuffer(filePath: string): Promise<Buffer> {
    return fs.promises.readFile(filePath);
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

  protected getPatchedModules(
    patches: [PatchId, ModuleId, Patch][]
  ): Promise<Record<ModuleId, { patches: { applied: PatchId[] } }>> {
    return this.commitOrGetModulesWithAppliedPatches(false, patches);
  }

  protected execCommit(
    patches: [PatchId, ModuleId, Patch][]
  ): Promise<Record<ModuleId, { patches: { applied: PatchId[] } }>> {
    return this.commitOrGetModulesWithAppliedPatches(true, patches);
  }

  private async commitOrGetModulesWithAppliedPatches(
    commit: boolean,
    patches: [PatchId, ModuleId, Patch][]
  ) {
    const modules: Record<
      ModuleId,
      {
        patches: {
          applied: PatchId[];
        };
      }
    > = {};
    for (const [patchId, moduleId, patch] of patches) {
      if (!modules[moduleId]) {
        modules[moduleId] = {
          patches: {
            applied: [],
          },
        };
      }
      if (commit) {
        // TODO: patch the entire module content directly by using a { path: "", op: "replace", value: patchedData }?
        // Reason: that would be more atomic? Not doing it now, because there are currently already too many moving pieces.
        // Other things we could do would be to patch in a temp directory and ONLY when all patches are applied we move back in.
        // This would improve reliability
        this.host.rmFile(this.getPatchFilePath(patchId));
        await this.options.service.patch(moduleId, patch);
      }
      // during validation we build this up again, wanted to following the same flows for validation and for commits
      modules[moduleId].patches.applied.push(patchId);
    }
    return modules;
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
