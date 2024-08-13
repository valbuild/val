/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ApiCommitResponse,
  ApiGetPatchResponse,
  ApiPostValidationErrorResponse,
  ApiTreeResponse,
  ApiDeletePatchResponse,
  ValModules,
  PatchId,
  ModuleFilePath,
  ApiSchemaResponse,
  Json,
  SourcePath,
  ValidationError,
  SerializedSchema,
} from "@valbuild/core";
import {
  VAL_ENABLE_COOKIE_NAME,
  VAL_SESSION_COOKIE,
  VAL_STATE_COOKIE,
  ValCookies,
  ValServerError,
  ValServerErrorStatus,
  ValServerJsonResult,
  ValServerRedirectResult,
  ValServerResult,
  ValServerResultCookies,
  ValSession,
} from "@valbuild/shared/internal";
import { decodeJwt, encodeJwt, getExpire } from "./jwt";
import { z } from "zod";
import { ValOpsFS } from "./ValOpsFS";
import { AuthorId, PatchAnalysis, Sources } from "./ValOps";
import { fromError } from "zod-validation-error";
import { Patch } from "./patch/validation";
import { PatchError } from "@valbuild/core/patch";
import { ValOpsHttp } from "./ValOpsHttp";

export type ValServerOptions = {
  route: string;
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
  formatter?: (code: string, filePath: string) => string | Promise<string>;
  valBuildUrl?: string;
  valSecret?: string;
  apiKey?: string;
  project?: string;
};

export type ValServerConfig = ValServerOptions &
  (
    | {
        mode: "fs";
        cwd: string;
      }
    | {
        mode: "http";
        valContentUrl: string;
        apiKey: string;
        project: string;
        commit: string;
        branch: string;
        root?: string;
      }
  );

export class ValServer {
  private serverOps: ValOpsFS | ValOpsHttp;
  constructor(
    readonly valModules: ValModules,
    private readonly options: ValServerConfig,
    readonly callbacks: ValServerCallbacks
  ) {
    if (options.mode === "fs") {
      this.serverOps = new ValOpsFS(options.cwd, valModules, {
        formatter: options.formatter,
      });
    } else if (options.mode === "http") {
      this.serverOps = new ValOpsHttp(
        options.valContentUrl,
        options.project,
        options.commit,
        options.branch,
        options.apiKey,
        valModules,
        {
          formatter: options.formatter,
          root: options.root,
        }
      );
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw new Error("Invalid mode: " + (options as any)?.mode);
    }
  }

  //#region auth
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

  async authorize(query: {
    redirect_to?: string;
  }): Promise<
    ValServerRedirectResult<VAL_STATE_COOKIE | VAL_ENABLE_COOKIE_NAME>
  > {
    if (typeof query.redirect_to !== "string") {
      return {
        status: 400,
        json: {
          message: "Missing redirect_to query param",
        },
      };
    }
    const token = crypto.randomUUID();
    const redirectUrl = new URL(query.redirect_to);
    const appAuthorizeUrl = this.getAuthorizeUrl(
      `${redirectUrl.origin}/${this.options.route}`,
      token
    );
    await this.callbacks.onEnable(true);
    return {
      cookies: {
        [VAL_ENABLE_COOKIE_NAME]: ENABLE_COOKIE_VALUE,
        [VAL_STATE_COOKIE]: {
          value: createStateCookie({ redirect_to: query.redirect_to, token }),
          options: {
            httpOnly: true,
            sameSite: "lax",
            expires: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
          },
        },
      },
      status: 302,
      redirectTo: appAuthorizeUrl,
    };
  }

