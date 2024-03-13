import {
  ApiCommitResponse,
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ApiPostValidationErrorResponse,
  ApiTreeResponse,
  ApiDeletePatchResponse,
  ApiPostValidationResponse,
} from "@valbuild/core";
import {
  VAL_ENABLE_COOKIE_NAME,
  VAL_SESSION_COOKIE,
  VAL_STATE_COOKIE,
  ValCookies,
  ValServerError,
  ValServerJsonResult,
  ValServerRedirectResult,
  ValServerResult,
  ValSession,
} from "@valbuild/shared/internal";
import { result } from "@valbuild/core/fp";
import { JSONOps, JSONValue, applyPatch } from "@valbuild/core/patch";
import { Patch } from "./patch/validation";
import {
  ModuleId,
  PatchId,
  deserializeSchema,
  SourcePath,
  ValidationError,
  FileMetadata,
  ImageMetadata,
} from "@valbuild/core";
import path from "path";
import { z } from "zod";
import { SerializedModuleContent } from "./SerializedModuleContent";
import { getValidationErrorFileRef } from "./getValidationErrorFileRef";
import { extractFileMetadata, extractImageMetadata } from "./extractMetadata";
import { validateMetadata } from "./validateMetadata";
import { getValidationErrorMetadata } from "./getValidationErrorMetadata";
import { IValFSHost } from "./ValFSHost";

export type ValServerOptions = {
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
  git: {
    commit?: string;
    branch?: string;
  };
};

const ops = new JSONOps();

export abstract class ValServer implements IValServer {
  constructor(
    readonly projectRoot: string,
    readonly host: IValFSHost,
    readonly options: ValServerOptions,
    readonly callbacks: ValServerCallbacks
  ) {}

  /* Auth endpoints: */
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

