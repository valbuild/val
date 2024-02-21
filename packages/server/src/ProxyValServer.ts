import crypto from "crypto";
import { decodeJwt, encodeJwt, getExpire } from "./jwt";
import { PatchJSON } from "./patch/validation";
import {
  ValServer,
  ENABLE_COOKIE_VALUE,
  getRedirectUrl,
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
  ApiCommitResponse,
  ApiGetPatchResponse,
  ApiPostValidationErrorResponse,
  ApiPostPatchResponse,
  ApiPostValidationResponse,
  ApiTreeResponse,
  ApiDeletePatchResponse,
  PatchId,
  ModuleId,
  ImageMetadata,
  FileMetadata,
} from "@valbuild/core";
import { Patch, parsePatch } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { RemoteFS } from "./RemoteFS";
import { LocalValServer } from "./LocalValServer";
import { Service } from "./Service";

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

// TODO: move tree, validate, commit

export class ProxyValServer implements ValServer {
  private readonly hybridLocalServer: HybridLocalValServer;
  constructor(
    private readonly remoteFS: RemoteFS,
    readonly remoteService: Service,
    readonly options: ProxyValServerOptions,
    readonly callbacks: ValServerCallbacks
  ) {
    this.hybridLocalServer = new HybridLocalValServer(
      this.options.valSecret,
      this.remoteFS,
      {
        ...options,
        service: remoteService,
      },
      callbacks
    );
  }

