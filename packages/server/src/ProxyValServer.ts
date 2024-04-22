import crypto from "crypto";
import { decodeJwt, encodeJwt, getExpire } from "./jwt";
import {
  ENABLE_COOKIE_VALUE,
  RequestHeaders,
  ValServer,
  ValServerCallbacks,
} from "./ValServer";
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
  ValSession,
} from "@valbuild/shared/internal";
import { z } from "zod";
import {
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ApiDeletePatchResponse,
  PatchId,
  ModuleId,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { SerializedModuleContent } from "./SerializedModuleContent";
import { Patch } from "./patch/validation";
import { ValApiOptions } from "./createValApiRouter";

export type ProxyValServerOptions = {
  apiKey: string;
  route: string;
  valSecret: string;
  valBuildUrl: string;
  valContentUrl: string;
  git: {
    commit: string;
    branch: string;
  };
  remote: string;
  versions: {
    core: string;
    next: string;
  };
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
};

export class ProxyValServer extends ValServer {
  private moduleCache: Record<ModuleId, SerializedModuleContent> | null = null;
  constructor(
    readonly cwd: string,
    readonly options: ProxyValServerOptions,
    readonly apiOptions: ValApiOptions,
    readonly callbacks: ValServerCallbacks
  ) {
    super(cwd, options, callbacks);
    this.moduleCache = null;
  }

  /** Remote FS dependent methods: */

  protected async getModule(
    moduleId: ModuleId,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: { validate: boolean; source: boolean; schema: boolean }
  ): Promise<SerializedModuleContent> {
    if (this.moduleCache) {
      return this.moduleCache[moduleId];
    }
    throw new Error("Module cache not initialized");
  }

  async getAllModules(treePath: string): Promise<ModuleId[]> {
    if (!this.moduleCache) {
      throw new Error("Module cache not initialized");
    }
    return Object.keys(this.moduleCache).filter((moduleId) =>
      moduleId.startsWith(treePath)
    ) as ModuleId[];
  }

  protected execCommit(
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
  > {
    return withAuth(
      this.options.valSecret,
      cookies,
      "execCommit",
      async ({ token }) => {
        const commit = this.options.git.commit;
        if (!commit) {
          return {
            status: 400,
            json: {
              message:
                "Could not detect the git commit. Check if env is missing VAL_GIT_COMMIT.",
            },
          };
        }
        const params = createParams({
          root: this.apiOptions.root,
          commit,
          ext: ["ts", "js", "json"],
          package: [
            "@valbuild/core@" + this.options.versions.core,
            "@valbuild/next@" + this.options.versions.next,
          ],
          include: [
            "**/*.val.{js,ts},package.json,tsconfig.json,jsconfig.json",
          ],
        });
        const url = new URL(
          `/v1/commit/${this.options.remote}/heads/${this.options.git.branch}/~?${params}`,
          this.options.valContentUrl
        );
        const patchIds = patches.map(([patchId]) => patchId);
        const fetchRes = await fetch(url, {
          method: "POST",
          headers: getAuthHeaders(token, "application/json"),
          body: JSON.stringify({
            patchIds,
          }),
        });

        if (fetchRes.status === 200) {
          return {
            status: fetchRes.status,
            json: await fetchRes.json(),
          };
        } else {
          return createJsonError(fetchRes);
        }
      }
    );
  }

  private async init(
    commit: string,
    token: string
  ): Promise<{ status: 200 } | ValServerError> {
    const params = createParams({
      root: this.apiOptions.root,
      commit,
      ext: ["ts", "js", "json"],
      package: [
        "@valbuild/core@" + this.options.versions.core,
        "@valbuild/next@" + this.options.versions.next,
      ],
      include: ["**/*.val.{js,ts},package.json,tsconfig.json,jsconfig.json"],
    });
    const url = new URL(
      `/v1/eval/${this.options.remote}/heads/${this.options.git.branch}/~?${params}`,
      this.options.valContentUrl
    );
    try {
      const fetchRes = await fetch(url, {
        headers: getAuthHeaders(token, "application/json"),
      });
      if (fetchRes.status === 200) {
        const json = await fetchRes.json();

        let error:
          | false
          | {
              details: string;
            } = false;
        if (typeof json !== "object") {
          error = {
            details: "Invalid response: not an object",
          };
        }
        if (typeof json.git !== "object") {
          error = {
            details: "Invalid response: missing git",
          };
        }
        if (typeof json.git.commit !== "string") {
          error = {
            details: "Invalid response: missing git.commit",
          };
        }
        if (typeof json.modules !== "object" || json.modules === null) {
          error = {
            details: "Invalid response: missing modules",
          };
        }
        if (error) {
          console.error("Could not initialize remote modules", error);
          return {
            status: 500,
            json: {
              message: "Failed to fetch remote modules",
              ...error,
            },
          };
        }
        this.moduleCache = json.modules;
        return {
          status: 200,
        };
      } else {
        return createJsonError(fetchRes);
      }
    } catch (err) {
      return {
        status: 500,
        json: {
          message: "Failed to fetch: check network connection",
        },
      };
    }
  }

  protected async ensureInitialized(
    errorMessageType: string,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<result.Result<undefined, ValServerError>> {
    const commit = this.options.git.commit;
    if (!commit) {
      return result.err({
        status: 400,
        json: {
          message:
            "Could not detect the git commit. Check if env is missing VAL_GIT_COMMIT.",
        },
      });
    }
    const res = await withAuth(
      this.options.valSecret,
      cookies,
      errorMessageType,
      async (
        data
      ): Promise<
        | {
            status: 200;
          }
        | ValServerError
      > => {
        if (!this.moduleCache) {
          return this.init(commit, data.token);
        } else {
          return {
            status: 200 as const,
          };
        }
      }
    );
    if (res.status === 200) {
      return result.ok(undefined);
    } else {
      return result.err(res);
    }
  }
  /* Auth endpoints */

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
      `${redirectUrl.origin}/${this.options.route}`,
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
    const cookie = encodeJwt(
      {
        ...data,
        exp, // this is the client side exp
      },
      this.options.valSecret
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

  async session(
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ValSession>> {
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
    const url = new URL(
      `/api/val/${this.options.remote}/auth/token`,
      this.options.valBuildUrl
    );
    url.searchParams.set("code", encodeURIComponent(code));
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

  private getAuthorizeUrl(publicValApiRoute: string, token: string): string {
    const url = new URL(
      `/auth/${this.options.remote}/authorize`,
      this.options.valBuildUrl
    );
    url.searchParams.set(
      "redirect_uri",
      encodeURIComponent(`${publicValApiRoute}/callback`)
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

  /* Patch endpoints */
  async deletePatches(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    query: { id?: string[] | undefined },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiDeletePatchResponse>> {
    return withAuth(
      this.options.valSecret,
      cookies,
      "deletePatches",
      async ({ token }) => {
        const patchIds = query.id || [];
        const url = new URL(
          `/v1/patches/${this.options.remote}/heads/${this.options.git.branch}/~`,
          this.options.valContentUrl
        );
        const fetchRes = await fetch(url, {
          method: "DELETE",
          headers: getAuthHeaders(token, "application/json"),
          body: JSON.stringify({
            patches: patchIds,
          }),
        });
        if (fetchRes.status === 200) {
          return {
            status: fetchRes.status,
            json: await fetchRes.json(),
          };
        } else {
          return createJsonError(fetchRes);
        }
      }
    );
  }

  async getPatches(
    query: { id?: string[] },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiGetPatchResponse>> {
    return withAuth(
      this.options.valSecret,
      cookies,
      "getPatches",
      async ({ token }) => {
        const commit = this.options.git.commit;
        if (!commit) {
          return {
            status: 400,
            json: {
              message:
                "Could not detect the git commit. Check if env is missing VAL_GIT_COMMIT.",
            },
          };
        }

        const patchIds = query.id || [];
        const params =
          patchIds.length > 0
            ? `commit=${encodeURIComponent(commit)}&${patchIds
                .map((id) => `id=${encodeURIComponent(id)}`)
                .join("&")}`
            : `commit=${encodeURIComponent(commit)}`;
        const url = new URL(
          `/v1/patches/${this.options.remote}/heads/${this.options.git.branch}/~?${params}`,
          this.options.valContentUrl
        );
        // Proxy patch to val.build
        const fetchRes = await fetch(url, {
          method: "GET",
          headers: getAuthHeaders(token, "application/json"),
        });
        if (fetchRes.status === 200) {
          return {
            status: fetchRes.status,
            json: await fetchRes.json(),
          };
        } else {
          return createJsonError(fetchRes);
        }
      }
    );
  }

  async postPatches(
    body: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>> {
    const commit = this.options.git.commit;
    if (!commit) {
      return {
        status: 401,
        json: {
          message:
            "Could not detect the git commit. Check if env is missing VAL_GIT_COMMIT.",
        },
      };
    }
    const params = new URLSearchParams({
      commit,
    });
    return withAuth(
      this.options.valSecret,
      cookies,
      "postPatches",
      async ({ token }) => {
        // First validate that the body has the right structure
        const parsedPatches = z.record(Patch).safeParse(body);
        if (!parsedPatches.success) {
          return {
            status: 400,
            json: {
              message: "Invalid patch(es)",
              details: parsedPatches.error.issues,
            },
          };
        }
        const patches = parsedPatches.data;
        const url = new URL(
          `/v1/patches/${this.options.remote}/heads/${this.options.git.branch}/~?${params}`,
          this.options.valContentUrl
        );
        // Proxy patch to val.build
        const fetchRes = await fetch(url, {
          method: "POST",
          headers: getAuthHeaders(token, "application/json"),
          body: JSON.stringify(patches),
        });
        if (fetchRes.status === 200) {
          return {
            status: fetchRes.status,
            json: await fetchRes.json(),
          };
        } else {
          return createJsonError(fetchRes);
        }
      }
    );
  }

  async getFiles(
    filePath: string,
    query: { sha256?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    reqHeaders: RequestHeaders
  ): Promise<
    | ValServerResult<never, ReadableStream<Uint8Array>>
    | ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>
  > {
    return withAuth(
      this.options.valSecret,
      cookies,
      "getFiles",
      async (data) => {
        const url = new URL(
          `/v1/files/${this.options.remote}${filePath}`,
          this.options.valContentUrl
        );
        if (typeof query.sha256 === "string") {
          url.searchParams.append("sha256", query.sha256 as string);
        } else {
          console.warn("Missing sha256 query param");
        }
        const fetchRes = await fetch(url, {
          headers: getAuthHeaders(data.token),
        });
        if (fetchRes.status === 200) {
          // TODO: does this stream data?
          if (fetchRes.body) {
            return {
              status: fetchRes.status,
              headers: {
                "Content-Type": fetchRes.headers.get("Content-Type") || "",
                "Content-Length": fetchRes.headers.get("Content-Length") || "0",
                "Cache-Control": "public, max-age=31536000, immutable",
              },
              body: fetchRes.body,
            };
          } else {
            return {
              status: 500,
              json: {
                message: "No body in response",
              },
            };
          }
        } else {
          if (!(reqHeaders.host && reqHeaders["x-forwarded-proto"])) {
            return {
              status: 500,
              json: {
                message: "Missing host or x-forwarded-proto header",
              },
            };
          }
          const host = `${reqHeaders["x-forwarded-proto"]}://${reqHeaders["host"]}`;
          const fileUrl = filePath.slice("/public".length);
          return {
            status: 302,
            redirectTo: new URL(fileUrl, host).toString(),
          };
        }
      }
    );
  }
}

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