  async getTree(
    treePath: string,
    // TODO: use the params: patch, schema, source now we return everything, every time
    query: { patch?: string; schema?: string; source?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiTreeResponse>> {
    const ensureRes = await this.ensureRemoteFSInitialized(cookies);
    if (result.isErr(ensureRes)) {
      return ensureRes.error;
    }

    const rootDir = process.cwd();
    const moduleIds: ModuleId[] = this.host
      .readDirectory(
        rootDir,
        ["ts", "js"],
        ["node_modules", ".*"],
        ["**/*.val.ts", "**/*.val.js"]
      )
      .filter((file) => {
        if (treePath) {
          return file.replace(rootDir, "").startsWith(treePath);
        }
        return true;
      })
      .map(
        (file) =>
          file
            .replace(rootDir, "")
            .replace(".val.js", "")
            .replace(".val.ts", "")
            .split(path.sep)
            .join("/") as ModuleId
      );
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
      const res = await this.readPatches(cookies);
      if (result.isErr(res)) {
        return res.error;
      }
      patchIdsByModuleId = res.value.patchIdsByModuleId;
      patchesById = res.value.patchesById;
    }

    const possiblyPatchesContent = await Promise.all(
      moduleIds.map(async (moduleId) => {
        return this.applyAllPatchesThenValidate(
          moduleId,
          patchIdsByModuleId,
          patchesById,
          applyPatches
        );
      })
    );

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

  async postValidate(
    rawBody: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
    ValServerJsonResult<
      ApiPostValidationResponse | ApiPostValidationErrorResponse
    >
  > {
    const ensureRes = await this.ensureRemoteFSInitialized(cookies);
    if (result.isErr(ensureRes)) {
      return ensureRes.error;
    }
    return this.validateThenMaybeCommit(rawBody, false, cookies);
  }

  async postCommit(
    rawBody: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  > {
    const ensureRes = await this.ensureRemoteFSInitialized(cookies);
    if (result.isErr(ensureRes)) {
      return ensureRes.error;
    }
    const res = await this.validateThenMaybeCommit(rawBody, true, cookies);
    if (res.status === 200) {
      if (res.json.validationErrors) {
        return {
          status: 400,
          json: {
            ...res.json,
          },
        } as { status: 400; json: ApiPostValidationErrorResponse };
      }
      return {
        status: 200,
        json: {
          ...res.json,
          git: this.options.git,
        },
      };
    }
    return res as ValServerJsonResult<
      ApiCommitResponse,
      ApiPostValidationErrorResponse
    >;
  }

  /* */

  private async applyAllPatchesThenValidate(
    moduleId: ModuleId,
    patchIdsByModuleId: Record<ModuleId, PatchId[]>,
    patchesById: Record<PatchId, Patch>,
    applyPatches: boolean
  ): Promise<SerializedModuleContent> {
    const serializedModuleContent = await this.getModule(moduleId);
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
          "Val: got an unexpected error while applying patch. Is there a mismatch in Val versions? Perhaps Val is misconfigured?",
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
      const revalidated = await this.revalidateImageAndFileValidation(
        validationErrors
      );
      return {
        path: moduleId as string as SourcePath,
        schema,
        source,
        errors: revalidated && {
          validation: revalidated,
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

  // TODO: name this better: we need to check for image and file validation errors
  // since they cannot be handled directly inside the validation function.
  // The reason is that validate will be called inside QuickJS (in the future, hopefully), which does not have access to the filesystem.
  // If you are reading this, and we still are not using QuickJS to validate, this assumption might be wrong.
  private async revalidateImageAndFileValidation(
    validationErrors: Record<SourcePath, ValidationError[]>
  ): Promise<false | Record<SourcePath, ValidationError[]>> {
    const revalidatedValidationErrors: Record<SourcePath, ValidationError[]> =
      {};
    for (const pathStr in validationErrors) {
      const errorSourcePath = pathStr as SourcePath;
      const errors = validationErrors[errorSourcePath];
      revalidatedValidationErrors[errorSourcePath] = [];
      for (const error of errors) {
        if (
          error.fixes?.every(
            (fix) =>
              fix === "file:check-metadata" || fix === "image:replace-metadata" // TODO: rename fix to: image:check-metadata
          )
        ) {
          const fileRef = getValidationErrorFileRef(error);
          if (fileRef) {
            const filePath = path.join(this.projectRoot, fileRef);
            let expectedMetadata: FileMetadata | ImageMetadata | undefined;

            // if this is a new file or we have an actual FS, we read the file and get the metadata
            if (!expectedMetadata) {
              let fileBuffer: Buffer | undefined = undefined;
              try {
                fileBuffer = await this.readBuffer(filePath);
              } catch (err) {
                //
              }
              if (!fileBuffer) {
                revalidatedValidationErrors[errorSourcePath].push({
                  message: `Could not read file: ${filePath}`,
                });
                continue;
              }

              if (error.fixes.some((fix) => fix === "image:replace-metadata")) {
                expectedMetadata = await extractImageMetadata(
                  filePath,
                  fileBuffer
                );
              } else {
                expectedMetadata = await extractFileMetadata(
                  filePath,
                  fileBuffer
                );
              }
            }
            if (!expectedMetadata) {
              revalidatedValidationErrors[errorSourcePath].push({
                message: `Could not read file metadata. Is the reference to the file: ${fileRef} correct?`,
              });
            } else {
              const actualMetadata = getValidationErrorMetadata(error);
              const revalidatedError = validateMetadata(
                actualMetadata,
                expectedMetadata
              );
              if (!revalidatedError) {
                // no errors anymore:
                continue;
              }
              const errorMsgs = (revalidatedError.globalErrors || [])
                .concat(Object.values(revalidatedError.erroneousMetadata || {}))
                .concat(
                  Object.values(revalidatedError.missingMetadata || []).map(
                    (missingKey) => `Required key: ${missingKey} is not defined`
                  )
                );
              revalidatedValidationErrors[errorSourcePath].push(
                ...errorMsgs.map((message) => ({ message }))
              );
            }
          } else {
            revalidatedValidationErrors[errorSourcePath].push(error);
          }
        } else {
          revalidatedValidationErrors[errorSourcePath].push(error);
        }
      }
    }
    const hasErrors = Object.values(revalidatedValidationErrors).some(
      (errors) => errors.length > 0
    );
    if (hasErrors) {
      return revalidatedValidationErrors;
    }
    return hasErrors;
  }

  private async validateThenMaybeCommit(
    rawBody: unknown,
    commit: boolean,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
    Promise<
      ValServerJsonResult<
        ApiPostValidationResponse | ApiPostValidationErrorResponse
      >
    >
  > {
    const filterPatchesByModuleIdRes = z
      .object({
        patches: z.record(z.array(z.string())).optional(),
      })
      .safeParse(rawBody);
    if (!filterPatchesByModuleIdRes.success) {
      return {
        status: 404,
        json: {
          message: "Could not parse body",
          details: filterPatchesByModuleIdRes.error,
        },
      };
    }
    const res = await this.readPatches(cookies);
    if (result.isErr(res)) {
      return res.error;
    }
    const { patchIdsByModuleId, patchesById, patches } = res.value;
    const validationErrorsByModuleId: ApiPostValidationErrorResponse["validationErrors"] =
      {};
    for (const moduleIdStr in patchIdsByModuleId) {
      const moduleId = moduleIdStr as ModuleId;
      const serializedModuleContent = await this.applyAllPatchesThenValidate(
        moduleId,
        (filterPatchesByModuleIdRes.data.patches as Record<
          ModuleId,
          PatchId[]
        >) || // TODO: refine to ModuleId and PatchId when parsing
          patchIdsByModuleId,
        patchesById,
        true
      );
      if (serializedModuleContent.errors) {
        validationErrorsByModuleId[moduleId] = serializedModuleContent;
      }
    }
    if (Object.keys(validationErrorsByModuleId).length > 0) {
      const modules: Record<
        ModuleId,
        {
          patches: {
            applied: PatchId[];
            failed?: PatchId[];
          };
        }
      > = {};
      for (const [patchId, moduleId] of patches) {
        if (!modules[moduleId]) {
          modules[moduleId] = {
            patches: {
              applied: [],
            },
          };
        }
        if (validationErrorsByModuleId[moduleId]) {
          if (!modules[moduleId].patches.failed) {
            modules[moduleId].patches.failed = [];
          }
          modules[moduleId].patches.failed?.push(patchId);
        } else {
          modules[moduleId].patches.applied.push(patchId);
        }
      }
      return {
        status: 200,
        json: {
          modules,
          validationErrors: validationErrorsByModuleId,
        },
      };
    }

    let modules: Record<
      ModuleId,
      {
        patches: {
          applied: PatchId[];
        };
      }
    >;
    if (commit) {
      modules = await this.execCommit(patches, cookies);
    } else {
      modules = await this.getPatchedModules(patches);
    }
    return {
      status: 200,
      json: {
        modules,
        validationErrors: false,
      },
    };
  }

  /* Abstract methods */

  /**
   * Runs before remoteFS dependent methods (getModule, readBuffer) are called to make sure that:
   * 1) The remote FS, if applicable, is initialized
   * 2) The error is returned via API if the remote FS could not be initialized
   * */
  protected abstract ensureRemoteFSInitialized(
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<result.Result<undefined, ValServerError>>;

  protected abstract getModule(
    moduleId: ModuleId
  ): Promise<SerializedModuleContent>;

  protected abstract readPatches(
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
    result.Result<
      {
        patches: [PatchId, ModuleId, Patch][];
        patchIdsByModuleId: Record<ModuleId, PatchId[]>;
        patchesById: Record<PatchId, Patch>;
      },
      ValServerError
    >
  >;

  protected abstract readBuffer(filePath: string): Promise<Buffer | undefined>;

  protected abstract getPatchedModules(
    patches: [PatchId, ModuleId, Patch][]
  ): Promise<
    Record<
      ModuleId,
      {
        patches: {
          applied: PatchId[];
        };
      }
    >
  >;

  protected abstract execCommit(
    patches: [PatchId, ModuleId, Patch][],
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
    Record<
      ModuleId,
      {
        patches: {
          applied: PatchId[];
        };
      }
    >
  >;

  /* Abstract endpoints */
  /* Abstract auth endpoints: */
  abstract session(
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ValSession>>;
  abstract authorize(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_STATE_COOKIE>>;
  abstract logout(): Promise<
    ValServerResult<VAL_STATE_COOKIE | VAL_SESSION_COOKIE>
  >;
  abstract callback(
    query: { code?: string; state?: string },
    cookies: ValCookies<VAL_STATE_COOKIE>
  ): Promise<
    ValServerRedirectResult<
      VAL_STATE_COOKIE | VAL_SESSION_COOKIE | VAL_ENABLE_COOKIE_NAME
    >
  >;

  /* Abstract patch endpoints: */
  abstract deletePatches(
    query: {
      id?: string[];
    },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiDeletePatchResponse>>;
  abstract postPatches(
    body: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>>;
  abstract getPatches(
    query: {
      id?: string[];
    },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiGetPatchResponse>>;

  /* Abstract misc endpoints: */
  abstract getFiles(
    treePath: string,
    query: { sha256?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerResult<never, ReadableStream<Uint8Array>>>;
}

export const ENABLE_COOKIE_VALUE = {
  value: "true",
  options: {
    httpOnly: false,
    sameSite: "lax",
  },
} as const;

export function getRedirectUrl(
  query: { redirect_to?: string | undefined },
  overrideHost: string | undefined
): string | ValServerError {
  if (typeof query.redirect_to !== "string") {
    return {
      status: 400,
      json: {
        message: "Missing redirect_to query param",
      },
    };
  }
  if (overrideHost) {
    return (
      overrideHost + "?redirect_to=" + encodeURIComponent(query.redirect_to)
    );
  }
  return query.redirect_to;
}

export type ValServerCallbacks = {
  isEnabled: () => Promise<boolean>;
  onEnable: (success: boolean) => Promise<void>;
  onDisable: (success: boolean) => Promise<void>;
};

export interface IValServer {
  // Sets cookie state:
  authorize(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_STATE_COOKIE>>;
  callback(
    query: { code?: string; state?: string },
    cookies: ValCookies<VAL_STATE_COOKIE>
  ): Promise<
    ValServerRedirectResult<
      VAL_STATE_COOKIE | VAL_SESSION_COOKIE | VAL_ENABLE_COOKIE_NAME
    >
  >;
  enable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>>;
  disable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>>;
  logout(): Promise<ValServerResult<VAL_STATE_COOKIE | VAL_SESSION_COOKIE>>;
  // Data:
  session(
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ValSession>>;
  getTree(
    treePath: string,
    query: { patch?: string; schema?: string; source?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiTreeResponse>>;
  getPatches(
    query: { id?: string[] },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiGetPatchResponse>>;
  postPatches(
    body: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>>;
  deletePatches(
    query: { id?: string[] },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiDeletePatchResponse>>;
  postValidate(
    body: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
    ValServerJsonResult<
      ApiPostValidationResponse | ApiPostValidationErrorResponse
    >
  >;
  postCommit(
    body: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
    // eslint-disable-next-line @typescript-eslint/ban-types
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  >;
  // Streams:
  getFiles(
    treePath: string,
    query: { sha256?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerResult<never, ReadableStream<Uint8Array>>>;
}
