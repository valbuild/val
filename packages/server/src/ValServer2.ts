/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ApiCommitResponse,
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ApiPostValidationErrorResponse,
  ApiTreeResponse,
  ApiDeletePatchResponse,
  ApiPostValidationResponse,
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
import {
  ENABLE_COOKIE_VALUE,
  RequestHeaders,
  getRedirectUrl,
} from "./ValServer";
import { ValOpsFS } from "./ValOpsFS";
import { AuthorId, Patches, Sources } from "./ValOps";
import { fromError } from "zod-validation-error";
import { Patch } from "./patch/validation";
import { PatchError } from "@valbuild/core/patch";

export type ValServerOptions = {
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
  git: {
    commit?: string;
    branch?: string;
  };
};

export class ValServer2 {
  private serverOps: ValOpsFS;
  constructor(
    readonly valModules: ValModules,
    readonly options: {
      mode: "fs";
      cwd: string;
      re: string;
      // TODO: figure  what we need here and and what we need in other
      formatter?: (code: string, filePath: string) => string;
      valEnableRedirectUrl?: string;
      valDisableRedirectUrl?: string;
      valBuildUrl?: string;
      valSecret?: string;
      apiKey?: string;
      remote?: string;
    },
    readonly callbacks: ValServerCallbacks
  ) {
    if (options.mode === "fs") {
      this.serverOps = new ValOpsFS(options.cwd, valModules, {
        formatter: options.formatter,
      });
    } else {
      throw Error("Unsupported mode");
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
  }): Promise<ValServerRedirectResult<VAL_STATE_COOKIE>> {
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
      `${redirectUrl.origin}/${this.options.re}`,
      token
    );
    return {
      cookies: {
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

  async log(): Promise<ValServerResult<VAL_SESSION_COOKIE | VAL_STATE_COOKIE>> {
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

  async session(
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ValSession>> {
    if (!this.options.valSecret) {
      return {
        status: 200,
        json: {
          mode: "local",
          enabled: await this.callbacks.isEnabled(),
        },
      };
    }
    return withAuth(
      this.options.valSecret,
      cookies,
      "session",
      async (data) => {
        const url = new URL(
          `/api/val/${this.options.remote}/auth/session`,
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
              d: await this.callbacks.isEnabled(),
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
    const url = new URL(
      `/api/val/${this.options.remote}/auth/token`,
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
    const url = new URL(
      `/auth/${this.options.remote}/authorize`,
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
    const url = new URL(
      `/auth/${this.options.remote}/authorize`,
      this.options.valBuildUrl
    );
    url.searchParams.set("error", encodeURIComponent(error));
    return url.toString();
  }

  //#region patches
  async getPatches(
    query: { authors?: string[] },
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiGetPatchResponse>> {
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
        created_at: patchData.created_at,
        author: patchData.authorId ?? undefined,
      });
    }
    return {
      status: 200,
      json: res,
    };
  }
  postPatches(
    body: unknown,
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>> {
    throw new Error("Method not implemented.");
  }
  deletePatches(
    query: { id?: string[] },
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiDeletePatchResponse>> {
    throw new Error("Method not implemented.");
  }

  //#region tree ops
  async getSchema(
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiSchemaResponse>> {
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
        const authorId = null; // TODO:
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
        patchOps.patches[createPatchRes.patchId] = {
          path: newPatchModuleFilePath,
          patch: newPatchOps,
          authorId,
          created_at: createPatchRes.created_at,
          appliedAt: null,
        };
      }
      // TODO: errors
      const patchAnalysis = this.serverOps.analyzePatches(patchOps.patches);
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

  postCommit(
    body: unknown,
    cookies: Partial<Record<"val_session", string>>,
    requestHeaders: RequestHeaders
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  > {
    throw new Error("Method not implemented.");
  }

  postSave(
    body: unknown,
    cookies: Partial<Record<"val_session", string>>,
    requestHeaders: RequestHeaders
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  > {
    throw new Error("Method not implemented.");
  }

  //#region files
  putFiles(
    body: unknown,
    filePath: string,
    query: { base_sha?: string; patches_sha?: string },
    cookies: Partial<Record<"val_session", string>>,
    requestHeaders: RequestHeaders
  ): Promise<
    | ValServerError
    | {
        status: 302;
        cookies?: ValServerResultCookies<"val_session">;
        redirectTo: string;
        headers?: Record<string, string>;
      }
    | {
        status: 200 | 201;
        headers?: Record<string, string>;
        cookies?: ValServerResultCookies<never>;
        body?: ReadableStream<Uint8Array>;
      }
  > {
    throw new Error("Method not implemented.");
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

// TODO: remove?
function createParams(
  params: Record<string, string | string[] | undefined>
): string {
  let paramIdx = 0;
  let paramsString = "";
  for (const key in params) {
    const param = params[key];
    if (Array.isArray(param)) {
      for (const value of param) {
        paramsString += `${key}=${encodeURIComponent(value)}&`;
      }
    } else if (param) {
      paramsString += `${key}=${encodeURIComponent(param)}`;
    }
    if (paramIdx < Object.keys(params).length - 1) {
      paramsString += "&";
    }
    paramIdx++;
  }

  return paramsString;
}