  deletePatches(
    query: { id?: string[] | undefined },
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiDeletePatchResponse>> {
    throw new Error("Method not implemented.");
  }

  async getFiles(
    treePath: string,
    query: { sha256?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerResult<never, ReadableStream<Uint8Array>>> {
    return withAuth(
      this.options.valSecret,
      cookies,
      "getFiles",
      async (data) => {
        const url = new URL(
          `/v1/files/${this.options.valName}${treePath}`,
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
          if (fetchRes.body) {
            return {
              status: fetchRes.status,
              headers: {
                "Content-Type": fetchRes.headers.get("Content-Type") || "",
                "Content-Length": fetchRes.headers.get("Content-Length") || "0",
              },
              json: fetchRes.body,
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
          return {
            status: fetchRes.status as ValServerErrorStatus,
            json: {
              message: "Failed to get files",
            },
          };
        }
      }
    );
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
          value: null,
        },
      },
      status: 302,
      redirectTo: redirectToRes,
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

  async getTree(
    treePath: string,
    query: { patch?: string; schema?: string; source?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiTreeResponse>> {
    return withAuth(
      this.options.valSecret,
      cookies,
      "getTree",
      async (data) => {
        const remoteFSRes = await this.initializeRemoteFS(data);
        if (result.isErr(remoteFSRes)) {
          return remoteFSRes.error;
        }

        return this.hybridLocalServer.getTree(treePath, query, cookies);
      }
    );
  }

  private async initializeRemoteFS(
    data: IntegratedServerJwtPayload
  ): Promise<result.Result<RemoteFS, ValServerError>> {
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
    // TODO: sleep if we already tried to initialize
    if (!this.remoteFS.isInitialized) {
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
          return result.ok(this.remoteFS);
        } else {
          try {
            if (
              fetchRes.headers.get("Content-Type")?.includes("application/json")
            ) {
              const json = await fetchRes.json();
              return result.err({
                status: fetchRes.status as ValServerErrorStatus,
                json: {
                  message: "Failed to fetch remote files",
                  details: json,
                },
              });
            }
          } catch (err) {
            console.error(err);
          }

          return result.err({
            status: fetchRes.status as ValServerErrorStatus,
            json: {
              message: "Unknown failure while fetching remote files",
            },
          });
        }
      } catch (err) {
        return result.err({
          status: 500,
          json: {
            message: "Failed to fetch: check network connection",
          },
        });
      }
    }
    return result.ok(this.remoteFS);
  }

  async getPatches(
    query: { id?: string[] },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiGetPatchResponse>> {
    return getPatches(this.options, query, cookies);
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

  async postCommit(
    rawBody: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  > {
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
      "postCommit",
      async (data) => {
        const remoteFSRes = await this.initializeRemoteFS(data);
        if (result.isErr(remoteFSRes)) {
          return remoteFSRes.error;
        }
        await this.hybridLocalServer.postCommit(rawBody, cookies);
        const body = JSON.stringify({
          fileOps: await remoteFSRes.value.getPendingOperations(),
          // TODO: pass the patches that were applied (so we can tag them)
        });

        const url = new URL(
          `/v1/commit/${this.options.valName}/heads/${this.options.git.branch}/~?${params}`,
          this.options.valContentUrl
        );
        const fetchRes = await fetch(url, {
          method: "POST",
          headers: getAuthHeaders(data.token, "application/json"),
          body,
        });
        if (fetchRes.status === 200) {
          return {
            status: fetchRes.status,
            json: await fetchRes.json(), // TODO: validate response format
          };
        } else {
          return {
            status: fetchRes.status as ValServerErrorStatus,
          };
        }
      }
    );
  }

  async postValidate(
    rawBody: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
    ValServerJsonResult<
      ApiPostValidationResponse | ApiPostValidationErrorResponse
    >
  > {
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
    return withAuth(
      this.options.valSecret,
      cookies,
      "postValidate",
      async (data) => {
        const remoteFSRes = await this.initializeRemoteFS(data);
        if (result.isErr(remoteFSRes)) {
          return remoteFSRes.error;
        }
        return this.hybridLocalServer.postValidate(rawBody, cookies);
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

// TODO: having a hybrid server is a bit of a hack
// We want to avoid executing logic on the content server, since that means we are bound to very specific versions of Val
// Maybe an abstract class that both Remote and Local servers can extend is better.
class HybridLocalValServer extends LocalValServer {
  constructor(
    readonly secret: string,
    readonly remoteFS: RemoteFS,
    readonly options: ProxyValServerOptions & {
      service: Service;
    },
    readonly callbacks: ValServerCallbacks
  ) {
    super(
      {
        ...options,
        cacheDir: undefined,
      },
      callbacks,
      {
        async readBuffer(fileName) {
          return remoteFS.readBuffer(fileName);
        },
      }
    );
  }

  override async getMetadata(
    filePath: string,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<
    | { status: 200; json: ImageMetadata | FileMetadata | undefined }
    | ValServerError
  > {
    if (!cookies) {
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
    return withAuth(this.secret, cookies, "getMetadata", async (data) => {
      const url = new URL(
        `/v1/metadata/${this.options.valName}${filePath}`,
        this.options.valContentUrl
      );
      const fetchRes = await fetch(url, {
        headers: getAuthHeaders(data.token),
      });
      if (fetchRes.status === 200) {
        return {
          status: 200,
          json: (await fetchRes.json()) as ImageMetadata | FileMetadata,
        };
      } else {
        return {
          status: fetchRes.status as ValServerErrorStatus,
          json: {
            message: "Failed to get metadata",
          },
        };
      }
    });
  }

  override async getModulesWithAppliedPatches(
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
    for (const [patchId, moduleId] of patches) {
      if (!modules[moduleId]) {
        modules[moduleId] = {
          patches: {
            applied: [],
          },
        };
      }
      if (commit) {
        // ignore commit for hybrid - the proxy will clean up after patches
      }
      // during validation we build this up again, wanted to following the same flows for validation and for commits
      modules[moduleId].patches.applied.push(patchId);
    }
    return modules;
  }

  override async readPatches(cookies: ValCookies<VAL_SESSION_COOKIE>): Promise<
    result.Result<
      {
        patches: [PatchId, ModuleId, Patch][];
        patchIdsByModuleId: Record<ModuleId, PatchId[]>;
        patchesById: Record<PatchId, Patch>;
      },
      ValServerError
    >
  > {
    const res = await getPatches(this.options, {}, cookies);
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
      return result.ok({
        patches,
        patchIdsByModuleId,
        patchesById,
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
}

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

function getPatches(
  options: ProxyValServerOptions,
  query: { id?: string[] },
  cookies: ValCookies<VAL_SESSION_COOKIE>
): Promise<ValServerJsonResult<ApiGetPatchResponse>> {
  return withAuth(
    options.valSecret,
    cookies,
    "getPatches",
    async ({ token }) => {
      const commit = options.git.commit;
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
        `/v1/patches/${options.valName}/heads/${options.git.branch}/~?${params}`,
        options.valContentUrl
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