  async callback(
    query: { code?: string; state?: string },
    cookies: ValCookies<"val_state">
  ): Promise<
    ValServerRedirectResult<"val_state" | "val_session" | "val_enable">
  > {
    if (!this.options.project) {
      return {
        status: 302,
        cookies: {
          [VAL_STATE_COOKIE]: {
            value: null,
          },
        },
        redirectTo: this.getAppErrorUrl("Project is not set"),
      };
    }
    if (!this.options.valSecret) {
      return {
        status: 302,
        cookies: {
          [VAL_STATE_COOKIE]: {
            value: null,
          },
        },
        redirectTo: this.getAppErrorUrl("Secret is not set"),
      };
    }
    const { success: callbackReqSuccess, error: callbackReqError } =
      verifyCallbackReq(cookies[VAL_STATE_COOKIE], query);

    if (callbackReqError !== null) {
      return {
        status: 302,
        cookies: {
          [VAL_STATE_COOKIE]: {
            value: null,
          },
        },
        redirectTo: this.getAppErrorUrl(
          `Authorization callback failed. Details: ${callbackReqError}`
        ),
      };
    }

    const data = await this.consumeCode(callbackReqSuccess.code);
    if (data === null) {
      return {
        status: 302,
        cookies: {
          [VAL_STATE_COOKIE]: {
            value: null,
          },
        },
        redirectTo: this.getAppErrorUrl("Failed to exchange code for user"),
      };
    }
    const exp = getExpire();
    const valSecret = this.options.valSecret;
    if (!valSecret) {
      return {
        status: 302,
        cookies: {
          [VAL_STATE_COOKIE]: {
            value: null,
          },
        },
        redirectTo: this.getAppErrorUrl(
          "Setup is not correct: secret is missing"
        ),
      };
    }
    const cookie = encodeJwt(
      {
        ...data,
        exp, // this is the client side exp
      },
      valSecret
    );

    return {
      status: 302,
      cookies: {
        [VAL_STATE_COOKIE]: {
          value: null,
        },
        [VAL_ENABLE_COOKIE_NAME]: ENABLE_COOKIE_VALUE,
        [VAL_SESSION_COOKIE]: {
          value: cookie,
          options: {
            httpOnly: true,
            sameSite: "strict",
            path: "/",
            secure: true,
            expires: new Date(exp * 1000), // NOTE: this is not used for authorization, only for authentication
          },
        },
      },
      redirectTo: callbackReqSuccess.redirect_uri || "/",
    };
  }

