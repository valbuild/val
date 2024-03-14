import crypto from "crypto";
import { decodeJwt, encodeJwt, getExpire } from "./jwt";
import { PatchJSON } from "./patch/validation";
import {
  ENABLE_COOKIE_VALUE,
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
import { Patch, parsePatch } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { RemoteFS } from "./RemoteFS";
import { Service, ServiceOptions, createService } from "./Service";
import { SerializedModuleContent } from "./SerializedModuleContent";
import fs from "fs";

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
  valName: string;
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
};

export class ProxyValServer extends ValServer {
  private remoteFS: RemoteFS;
  private lazyService: Service | undefined;
  constructor(
    readonly projectRoot: string,
    readonly options: ProxyValServerOptions,
    readonly serviceOptions: ServiceOptions,
    readonly callbacks: ValServerCallbacks
  ) {
    const remoteFS = new RemoteFS();
    super(projectRoot, remoteFS, options, callbacks);
    this.remoteFS = remoteFS;
  }

  /** Remote FS dependent methods: */

  protected async getModule(
    moduleId: ModuleId
  ): Promise<SerializedModuleContent> {
    if (!this.lazyService) {
      this.lazyService = await createService(
        this.projectRoot,
        this.serviceOptions,
        this.remoteFS
      );
    }
    return this.lazyService.get(moduleId);
  }

  protected execCommit(
    patches: [PatchId, ModuleId, Patch][],
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<Record<ModuleId, { patches: { applied: PatchId[] } }>> {
    // TODO: apply patches, send updated files to server
    throw new Error("Method not implemented.");
  }

  protected async ensureRemoteFSInitialized(
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
        if (!this.remoteFS.isInitialized()) {
          const params = new URLSearchParams({
            commit,
          });
          const url = new URL(
            `/v1/fs/${this.options.valName}/heads/${this.options.git.branch}/~?${params}`,
            this.options.valContentUrl
          );
          try {
            const fetchRes = await fetch(url, {
              headers: getAuthHeaders(data.token, "application/json"),
            });
            if (fetchRes.status === 200) {
              const json = await fetchRes.json();
              this.remoteFS.initializeWith(json);
              return {
                status: 200,
              };
            } else {
              try {
                if (
                  fetchRes.headers
                    .get("Content-Type")
                    ?.includes("application/json")
                ) {
                  const json = await fetchRes.json();
                  return {
                    status: fetchRes.status as
                      | 400
                      | 401
                      | 403
                      | 404
                      | 500
                      | 501,
                    json: {
                      message: "Failed to fetch remote files",
                      details: json,
                    },
                  };
                }
              } catch (err) {
                console.error(err);
              }
              return {
                status: fetchRes.status as 400 | 401 | 403 | 404 | 500 | 501,
                json: {
                  message: "Unknown failure while fetching remote files",
                },
              };
            }
          } catch (err) {
            return {
              status: 500,
              json: {
                message: "Failed to fetch: check network connection",
              },
            };
          }
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
          `/api/val/${this.options.valName}/auth/session`,
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
      `/api/val/${this.options.valName}/auth/token`,
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
      `/auth/${this.options.valName}/authorize`,
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
      `/auth/${this.options.valName}/authorize`,
      this.options.valBuildUrl
    );
    url.searchParams.set("error", encodeURIComponent(error));
    return url.toString();
  }

  /* Patch endpoints */
  async deletePatches(
    query: { id?: string[] | undefined },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiDeletePatchResponse>> {
    throw new Error("Method not implemented.");
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
          `/v1/patches/${this.options.valName}/heads/${this.options.git.branch}/~?${params}`,
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
          return {
            status: fetchRes.status as ValServerErrorStatus,
            json: {
              message: "Failed to get patches",
            },
          };
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
        const patchJSON = z.record(PatchJSON).safeParse(body);
        if (!patchJSON.success) {
          return {
            status: 400,
            json: {
              message: "Invalid patch(es)",
              details: patchJSON.error.issues,
            },
          };
        }

        // We send PatchJSON (not Patch) to val.build,
        // but before we validate that the patches are parsable - no point in just failing down the line
        const patches = patchJSON.data;
        for (const [moduleId, patch] of Object.entries(patches)) {
          const parsedPatchRes = parsePatch(patch);
          if (result.isErr(parsedPatchRes)) {
            return {
              status: 400,
              json: {
                message: "Invalid patch(es): path is not valid",
                details: {
                  [moduleId]: parsedPatchRes.error,
                },
              },
            };
          }
        }
        const url = new URL(
          `/v1/patches/${this.options.valName}/heads/${this.options.git.branch}/~?${params}`,
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
          return {
            status: fetchRes.status as ValServerErrorStatus,
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
