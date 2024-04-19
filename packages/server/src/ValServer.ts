import {
  ApiCommitResponse,
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ApiPostValidationErrorResponse,
  ApiTreeResponse,
  ApiDeletePatchResponse,
  ApiPostValidationResponse,
  Internal,
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
import {
  JSONOps,
  JSONValue,
  Operation,
  applyPatch,
} from "@valbuild/core/patch";
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
import fs from "fs";

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
    readonly cwd: string,
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

  private getAllModules(treePath: string) {
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

  async getTree(
    treePath: string,
    // TODO: use the params: patch, schema, source now we return everything, every time
    query: { patch?: string; schema?: string; source?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<ValServerJsonResult<ApiTreeResponse>> {
    const ensureRes = await this.ensureRemoteFSInitialized("getTree", cookies);
    if (result.isErr(ensureRes)) {
      return ensureRes.error;
    }

    const moduleIds = this.getAllModules(treePath);

    const applyPatches = query.patch === "true";
    let {
      patchIdsByModuleId,
      patchesById,
      fileUpdates,
    }: {
      patchIdsByModuleId: Record<ModuleId, PatchId[]>;
      patchesById: Record<PatchId, Patch>;
      fileUpdates: Record<string, PatchFileMetadata>;
    } = {
      patchIdsByModuleId: {},
      patchesById: {},
      fileUpdates: {},
    };
    if (applyPatches) {
      const res = await this.readPatches(cookies);
      if (result.isErr(res)) {
        return res.error;
      }
      patchIdsByModuleId = res.value.patchIdsByModuleId;
      patchesById = res.value.patchesById;
      fileUpdates = res.value.fileUpdates;
    }

    const possiblyPatchedContent = await Promise.all(
      moduleIds.map(async (moduleId) => {
        return this.applyAllPatchesThenValidate(
          moduleId,
          patchIdsByModuleId,
          patchesById,
          fileUpdates,
          applyPatches,
          cookies,
          requestHeaders
        );
      })
    );

    const modules = Object.fromEntries(
      possiblyPatchedContent.map((serializedModuleContent) => {
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
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<
    ValServerJsonResult<
      ApiPostValidationResponse | ApiPostValidationErrorResponse
    >
  > {
    const ensureRes = await this.ensureRemoteFSInitialized(
      "postValidate",
      cookies
    );
    if (result.isErr(ensureRes)) {
      return ensureRes.error;
    }
    return this.validateThenMaybeCommit(
      rawBody,
      false,
      cookies,
      requestHeaders
    );
  }

  async postCommit(
    rawBody: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  > {
    const ensureRes = await this.ensureRemoteFSInitialized(
      "postCommit",
      cookies
    );
    if (result.isErr(ensureRes)) {
      return ensureRes.error;
    }
    const res = await this.validateThenMaybeCommit(
      rawBody,
      true,
      cookies,
      requestHeaders
    );
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
    fileUpdates: Record<string /* filePath */, PatchFileMetadata>,
    applyPatches: boolean,
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
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
      const patchRes = applyPatch(
        source,
        ops,
        patch.filter(Internal.notFileOp)
      );
      if (result.isOk(patchRes)) {
        source = patchRes.value;
      } else {
        console.error(
          "Val: got an unexpected error while applying patch. Is there a mismatch in Val versions? Perhaps Val is misconfigured?",
          {
            patchId,
            moduleId,
            patch: JSON.stringify(patch, null, 2),
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
        validationErrors,
        fileUpdates,
        cookies,
        requestHeaders
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
  // The reason is that validate will be called inside QuickJS (in the future, hopefully),
  // which does not have access to the filesystem, at least not at the time of writing this comment.
  // If you are reading this, and we still are not using QuickJS to validate, this assumption might be wrong.
  private async revalidateImageAndFileValidation(
    validationErrors: Record<SourcePath, ValidationError[]>,
    fileUpdates: Record<string /* filePath */, PatchFileMetadata>,
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
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
            const filePath = path.join(this.cwd, fileRef);
            let expectedMetadata: FileMetadata | ImageMetadata | undefined;

            // if this is a new file or we have an actual FS, we read the file and get the metadata
            if (!expectedMetadata) {
              let fileBuffer: Buffer | undefined = undefined;
              const updatedFileMetadata = fileUpdates[fileRef];
              if (updatedFileMetadata) {
                const fileRes = await this.getFiles(
                  fileRef,
                  {
                    sha256: updatedFileMetadata.sha256,
                  },
                  cookies,
                  requestHeaders
                );
                if (fileRes.status === 200 && fileRes.body) {
                  const res = new Response(fileRes.body);
                  fileBuffer = Buffer.from(await res.arrayBuffer());
                } else {
                  console.error(
                    "Val: unexpected error while fetching image / file:",
                    fileRef,
                    {
                      error: fileRes,
                    }
                  );
                }
              }
              // try fetch file directly via http
              if (fileRef.startsWith("/public")) {
                const fetchRes = await fetch(fileRef.slice("/public".length));
                if (fetchRes.status === 200) {
                  fileBuffer = Buffer.from(await fetchRes.arrayBuffer());
                } else {
                  console.error(
                    "Val: unexpected error while fetching image / file:",
                    fileRef,
                    {
                      error: {
                        status: fetchRes.status,
                      },
                    }
                  );
                }
              } else {
                console.error(
                  "Val: unexpected while getting public image / file (file reference did not start with /public)",
                  fileRef
                );
              }
              if (!fileBuffer) {
                try {
                  fileBuffer = await this.readStaticBinaryFile(filePath);
                } catch (err) {
                  console.error(
                    "Val: unexpected error while reading image / file:",
                    filePath,
                    {
                      error: err,
                    }
                  );
                }
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
                    (missingKey) =>
                      `Required key: '${missingKey}' is not defined. Should be: '${JSON.stringify(
                        expectedMetadata?.[missingKey]
                      )}'`
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

  protected sortPatchIds(
    patchesByModule: Record<
      ModuleId,
      {
        patch: Patch;
        patch_id: PatchId;
        created_at: string;
        commit_sha?: string;
        author?: string;
      }[]
    >
  ): PatchId[] {
    return Object.values(patchesByModule)
      .flatMap((modulePatches) => modulePatches)
      .sort((a, b) => {
        return a.created_at.localeCompare(b.created_at);
      })
      .map((patchData) => patchData.patch_id);
  }

  // can be overridden if FS cannot read from static assets / public folder (because of bundlers or what not)
  protected async readStaticBinaryFile(
    filePath: string
  ): Promise<Buffer | undefined> {
    return fs.promises.readFile(filePath);
  }

  private async readPatches(
    cookies: Partial<Record<"val_session", string>>
  ): Promise<
    result.Result<
      {
        patches: [PatchId, ModuleId, Patch][];
        patchIdsByModuleId: Record<ModuleId, PatchId[]>;
        patchesById: Record<PatchId, Patch>;
        fileUpdates: Record<string /* filePath */, PatchFileMetadata>;
      },
      ValServerError
    >
  > {
    const res = await this.getPatches(
      {}, // {} means no ids, so get all patches
      cookies
    );
    if (
      res.status === 400 ||
      res.status === 401 ||
      res.status === 403 ||
      res.status === 404 ||
      res.status === 500 ||
      res.status === 501
    ) {
      return result.err(res);
    } else if (res.status === 200 || res.status === 201) {
      const patchesByModule: Record<
        ModuleId,
        {
          patch: Patch;
          patch_id: PatchId;
          created_at: string;
          commit_sha?: string;
          author?: string;
        }[]
      > = res.json;
      const patches: [PatchId, ModuleId, Patch][] = [];
      const patchIdsByModuleId: Record<ModuleId, PatchId[]> = {};
      const patchesById: Record<PatchId, Patch> = {};
      for (const [moduleIdS, modulePatchData] of Object.entries(
        patchesByModule
      )) {
        const moduleId = moduleIdS as ModuleId;
        patchIdsByModuleId[moduleId] = modulePatchData.map(
          (patch) => patch.patch_id
        );
        for (const patchData of modulePatchData) {
          patches.push([patchData.patch_id, moduleId, patchData.patch]);
          patchesById[patchData.patch_id] = patchData.patch;
        }
      }
      const fileUpdates: Record<string, PatchFileMetadata> = {};
      const sortedPatchIds = this.sortPatchIds(patchesByModule);
      for (const sortedPatchId of sortedPatchIds) {
        const patchId = sortedPatchId as PatchId;
        for (const op of patchesById[patchId] || []) {
          if (op.op === "file") {
            const parsedFileOp = z
              .object({
                sha256: z.string(),
                mimeType: z.string(),
              })
              .safeParse(op.value);
            if (!parsedFileOp.success) {
              return result.err({
                status: 500,
                json: {
                  message:
                    "Unexpected error: file op value must be transformed into object",
                  details: {
                    value:
                      "First 200 chars: " +
                      JSON.stringify(op.value).slice(0, 200),
                    patchId,
                  },
                },
              });
            }

            fileUpdates[op.filePath] = {
              ...parsedFileOp.data,
            };
          }
        }
      }
      return result.ok({
        patches,
        patchIdsByModuleId,
        patchesById,
        fileUpdates,
      });
    } else {
      return result.err({
        status: 500,
        json: {
          message: "Unknown error",
        },
      });
    }
  }

  private async validateThenMaybeCommit(
    rawBody: unknown,
    commit: boolean,
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
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
    const { patchIdsByModuleId, patchesById, patches, fileUpdates } = res.value;
    const validationErrorsByModuleId: ApiPostValidationErrorResponse["validationErrors"] =
      {};
    for (const moduleIdStr of this.getAllModules("/")) {
      const moduleId = moduleIdStr as ModuleId;
      const serializedModuleContent = await this.applyAllPatchesThenValidate(
        moduleId,
        (filterPatchesByModuleIdRes.data.patches as Record<
          ModuleId,
          PatchId[]
        >) || // TODO: refine to ModuleId and PatchId when parsing
          patchIdsByModuleId,
        patchesById,
        fileUpdates,
        true,
        cookies,
        requestHeaders
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
      const commitRes = await this.execCommit(patches, cookies);
      if (commitRes.status !== 200) {
        return commitRes;
      }
      modules = commitRes.json;
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

  protected async getPatchedModules(
    patches: [PatchId, ModuleId, Patch][]
  ): Promise<Record<ModuleId, { patches: { applied: PatchId[] } }>> {
    const modules: Record<
      ModuleId,
      {
        patches: {
          applied: PatchId[];
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
      modules[moduleId].patches.applied.push(patchId);
    }
    return modules;
  }

  /* Abstract methods */

  /**
   * Runs before remoteFS dependent methods (e.g.getModule, ...) are called to make sure that:
   * 1) The remote FS, if applicable, is initialized
   * 2) The error is returned via API if the remote FS could not be initialized
   * */
  protected abstract ensureRemoteFSInitialized(
    errorMessageType: string,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<result.Result<undefined, ValServerError>>;

  protected abstract getModule(
    moduleId: ModuleId
  ): Promise<SerializedModuleContent>;

  protected abstract execCommit(
    patches: [PatchId, ModuleId, Patch][],
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
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
  >;
  /* Abstract endpoints */

  abstract getFiles(
    filePath: string,
    query: { sha256?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<
    | ValServerResult<never, ReadableStream<Uint8Array>>
    | ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>
  >;

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
}

const chunkSize = 1024 * 1024;
export function bufferToReadableStream(buffer: Buffer) {
  const stream = new ReadableStream({
    start(controller) {
      let offset = 0;
      while (offset < buffer.length) {
        const chunk = buffer.subarray(offset, offset + chunkSize);
        controller.enqueue(chunk);
        offset += chunkSize;
      }
      controller.close();
    },
  });
  return stream;
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

export function bufferFromDataUrl(
  dataUrl: string,
  contentType: string | null
): Buffer | undefined {
  let base64Data;
  if (!contentType) {
    const base64Index = dataUrl.indexOf(";base64,");
    if (base64Index > -1) {
      base64Data = dataUrl.slice(base64Index + ";base64,".length);
    }
  } else {
    const dataUrlEncodingHeader = `${base64DataAttr}${contentType};base64,`;
    if (
      dataUrl.slice(0, dataUrlEncodingHeader.length) === dataUrlEncodingHeader
    ) {
      base64Data = dataUrl.slice(dataUrlEncodingHeader.length);
    }
  }
  if (base64Data) {
    return Buffer.from(
      base64Data,
      "base64" // TODO: why does it not work with base64url?
    );
  }
}

export type PatchFileMetadata = {
  mimeType: string;
  sha256: string;
};

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
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
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
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<
    ValServerJsonResult<
      ApiPostValidationResponse | ApiPostValidationErrorResponse
    >
  >;
  postCommit(
    body: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
    // eslint-disable-next-line @typescript-eslint/ban-types
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  >;
  // Streams:
  getFiles(
    filePath: string,
    query: { sha256?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<
    | ValServerResult<never, ReadableStream<Uint8Array>>
    | ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>
  >;
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

export function isCachedPatchFileOp(op: Operation): op is {
  op: "file";
  path: string[];
  filePath: string;
  value: {
    sha256: string;
  };
} {
  return !!(
    op.op === "file" &&
    typeof op.filePath === "string" &&
    op.value &&
    typeof op.value === "object" &&
    !Array.isArray(op.value) &&
    "sha256" in op.value &&
    typeof op.value.sha256 === "string"
  );
}

export type RequestHeaders = {
  host?: string | null;
  "x-forwarded-proto"?: string | null;
};