  async session(
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ValSession>> {
    if (this.serverOps instanceof ValOpsFS) {
      return {
        status: 200,
        json: {
          mode: "local",
          enabled: await this.callbacks.isEnabled(),
        },
      };
    }
    if (!this.options.project) {
      return {
        status: 500,
        json: {
          message: "Project is not set",
        },
      };
    }
    if (!this.options.valSecret) {
      return {
        status: 500,
        json: {
          message: "Secret is not set",
        },
      };
    }
    return withAuth(
      this.options.valSecret,
      cookies,
      "session",
      async (data) => {
        if (!this.options.valBuildUrl) {
          return {
            status: 500,
            json: {
              message: "Val is not correctly setup. Build url is missing",
            },
          };
        }
        const url = new URL(
          `/api/val/${this.options.project}/auth/session`,
          this.options.valBuildUrl
        );
        const fetchRes = await fetch(url, {
          headers: getAuthHeaders(data.token, "application/json"),
        });
        if (fetchRes.status === 200) {
          return {
            status: fetchRes.status,
            json: {
              mode: "proxy",
              enabled: await this.callbacks.isEnabled(),
              ...(await fetchRes.json()),
            },
          };
        } else {
          return {
            status: fetchRes.status as ValServerErrorStatus,
            json: {
              message: "Failed to authorize",
              ...(await fetchRes.json()),
            },
          };
        }
      }
    );
  }

  private async consumeCode(code: string): Promise<{
    sub: string;
    exp: number;
    org: string;
    project: string;
    token: string;
  } | null> {
    if (!this.options.project) {
      throw new Error("Project is not set");
    }
    if (!this.options.valBuildUrl) {
      throw new Error("Val build url is not set");
    }
    const url = new URL(
      `/api/val/${this.options.project}/auth/token`,
      this.options.valBuildUrl
    );
    url.searchParams.set("code", encodeURIComponent(code));
    if (!this.options.apiKey) {
      return null;
    }
    return fetch(url, {
      method: "POST",
      headers: getAuthHeaders(this.options.apiKey, "application/json"), // NOTE: we use apiKey as auth on this endpoint (we do not have a token yet)
    })
      .then(async (res) => {
        if (res.status === 200) {
          const token = await res.text();
          const verification = ValAppJwtPayload.safeParse(decodeJwt(token));
          if (!verification.success) {
            return null;
          }
          return {
            ...verification.data,
            token,
          };
        } else {
          console.debug("Failed to get data from code: ", res.status);
          return null;
        }
      })
      .catch((err) => {
        console.debug("Failed to get user from code: ", err);
        return null;
      });
  }

  private getAuthorizeUrl(publicValApiRe: string, token: string): string {
    if (!this.options.project) {
      throw new Error("Project is not set");
    }
    if (!this.options.valBuildUrl) {
      throw new Error("Val build url is not set");
    }
    const url = new URL(
      `/auth/${this.options.project}/authorize`,
      this.options.valBuildUrl
    );
    url.searchParams.set(
      "redirect_uri",
      encodeURIComponent(`${publicValApiRe}/callback`)
    );
    url.searchParams.set("state", token);
    return url.toString();
  }

  private getAppErrorUrl(error: string): string {
    if (!this.options.project) {
      throw new Error("Project is not set");
    }
    if (!this.options.valBuildUrl) {
      throw new Error("Val build url is not set");
    }
    const url = new URL(
      `/auth/${this.options.project}/authorize`,
      this.options.valBuildUrl
    );
    url.searchParams.set("error", encodeURIComponent(error));
    return url.toString();
  }

  getAuth(
    cookies: Partial<Record<"val_session", string>>
  ):
    | { error: string }
    | { id: string; error?: undefined }
    | { error: null; id: null } {
    const cookie = cookies[VAL_SESSION_COOKIE];
    if (!this.options.valSecret) {
      if (this.serverOps instanceof ValOpsFS) {
        return {
          error: null,
          id: null,
        };
      } else {
        return {
          error: "Setup is not correct: secret is missing",
        };
      }
    }
    if (typeof cookie === "string") {
      const decodedToken = decodeJwt(cookie, this.options.valSecret);
      if (!decodedToken) {
        if (this.serverOps instanceof ValOpsFS) {
          return {
            error: null,
            id: null,
          };
        }
        return {
          error:
            "Could not verify session (invalid token). You will need to login again.",
        };
      }
      const verification = IntegratedServerJwtPayload.safeParse(decodedToken);
      if (!verification.success) {
        if (this.serverOps instanceof ValOpsFS) {
          return {
            error: null,
            id: null,
          };
        }
        return {
          error:
            "Session invalid or, most likely, expired. You will need to login again.",
        };
      }
      return {
        id: verification.data.sub,
      };
    } else {
      if (this.serverOps instanceof ValOpsFS) {
        return {
          error: null,
          id: null,
        };
      }
      return {
        error: "Login required: cookie not found",
      };
    }
  }

  async logout(): Promise<
    ValServerResult<VAL_SESSION_COOKIE | VAL_STATE_COOKIE>
  > {
    return {
      status: 200,
      cookies: {
        [VAL_SESSION_COOKIE]: {
          value: null,
        },
        [VAL_STATE_COOKIE]: {
          value: null,
        },
      },
    };
  }

  //#region patches
  async getPatches(
    query: { authors?: string[] },
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiGetPatchResponse>> {
    const auth = this.getAuth(cookies);
    if (auth.error) {
      return {
        status: 401,
        json: {
          message: auth.error,
        },
      };
    }
    if (this.serverOps instanceof ValOpsHttp && !("id" in auth)) {
      return {
        status: 401,
        json: {
          message: "Unauthorized",
        },
      };
    }
    const authors = query.authors as AuthorId[] | undefined;
    const patches = await this.serverOps.findPatches({
      authors,
    });
    if (patches.errors && Object.keys(patches.errors).length > 0) {
      console.error("Val: Failed to get patches", patches.errors);
      return {
        status: 500,
        json: {
          message: "Failed to get patches",
          details: patches.errors,
        },
      };
    }
    const res: ApiGetPatchResponse = {};
    for (const [patchIdS, patchData] of Object.entries(patches.patches)) {
      const patchId = patchIdS as PatchId;
      if (!res[patchData.path]) {
        res[patchData.path] = [];
      }
      res[patchData.path].push({
        patch_id: patchId,
        created_at: patchData.createdAt,
        applied_at_base_sha: patchData.appliedAt?.baseSha || null,
        author: patchData.authorId ?? undefined,
      });
    }
    return {
      status: 200,
      json: res,
    };
  }

  async deletePatches(
    query: { id?: string[] },
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiDeletePatchResponse>> {
    const auth = this.getAuth(cookies);
    if (auth.error) {
      return {
        status: 401,
        json: {
          message: auth.error,
        },
      };
    }
    if (this.serverOps instanceof ValOpsHttp && !("id" in auth)) {
      return {
        status: 401,
        json: {
          message: "Unauthorized",
        },
      };
    }
    const ids = query.id as PatchId[];
    const deleteRes = await this.serverOps.deletePatches(ids);
    if (deleteRes.errors && Object.keys(deleteRes.errors).length > 0) {
      console.error("Val: Failed to delete patches", deleteRes.errors);
      return {
        status: 500,
        json: {
          message: "Failed to delete patches",
          details: deleteRes.errors,
        },
      };
    }
    return {
      status: 200,
      json: ids,
    };
  }

  //#region tree ops
  async getSchema(
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiSchemaResponse>> {
    const auth = this.getAuth(cookies);
    if (auth.error) {
      return {
        status: 401,
        json: {
          message: auth.error,
        },
      };
    }
    if (this.serverOps instanceof ValOpsHttp && !("id" in auth)) {
      return {
        status: 401,
        json: {
          message: "Unauthorized",
        },
      };
    }
    const moduleErrors = await this.serverOps.getModuleErrors();
    if (moduleErrors?.length > 0) {
      console.error("Val: Module errors", moduleErrors);
      return {
        status: 500,
        json: {
          message: "Val is not correctly setup. Check the val.modules file",
          details: moduleErrors,
        },
      };
    }
    const schemaSha = await this.serverOps.getSchemaSha();
    const schemas = await this.serverOps.getSchemas();
    const serializedSchemas: Record<ModuleFilePath, SerializedSchema> = {};
    for (const [moduleFilePathS, schema] of Object.entries(schemas)) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      serializedSchemas[moduleFilePath] = schema.serialize();
    }

    return {
      status: 200,
      json: {
        schemaSha,
        schemas: serializedSchemas,
      },
    };
  }

  async putTree(
    body: unknown,
    treePath: string,
    query: {
      patches_sha?: string;
      validate_all?: string;
      validate_sources?: string;
      validate_binary_files?: string;
    },
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiTreeResponse>> {
    const auth = this.getAuth(cookies);
    if (auth.error) {
      return {
        status: 401,
        json: {
          message: auth.error,
        },
      };
    }
    if (this.serverOps instanceof ValOpsHttp && !("id" in auth)) {
      return {
        status: 401,
        json: {
          message: "Unauthorized",
        },
      };
    }
    // TODO: move
    const PutTreeBody = z
      .object({
        patchIds: z
          .array(
            z.string().refine(
              (id): id is PatchId => true // TODO:
            )
          )
          .optional(),
        addPatch: z
          .object({
            path: z.string().refine(
              (path): path is ModuleFilePath => true // TODO:
            ),
            patch: Patch,
          })
          .optional(),
      })
      .optional();
    const moduleErrors = await this.serverOps.getModuleErrors();
    if (moduleErrors?.length > 0) {
      console.error("Val: Module errors", moduleErrors);
      return {
        status: 500,
        json: {
          message: "Val is not correctly setup. Check the val.modules file",
          details: moduleErrors,
        },
      };
    }
    const bodyRes = PutTreeBody.safeParse(body);
    if (!bodyRes.success) {
      return {
        status: 400,
        json: {
          message: "Invalid body: " + fromError(bodyRes.error).toString(),
          details: bodyRes.error.errors,
        },
      };
    }
    let tree: {
      sources: Sources;
      errors: Record<
        ModuleFilePath,
        {
          patchId?: PatchId | undefined;
          invalidPath?: boolean | undefined;
          error: PatchError;
        }[]
      >;
    };
    let patchAnalysis: PatchAnalysis | null = null;
    if (
      (bodyRes.data?.patchIds && bodyRes.data?.patchIds?.length > 0) ||
      bodyRes.data?.addPatch
    ) {
      // TODO: validate patches_sha
      const patchIds = bodyRes.data?.patchIds;
      const patchOps =
        patchIds && patchIds.length > 0
          ? await this.serverOps.getPatchOpsById(patchIds)
          : { patches: {} };
      let patchErrors: Record<PatchId, { message: string }> | undefined =
        undefined;
      for (const [patchIdS, error] of Object.entries(patchOps.errors || {})) {
        const patchId = patchIdS as PatchId;
        if (!patchErrors) {
          patchErrors = {};
        }
        patchErrors[patchId] = {
          message: error.message,
        };
      }
      if (bodyRes.data?.addPatch) {
        const newPatchModuleFilePath = bodyRes.data.addPatch.path;
        const newPatchOps = bodyRes.data.addPatch.patch;
        const authorId = "id" in auth ? (auth.id as AuthorId) : null;
        const createPatchRes = await this.serverOps.createPatch(
          newPatchModuleFilePath,
          newPatchOps,
          authorId
        );
        if (createPatchRes.error) {
          return {
            status: 500,
            json: {
              message:
                "Failed to create patch: " + createPatchRes.error.message,
              details: createPatchRes.error,
            },
          };
        }
        // TODO: evaluate if we need this: seems wrong to delete patches that are not applied
        // for (const fileRes of createPatchRes.files) {
        //   if (fileRes.error) {
        //     // clean up broken patch:
        //     await this.serverOps.deletePatches([createPatchRes.patchId]);
        //     return {
        //       status: 500,
        //       json: {
        //         message: "Failed to create patch",
        //         details: fileRes.error,
        //       },
        //     };
        //   }
        // }
        patchOps.patches[createPatchRes.patchId] = {
          path: newPatchModuleFilePath,
          patch: newPatchOps,
          authorId,
          createdAt: createPatchRes.createdAt,
          appliedAt: null,
        };
      }
      // TODO: errors
      patchAnalysis = this.serverOps.analyzePatches(patchOps.patches);
      tree = {
        ...(await this.serverOps.getTree({
          ...patchAnalysis,
          ...patchOps,
        })),
      };
      if (query.validate_all === "true") {
        const allTree = await this.serverOps.getTree();
        tree = {
          sources: {
            ...allTree.sources,
            ...tree.sources,
          },
          errors: {
            ...allTree.errors,
            ...tree.errors,
          },
        };
      }
    } else {
      tree = await this.serverOps.getTree();
    }
    if (tree.errors && Object.keys(tree.errors).length > 0) {
      console.error("Val: Failed to get tree", JSON.stringify(tree.errors));
    }

    if (
      query.validate_sources === "true" ||
      query.validate_binary_files === "true"
    ) {
      const schemas = await this.serverOps.getSchemas();
      const sourcesValidation = await this.serverOps.validateSources(
        schemas,
        tree.sources
      );

      // TODO: send validation errors
      if (query.validate_binary_files === "true") {
        const binaryFilesValidation = await this.serverOps.validateFiles(
          schemas,
          tree.sources,
          sourcesValidation.files
        );
      }
    }

    const schemaSha = await this.serverOps.getSchemaSha();
    const modules: Record<
      ModuleFilePath,
      {
        source: Json;
        patches?: {
          applied: PatchId[];
          skipped?: PatchId[];
          errors?: Record<PatchId, { message: string }>;
        };
        validationErrors?: Record<SourcePath, ValidationError[]>;
      }
    > = {};
    for (const [moduleFilePathS, module] of Object.entries(tree.sources)) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      if (moduleFilePath.startsWith(treePath)) {
        modules[moduleFilePath] = {
          source: module,
          patches: patchAnalysis
            ? {
                applied: patchAnalysis.patchesByModule[moduleFilePath].map(
                  (p) => p.patchId
                ),
              }
            : undefined,
        };
      }
    }
    return {
      status: 200,
      json: {
        schemaSha,
        modules,
      },
    };
  }

  async postSave(
    body: unknown,
    cookies: Partial<Record<"val_session", string>>
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  > {
    const auth = this.getAuth(cookies);
    if (auth.error) {
      return {
        status: 401,
        json: {
          message: auth.error,
        },
      };
    }
    const PostSaveBody = z.object({
      patchIds: z.array(
        z.string().refine(
          (id): id is PatchId => true // TODO:
        )
      ),
    });
    const bodyRes = PostSaveBody.safeParse(body);
    if (!bodyRes.success) {
      return {
        status: 400,
        json: {
          message: "Invalid body: " + fromError(bodyRes.error).toString(),
          details: bodyRes.error.errors,
        },
      };
    }
    const { patchIds } = bodyRes.data;
    const patches = await this.serverOps.getPatchOpsById(patchIds);
    const analysis = this.serverOps.analyzePatches(patches.patches);
    const preparedCommit = await this.serverOps.prepare({
      ...analysis,
      ...patches,
    });
    if (preparedCommit.hasErrors) {
      console.error("Failed to create commit", {
        sourceFilePatchErrors: preparedCommit.sourceFilePatchErrors,
        binaryFilePatchErrors: preparedCommit.binaryFilePatchErrors,
      });
      return {
        status: 400,
        json: {
          message: "Failed to create commit",
          details: {
            sourceFilePatchErrors: preparedCommit.sourceFilePatchErrors,
            binaryFilePatchErrors: preparedCommit.binaryFilePatchErrors,
          },
        },
      };
    }
    if (this.serverOps instanceof ValOpsFS) {
      await this.serverOps.saveFiles(preparedCommit);
      return {
        status: 200,
        json: {}, // TODO:
      };
    } else if (this.serverOps instanceof ValOpsHttp) {
      if (auth.error === undefined && auth.id) {
        await this.serverOps.commit(
          preparedCommit,
          "Update content: " +
            Object.keys(analysis.patchesByModule) +
            " modules changed",
          auth.id as AuthorId
        );
        return {
          status: 200,
          json: {}, // TODO:
        };
      }
      return {
        status: 401,
        json: {
          message: "Unauthorized",
        },
      };
    } else {
      throw new Error("Invalid server ops");
    }
  }

  //#region files
  async getFiles(
    filePath: string,
    query: { patch_id?: string }
  ): Promise<
    | ValServerError
    | {
        status: 200 | 201;
        headers?: Record<string, string>;
        cookies?: ValServerResultCookies<never>;
        body?: ReadableStream<Uint8Array>;
      }
  > {
    // NOTE: no auth here since you would need the patch_id to get something that is not published.
    // For everything that is published, well they are already public so no auth required there...
    // We could imagine adding auth just to be a 200% certain,
    // However that won't work since images are requested by the nextjs backend as a part of image optimization (again: as an example) which is a backend-to-backend op (no cookies, ...).
    // So: 1) patch ids are not possible to guess (but possible to brute force)
    //     2) the process of shimming a patch into the frontend would be quite challenging (so just trying out this attack would require a lot of effort)
    //     3) the benefit an attacker would get is an image that is not yet published (i.e. most cases: not very interesting)
    // Thus: attack surface + ease of attack + benefit = low probability of attack
    // If we couldn't argue that patch ids are secret enough, then this would be a problem.
    let fileBuffer;
    if (query.patch_id) {
      fileBuffer = await this.serverOps.getBase64EncodedBinaryFileFromPatch(
        filePath,
        query.patch_id as PatchId
      );
    } else {
      fileBuffer = await this.serverOps.getBinaryFile(filePath);
    }
    if (fileBuffer) {
      return {
        status: 200,
        body: bufferToReadableStream(fileBuffer),
      };
    } else {
      return {
        status: 404,
        json: {
          message: "File not found",
        },
      };
    }
  }
}

export type ValServerCallbacks = {
  isEnabled: () => Promise<boolean>;
  onEnable: (success: boolean) => Promise<void>;
  onDisable: (success: boolean) => Promise<void>;
};

function verifyCallbackReq(
  stateCookie: string | undefined,
  queryParams: Record<string, unknown>
):
  | {
      success: { code: string; redirect_uri?: string };
      error: null;
    }
  | { success: false; error: string } {
  if (typeof stateCookie !== "string") {
    return { success: false, error: "No state cookie" };
  }

  const { code, state: tokenFromQuery } = queryParams;

  if (typeof code !== "string") {
    return { success: false, error: "No code query param" };
  }
  if (typeof tokenFromQuery !== "string") {
    return { success: false, error: "No state query param" };
  }

  const { success: cookieStateSuccess, error: cookieStateError } =
    getStateFromCookie(stateCookie);

  if (cookieStateError !== null) {
    return { success: false, error: cookieStateError };
  }

  if (cookieStateSuccess.token !== tokenFromQuery) {
    return { success: false, error: "Invalid state token" };
  }

  return {
    success: { code, redirect_uri: cookieStateSuccess.redirect_to },
    error: null,
  };
}

type StateCookie = {
  redirect_to: string;
  token: string;
};

function getStateFromCookie(stateCookie: string):
  | {
      success: StateCookie;
      error: null;
    }
  | { success: false; error: string } {
  try {
    const decoded = Buffer.from(stateCookie, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;

    if (!parsed) {
      return {
        success: false,
        error: "Invalid state cookie: could not parse",
      };
    }
    if (typeof parsed !== "object") {
      return {
        success: false,
        error: "Invalid state cookie: parsed object is not an object",
      };
    }
    if ("token" in parsed && "redirect_to" in parsed) {
      const { token, redirect_to } = parsed;
      if (typeof token !== "string") {
        return {
          success: false,
          error: "Invalid state cookie: no token in parsed object",
        };
      }
      if (typeof redirect_to !== "string") {
        return {
          success: false,
          error: "Invalid state cookie: no redirect_to in parsed object",
        };
      }
      return {
        success: {
          token,
          redirect_to,
        },
        error: null,
      };
    } else {
      return {
        success: false,
        error: "Invalid state cookie: no token or redirect_to in parsed object",
      };
    }
  } catch (err) {
    return {
      success: false,
      error: "Invalid state cookie: could not parse",
    };
  }
}

async function createJsonError(fetchRes: Response): Promise<ValServerError> {
  if (fetchRes.headers.get("Content-Type")?.includes("application/json")) {
    return {
      status: fetchRes.status as ValServerErrorStatus,
      json: await fetchRes.json(),
    };
  }
  console.error(
    "Unexpected failure (did not get a json) - Val down?",
    fetchRes.status,
    await fetchRes.text()
  );
  return {
    status: fetchRes.status as ValServerErrorStatus,
    json: {
      message: "Unexpected failure (did not get a json) - Val down?",
    },
  };
}

function createStateCookie(state: StateCookie): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64");
}

const ValAppJwtPayload = z.object({
  sub: z.string(),
  exp: z.number(),
  project: z.string(),
  org: z.string(),
});
type ValAppJwtPayload = z.infer<typeof ValAppJwtPayload>;

const IntegratedServerJwtPayload = z.object({
  sub: z.string(),
  exp: z.number(),
  token: z.string(),
  org: z.string(),
  project: z.string(),
});
export type IntegratedServerJwtPayload = z.infer<
  typeof IntegratedServerJwtPayload
>;

async function withAuth<T>(
  secret: string,
  cookies: ValCookies<VAL_SESSION_COOKIE>,
  errorMessageType: string,
  handler: (data: IntegratedServerJwtPayload) => Promise<T>
): Promise<T | ValServerError> {
  const cookie = cookies[VAL_SESSION_COOKIE];
  if (typeof cookie === "string") {
    const decodedToken = decodeJwt(cookie, secret);
    if (!decodedToken) {
      return {
        status: 401,
        json: {
          message: "Could not verify session. You will need to login again.",
          details: "Invalid token",
        },
      };
    }
    const verification = IntegratedServerJwtPayload.safeParse(decodedToken);
    if (!verification.success) {
      return {
        status: 401,
        json: {
          message:
            "Session invalid or, most likely, expired. You will need to login again.",
          details: verification.error,
        },
      };
    }
    return handler(verification.data).catch((err) => {
      console.error(`Failed while processing: ${errorMessageType}`, err);
      return {
        status: 500,
        json: {
          message: err.message,
        },
      };
    });
  } else {
    return {
      status: 401,
      json: {
        message: "Login required",
        details: {
          reason: "Cookie not found",
        },
      },
    };
  }
}

function getAuthHeaders(
  token: string,
  type?: "application/json" | "application/json-patch+json"
):
  | { Authorization: string }
  | { "Content-Type": string; Authorization: string } {
  if (!type) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }
  return {
    "Content-Type": type,
    Authorization: `Bearer ${token}`,
  };
}

export const ENABLE_COOKIE_VALUE = {
  value: "true",
  options: {
    httpOnly: false,
    sameSite: "lax",
  },
} as const;
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
