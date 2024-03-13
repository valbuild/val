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
    const readRes = await this.readPatches();
    if (result.isErr(readRes)) {
      return readRes.error;
    }
    const res: ApiGetPatchResponse = {};
    const { patchIdsByModuleId, patchesById } = readRes.value;
    for (const moduleIdStr in patchIdsByModuleId) {
      const moduleId = moduleIdStr as ModuleId;
      if (
        (query.id && query.id.includes(moduleId)) ||
        !query.id ||
        query.id.length === 0
      ) {
        res[moduleId] = patchIdsByModuleId[moduleId].map((patchId) => {
          let createdAt = new Date(0);
          try {
            createdAt = new Date(parseInt(patchId, 10));
          } catch (e) {
            console.error(
              "Val: unexpected error parsing patch ids. Is cache corrupt?",
              {
                patchId,
                file: this.getPatchFilePath(patchId),
                dir: this.getPatchesCacheDir(),
                error: e,
              }
            );
            throw Error(
              "Unexpected error parsing patch ids. Is cache corrupt?"
            );
          }
          return {
            patch_id: patchId,
            patch: patchesById[patchId],
            created_at: createdAt.toISOString(),
          };
        });
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

  protected async readPatches(): Promise<
    result.Result<
      {
        patches: [PatchId, ModuleId, Patch][];
        patchIdsByModuleId: Record<ModuleId, PatchId[]>;
        patchesById: Record<PatchId, Patch>;
      },
      ValServerError
    >
  > {
    const patches: [PatchId, ModuleId, Patch][] = [];
    const patchIdsByModuleId: Record<ModuleId, PatchId[]> = {};
    const patchesById: Record<PatchId, Patch> = {};
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
    const sortedPatchIds = files
      .map((file) => parseInt(path.basename(file), 10))
      .sort();
    for (const patchIdStr of sortedPatchIds) {
      const patchId = patchIdStr.toString() as PatchId;
      let parsedPatches: Record<string, Patch> = {};
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
          console.error(
            "Val: unexpected error reading patch. Is there a mismatch in Val versions? Perhaps Val is misconfigured?",
            { patchId, error: currentParsedPatches.error }
          );
          return result.err({
            status: 500,
            json: {
              message:
                "Unexpected error reading patch. Is there a mismatch in Val versions? Perhaps Val is misconfigured?",
              details: {
                patchId,
                error: currentParsedPatches.error,
              },
            },
          });
        }
        parsedPatches = currentParsedPatches.data;
      } catch (err) {
        console.error(
          "Val: unexpected error reading cached file. Try deleting the cache directory.",
          { patchId, error: err, dir: this.patchesRootPath }
        );
        return result.err({
          status: 500,
          json: {
            message: "Unexpected error reading cache file.",
            details: {
              patchId,
              error: err,
            },
          },
        });
      }
      for (const moduleIdStr in parsedPatches) {
        const moduleId = moduleIdStr as ModuleId;
        if (!patchIdsByModuleId[moduleId]) {
          patchIdsByModuleId[moduleId] = [];
        }
        patchIdsByModuleId[moduleId].push(patchId);
        const parsedPatch = parsedPatches[moduleId];
        patches.push([patchId, moduleId, parsedPatch]);
        patchesById[patchId] = parsedPatch;
      }
    }
    return result.ok({
      patches,
      patchIdsByModuleId,
      patchesById,
    });
  }

  private getPatchesCacheDir() {
    return path.join(this.patchesRootPath, LocalValServer.PATCHES_DIR);
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

  async getFiles(): Promise<
    ValServerResult<never, ReadableStream<Uint8Array>>
  > {
    return this.badRequest();
  }
}
