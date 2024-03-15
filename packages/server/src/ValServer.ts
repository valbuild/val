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
    const ensureRes = await this.ensureRemoteFSInitialized("getTree", cookies);
    if (result.isErr(ensureRes)) {
      return ensureRes.error;
    }

    const rootDir = this.projectRoot;
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
      fileUpdates,
    }: {
      patchIdsByModuleId: Record<ModuleId, PatchId[]>;
      patchesById: Record<PatchId, Patch>;
      fileUpdates: Record<string, string>;
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
          applyPatches
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
    cookies: ValCookies<VAL_SESSION_COOKIE>
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
    return this.validateThenMaybeCommit(rawBody, false, cookies);
  }

  async postCommit(
    rawBody: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
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
    fileUpdates: Record<string, string>,
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
      const patchRes = applyPatch(
        source,
        ops,
        patch.filter(
          (op) => !(op.op === "file" && typeof op.value === "string")
        )
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
        fileUpdates
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
    fileUpdates: Record<string, string>
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
              if (fileUpdates[fileRef]) {
                const updatedBuffer = bufferFromDataUrl(
                  fileUpdates[fileRef],
                  getMimeTypeFromBase64(fileUpdates[fileRef])
                );
                if (updatedBuffer) {
                  fileBuffer = updatedBuffer;
                }
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
        fileUpdates: Record<string, string>;
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
      const fileUpdates: Record<string, string> = {};
      const sortedPatchIds = this.sortPatchIds(patchesByModule);
      for (const sortedPatchId of sortedPatchIds) {
        const patchId = sortedPatchId as PatchId;
        for (const op of patchesById[patchId] || []) {
          if (op.op === "file") {
            if (typeof op.value !== "string") {
              return result.err({
                status: 500,
                json: {
                  message: "Unexpected error: file op value is not a string",
                  details: {
                    patchId,
                  },
                },
              });
            }
            fileUpdates[op.filePath] = op.value;
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
    const { patchIdsByModuleId, patchesById, patches, fileUpdates } = res.value;
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
        fileUpdates,
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

  async getFiles(
    filePath: string,
    // @eslint-disable-next-line @typescript-eslint/no-unused-vars
    query: { sha256?: string }, // TODO: use the sha256 query param: we have to go through all fileUpdates to find the one with the actual checksum
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerResult<never, ReadableStream<Uint8Array>>> {
    const patchesRes = await this.readPatches(cookies);
    if (result.isErr(patchesRes)) {
      return patchesRes.error;
    }
    const { fileUpdates } = patchesRes.value;
    let updatedBuffer: Buffer | undefined;
    const headers: Record<string, string> = {};
    if (fileUpdates[filePath]) {
      const mimeType = getMimeTypeFromBase64(fileUpdates[filePath]);
      if (mimeType) {
        headers["Content-Type"] = mimeType;
      }
      updatedBuffer = bufferFromDataUrl(fileUpdates[filePath], mimeType);
      if (!updatedBuffer) {
        return {
          status: 500,
          json: {
            message: "Unexpected error: could not decode data url",
            details: {
              filePath,
            },
          },
        };
      }
    } else {
      updatedBuffer = await this.readStaticBinaryFile(
        path.join(this.projectRoot, filePath)
      );
    }
    if (!updatedBuffer) {
      return {
        status: 404,
        json: {
          message: "File not found",
          details: {
            filePath,
          },
        },
      };
    }
    if (!headers["Content-Type"]) {
      headers["Content-Type"] =
        guessMimeTypeFromPath(filePath) || "application/octet-stream";
    }

    const contentLength = updatedBuffer.length;
    headers["Content-Length"] = contentLength.toString();

    return {
      status: 200,
      headers,
      body: bufferToReadableStream(updatedBuffer),
    };
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
}

// From slightly modified ChatGPT generated
function bufferToReadableStream(buffer: Buffer) {
  const stream = new ReadableStream({
    start(controller) {
      const chunkSize = 1024; // Adjust the chunk size as needed
      let offset = 0;

      function push() {
        const chunk = buffer.subarray(offset, offset + chunkSize);
        offset += chunkSize;

        if (chunk.length > 0) {
          controller.enqueue(new Uint8Array(chunk));
          setTimeout(push, 0); // Enqueue the next chunk asynchronously
        } else {
          controller.close();
        }
      }

      push();
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
  ``;
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
    filePath: string,
    query: { sha256?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerResult<never, ReadableStream<Uint8Array>>>;
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

function guessMimeTypeFromPath(filePath: string): string | null {
  const fileExt = filePath.split(".").pop();
  if (fileExt) {
    return COMMON_MIME_TYPES[fileExt.toLowerCase()] || null;
  }
  return null;
}
