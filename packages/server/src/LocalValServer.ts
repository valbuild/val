import { Service } from "./Service";
import { result } from "@valbuild/core/fp";
import {
  JSONOps,
  JSONValue,
  applyPatch,
  parsePatch,
} from "@valbuild/core/patch";
import { Patch } from "./patch/validation";
import {
  ApiCommitResponse,
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ApiPatchValidationErrorResponse,
  ApiTreeResponse,
  ModuleId,
  PatchId,
  ApiDeletePatchResponse,
  deserializeSchema,
  SourcePath,
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
import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import {
  ValServer,
  getRedirectUrl,
  ENABLE_COOKIE_VALUE,
  ValServerCallbacks,
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

const ops = new JSONOps();

export class LocalValServer implements ValServer {
  private static readonly PATCHES_DIR = "patches";
  private readonly cacheDir: string;
  constructor(
    readonly options: LocalValServerOptions,
    readonly callbacks: ValServerCallbacks
  ) {
    this.cacheDir =
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

  async getTree(
    treePath: string,
    // TODO: use the params: patch, schema, source
    query: { patch?: string; schema?: string; source?: string }
  ): Promise<ValServerJsonResult<ApiTreeResponse>> {
    const rootDir = process.cwd();
    const moduleIds: ModuleId[] = [];
    // iterate over all .val files in the root directory
    const walk = async (dir: string) => {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if ((await fs.stat(path.join(dir, file))).isDirectory()) {
          if (file === "node_modules") continue;
          await walk(path.join(dir, file));
        } else {
          const isValFile =
            file.endsWith(".val.js") || file.endsWith(".val.ts");
          if (!isValFile) {
            continue;
          }
          if (
            treePath &&
            !path.join(dir, file).replace(rootDir, "").startsWith(treePath)
          ) {
            continue;
          }
          moduleIds.push(
            path
              .join(dir, file)
              .replace(rootDir, "")
              .replace(".val.js", "")
              .replace(".val.ts", "")
              .split(path.sep)
              .join("/") as ModuleId
          );
        }
      }
    };
    const applyPatches = query.patch === "true";
    let {
      patchIdsByModuleId,
      patchesById,
    }: {
      patchIdsByModuleId: Record<ModuleId, PatchId[]>;
      patchesById: Record<PatchId, Patch>;
    } = {
      patchIdsByModuleId: {},
      patchesById: {},
    };
    if (applyPatches) {
      const res = await this.readPatches();
      if (result.isErr(res)) {
        return res.error;
      }
      patchIdsByModuleId = res.value.patchIdsByModuleId;
      patchesById = res.value.patchesById;
    }

    const possiblyPatchesContent = await walk(rootDir).then(async () => {
      return Promise.all(
        moduleIds.map(async (moduleIdStr) => {
          const moduleId = moduleIdStr as ModuleId;
          return this.applyAllPatchesThenValidate(
            moduleId,
            patchIdsByModuleId,
            patchesById,
            applyPatches
          );
        })
      );
    });

    const modules = Object.fromEntries(
      possiblyPatchesContent.map((serializedModuleContent) => {
        const module: ApiTreeResponse["modules"][keyof ApiTreeResponse["modules"]] =
          {
            schema: serializedModuleContent.schema,
            source: serializedModuleContent.source,
            errors: serializedModuleContent.errors,
          };
        return [serializedModuleContent.path, module];
      })
    );
    const apiTreeResponse: ApiTreeResponse = {
      modules,
      git: this.options.git,
    };
    return {
      status: 200,
      json: apiTreeResponse,
    };
  }

  private async applyAllPatchesThenValidate(
    moduleId: ModuleId,
    patchIdsByModuleId: Record<ModuleId, PatchId[]>,
    patchesById: Record<PatchId, Patch>,
    applyPatches: boolean
  ): Promise<SerializedModuleContent> {
    const serializedModuleContent = await this.options.service.get(moduleId);
    const schema = serializedModuleContent.schema;
    const maybeSource = serializedModuleContent.source;
    if (!applyPatches) {
      return serializedModuleContent;
    }
    if (
      serializedModuleContent.errors &&
      (serializedModuleContent.errors.fatal ||
        serializedModuleContent.errors.invalidModuleId)
    ) {
      return serializedModuleContent;
    }
    if (!maybeSource || !schema) {
      return serializedModuleContent;
    }
    let source = maybeSource as JSONValue;

    for (const patchId of patchIdsByModuleId[moduleId] ?? []) {
      const patch = patchesById[patchId];
      if (!patch) {
        continue;
      }
      const patchRes = applyPatch(source, ops, patch);
      if (result.isOk(patchRes)) {
        source = patchRes.value;
      } else {
        console.error(
          "Val: unexpected error applying patch. Is there a mismatch in Val versions? Perhaps Val is misconfigured?",
          {
            patchId,
            moduleId,
            patch,
            error: patchRes.error,
          }
        );
        return {
          path: moduleId as string as SourcePath,
          schema,
          source,
          errors: {
            fatal: [
              {
                message: "Unexpected error applying patch",
                type: "invalid-patch",
              },
            ],
          },
        };
      }
    }

    const validationErrors = deserializeSchema(schema).validate(
      moduleId as string as SourcePath,
      source
    );
    if (validationErrors) {
      return {
        path: moduleId as string as SourcePath,
        schema,
        source,
        errors: {
          validation: validationErrors,
        },
      };
    }

    return {
      path: moduleId as string as SourcePath,
      schema,
      source,
      errors: false,
    };
  }

  private async readPatches(): Promise<
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
      this.cacheDir,
      LocalValServer.PATCHES_DIR
    );
    let files: string[] = [];
    try {
      files = await fs.readdir(patchesCacheDir);
    } catch (e) {
      // no patches to apply
    }
    const sortedPatchIds = files.map((file) => parseInt(file, 10)).sort();
    for (const patchIdStr of sortedPatchIds) {
      const patchId = patchIdStr.toString() as PatchId;
      let parsedPatches: Record<string, Patch> = {};
      try {
        const currentParsedPatches = z
          .record(Patch)
          .safeParse(
            JSON.parse(
              await fs.readFile(
                path.join(
                  this.cacheDir,
                  LocalValServer.PATCHES_DIR,
                  `${patchId}`
                ),
                "utf-8"
              )
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
          { patchId, error: err, dir: this.cacheDir }
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

  async enable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>> {
    const redirectToRes = getRedirectUrl(
      query,
      this.options.valEnableRedirectUrl
    );
    if (typeof redirectToRes !== "string") {
      return redirectToRes;
    }
    await this.callbacks.onEnable(true);
    return {
      cookies: {
        [VAL_ENABLE_COOKIE_NAME]: ENABLE_COOKIE_VALUE,
      },
      status: 302,
      redirectTo: redirectToRes,
    };
  }

  async disable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>> {
    const redirectToRes = getRedirectUrl(
      query,
      this.options.valDisableRedirectUrl
    );
    if (typeof redirectToRes !== "string") {
      return redirectToRes;
    }
    await this.callbacks.onDisable(true);
    return {
      cookies: {
        [VAL_ENABLE_COOKIE_NAME]: {
          value: "false",
        },
      },
      status: 302,
      redirectTo: redirectToRes,
    };
  }

  async deletePatches(query: {
    id?: string[];
  }): Promise<ValServerJsonResult<ApiDeletePatchResponse>> {
    const deletedPatches: ApiDeletePatchResponse = [];
    for (const patchId of query.id ?? []) {
      deletedPatches.push(patchId as PatchId);
      await fs.rm(
        path.join(this.cacheDir, LocalValServer.PATCHES_DIR, patchId)
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
    await fs.mkdir(this.getPatchesCacheDir(), {
      recursive: true,
    });
    await fs.writeFile(
      this.getPatchFilePath(fileId),
      JSON.stringify(patches.data)
    );
    return {
      status: 200,
      json: res,
    };
  }

  private getPatchesCacheDir() {
    return path.join(this.cacheDir, LocalValServer.PATCHES_DIR);
  }

  private getPatchFilePath(patchId: PatchId) {
    return path.join(
      this.cacheDir,
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

  async postCommit(): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPatchValidationErrorResponse>
  > {
    const modules: Record<
      ModuleId,
      {
        patches: {
          applied: PatchId[];
        };
      }
    > = {};
    let {
      patchIdsByModuleId,
      patchesById,
      patches,
    }: {
      patchIdsByModuleId: Record<ModuleId, PatchId[]>;
      patchesById: Record<PatchId, Patch>;
      patches: [PatchId, ModuleId, Patch][];
    } = {
      patchIdsByModuleId: {},
      patchesById: {},
      patches: [],
    };
    const res = await this.readPatches();
    if (result.isErr(res)) {
      return res.error;
    }
    patchIdsByModuleId = res.value.patchIdsByModuleId;
    patchesById = res.value.patchesById;
    patches = res.value.patches;

    const validationErrorsByModuleId: ApiPatchValidationErrorResponse["validationErrors"] =
      {};
    for (const moduleIdStr in patchIdsByModuleId) {
      const moduleId = moduleIdStr as ModuleId;
      const serializedModuleContent = await this.applyAllPatchesThenValidate(
        moduleId,
        patchIdsByModuleId,
        patchesById,
        true
      );
      if (serializedModuleContent.errors) {
        validationErrorsByModuleId[moduleId] = serializedModuleContent;
      }
    }
    if (Object.keys(validationErrorsByModuleId).length > 0) {
      return {
        status: 400,
        json: {
          validationErrors: validationErrorsByModuleId,
        },
      };
    }

    for (const [patchId, moduleId, patch] of patches) {
      if (!modules[moduleId]) {
        modules[moduleId] = {
          patches: {
            applied: [],
          },
        };
      }
      // TODO: patch the entire module content directly by using a { path: "", op: "replace", value: patchedData }?
      // Reason: that would be more atomic? Not doing it now, because there are currently already too many moving pieces.
      await fs.rm(this.getPatchFilePath(patchId));
      await this.options.service.patch(moduleId, patch);
      modules[moduleId].patches.applied.push(patchId);
    }

    return {
      status: 200,
      json: {
        modules,
        git: this.options.git,
      },
    };
  }

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
              "Val: unexpected error parsing patch id. Is cache corrupt?",
              {
                patchId,
                file: this.getPatchFilePath(patchId),
                dir: this.getPatchesCacheDir(),
                error: e,
              }
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
}
