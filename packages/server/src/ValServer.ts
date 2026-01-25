/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ValModules,
  PatchId,
  ModuleFilePath,
  Json,
  SourcePath,
  ValidationError,
  SerializedSchema,
  ValConfig,
  Internal,
  FileSource,
  RemoteSource,
  Schema,
  SelectorSource,
} from "@valbuild/core";
import {
  Api,
  ParentRef,
  Patch,
  ServerOf,
  VAL_ENABLE_COOKIE_NAME,
  VAL_SESSION_COOKIE,
  VAL_STATE_COOKIE,
  ValCookies,
  ValServerError,
  ValServerErrorStatus,
} from "@valbuild/shared/internal";
import { decodeJwt, encodeJwt, getExpire } from "./jwt";
import { z } from "zod";
import { ValOpsFS } from "./ValOpsFS";
import {
  AuthorId,
  BaseSha,
  CommitSha,
  PatchSourceError,
  SchemaSha,
  SourcesSha,
} from "./ValOps";
import { fromError } from "zod-validation-error";
import { ValOpsHttp } from "./ValOpsHttp";
import { result } from "@valbuild/core/fp";
import { getSettings } from "./getSettings";
import {
  getPersonalAccessTokenPath,
  parsePersonalAccessTokenFile,
} from "./personalAccessTokens";
import path from "path";
import { hasRemoteFileSchema } from "./hasRemoteFileSchema";
import { ReifiedRender } from "@valbuild/core";
import { getErrorMessageFromUnknownJson } from "@valbuild/shared/internal";

export type ValServerOptions = {
  route: string;
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
  formatter?: (code: string, filePath: string) => string | Promise<string>;
  valBuildUrl?: string;
  valContentUrl: string;
  valSecret?: string;
  apiKey?: string;
  project?: string;
  config: ValConfig;
};

export type ValServerConfig = ValServerOptions &
  (
    | {
        mode: "fs";
        cwd: string;
        config: ValConfig;
      }
    | {
        mode: "http";
        apiKey: string;
        project: string;
        commit: string;
        branch: string;
        root?: string;
        config: ValConfig;
      }
  );

export type ValServer = ServerOf<Api>;
export const ValServer = (
  valModules: ValModules,
  options: ValServerConfig,
  callbacks: ValServerCallbacks,
): ServerOf<Api> => {
  let serverOps: ValOpsHttp | ValOpsFS;
  if (options.mode === "fs") {
    serverOps = new ValOpsFS(options.valContentUrl, options.cwd, valModules, {
      formatter: options.formatter,
      config: options.config,
    });
  } else if (options.mode === "http") {
    serverOps = new ValOpsHttp(
      options.valContentUrl,
      options.project,
      options.commit,
      options.branch,
      options.apiKey,
      valModules,
      {
        formatter: options.formatter,
        root: options.root,
        config: options.config,
      },
    );
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error("Invalid mode: " + (options as any)?.mode);
  }
  const getAuthorizeUrl = (publicValApiRe: string, token: string): string => {
    if (!options.project) {
      throw new Error("Project is not set");
    }
    if (!options.valBuildUrl) {
      throw new Error("Val build url is not set");
    }
    const url = new URL(`/authorize`, options.valBuildUrl);
    url.searchParams.set(
      "redirect_uri",
      encodeURIComponent(`${publicValApiRe}/callback`),
    );
    url.searchParams.set("state", token);
    return url.toString();
  };
  const commit =
    options.mode === "http" ? (options.commit as CommitSha) : undefined;

  const getAppErrorUrl = (error: string): string => {
    if (!options.project) {
      throw new Error("Project is not set");
    }
    if (!options.valBuildUrl) {
      throw new Error("Val build url is not set");
    }
    const url = new URL(`/authorize`, options.valBuildUrl);
    url.searchParams.set("error", encodeURIComponent(error));
    return url.toString();
  };

  const consumeCode = async (
    code: string,
  ): Promise<{
    sub: string;
    exp: number;
    org: string;
    project: string;
    token: string;
  } | null> => {
    if (!options.project) {
      throw new Error("Project is not set");
    }
    if (!options.valBuildUrl) {
      throw new Error("Val build url is not set");
    }
    const url = new URL(`/api/val/auth/token`, options.valBuildUrl);
    url.searchParams.set("code", encodeURIComponent(code));
    if (!options.apiKey) {
      return null;
    }
    return fetch(url, {
      method: "POST",
      headers: getAuthHeaders(options.apiKey, "application/json"), // NOTE: we use apiKey as auth on this endpoint (we do not have a token yet)
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
  };

  const getAuth = (
    cookies: Partial<Record<"val_session", string>>,
  ):
    | { error: string }
    | { id: string; error?: undefined }
    | { error: null; id: null } => {
    const cookie = cookies[VAL_SESSION_COOKIE];
    if (!options.valSecret) {
      if (serverOps instanceof ValOpsFS) {
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
      const decodedToken = decodeJwt(cookie, options.valSecret);
      if (!decodedToken) {
        if (serverOps instanceof ValOpsFS) {
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
        if (serverOps instanceof ValOpsFS) {
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
      if (serverOps instanceof ValOpsFS) {
        return {
          error: null,
          id: null,
        };
      }
      return {
        error: "Login required: cookie not found",
      };
    }
  };

  const authorize = async (redirectTo: string) => {
    const token = crypto.randomUUID();
    const redirectUrl = new URL(redirectTo);
    const appAuthorizeUrl = getAuthorizeUrl(
      `${redirectUrl.origin}${options.route}`,
      token,
    );
    await callbacks.onEnable(true);
    return {
      cookies: {
        [VAL_ENABLE_COOKIE_NAME]: ENABLE_COOKIE_VALUE,
        [VAL_STATE_COOKIE]: {
          value: createStateCookie({
            redirect_to: redirectTo,
            token,
          }),
          options: {
            httpOnly: true,
            sameSite: "lax",
            expires: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
          },
        },
      } as const,
      status: 302 as const,
      redirectTo: appAuthorizeUrl,
    };
  };

  let remoteFileAuth: { apiKey: string } | { pat: string } | null = null;
  const getRemoteFileAuth = async (): Promise<
    | {
        status: 200;
        json: { remoteFileAuth: { apiKey: string } | { pat: string } };
      }
    | {
        status: 400;
        json: {
          errorCode: "project-not-configured" | "pat-error";
          message: string;
        };
      }
  > => {
    if (remoteFileAuth) {
      return {
        status: 200,
        json: { remoteFileAuth },
      };
    }
    if (options.apiKey) {
      remoteFileAuth = {
        apiKey: options.apiKey,
      };
    } else if (serverOps instanceof ValOpsFS) {
      const projectRootDir = options.config.root || ".";
      if (!projectRootDir) {
        return {
          status: 400,
          json: {
            errorCode: "project-not-configured",
            message: "Root directory was empty",
          },
        };
      }
      const fs = await import("fs");
      const patPath = getPersonalAccessTokenPath(path.join(process.cwd()));
      let patFile;

      try {
        patFile = await fs.promises.readFile(patPath, "utf-8");
      } catch (err) {
        return {
          status: 400,
          json: {
            errorCode: "pat-error",
            message: "Could not read personal access token file",
          },
        };
      }
      const patRes = parsePersonalAccessTokenFile(patFile);
      if (patRes.success) {
        remoteFileAuth = {
          pat: patRes.data.pat,
        };
      } else {
        return {
          status: 400,
          json: {
            errorCode: "pat-error",
            message: "Could not parse personal access token file",
          },
        };
      }
    }
    if (!remoteFileAuth) {
      return {
        status: 400,
        json: {
          errorCode: "project-not-configured",
          message: "Remote file auth is not configured",
        },
      };
    }
    return {
      status: 200,
      json: { remoteFileAuth },
    };
  };

  return {
    "/draft/enable": {
      GET: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        const query = req.query;
        const redirectToRes = getRedirectUrl(
          query,
          options.valEnableRedirectUrl,
        );
        if (typeof redirectToRes !== "string") {
          return redirectToRes;
        }
        await callbacks.onEnable(true);
        return {
          status: 302,
          redirectTo: redirectToRes,
        };
      },
    },
    "/draft/disable": {
      GET: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        const query = req.query;
        const redirectToRes = getRedirectUrl(
          query,
          options.valDisableRedirectUrl,
        );
        if (typeof redirectToRes !== "string") {
          return redirectToRes;
        }
        await callbacks.onDisable(true);
        return {
          status: 302,
          redirectTo: redirectToRes,
        };
      },
    },
    "/draft/stat": {
      GET: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        return {
          status: 200,
          json: {
            draftMode: await callbacks.isEnabled(),
          },
        };
      },
    },
    "/enable": {
      GET: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        const query = req.query;
        const redirectToRes = getRedirectUrl(
          query,
          options.valEnableRedirectUrl,
        );
        if (auth.error) {
          if (typeof redirectToRes === "string") {
            return authorize(redirectToRes);
          }
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        if (typeof redirectToRes !== "string") {
          return redirectToRes;
        }
        await callbacks.onEnable(true);
        return {
          cookies: {
            [VAL_ENABLE_COOKIE_NAME]: ENABLE_COOKIE_VALUE,
          },
          status: 302,
          redirectTo: redirectToRes,
        };
      },
    },

    "/disable": {
      GET: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        const query = req.query;
        const redirectToRes = getRedirectUrl(
          query,
          options.valDisableRedirectUrl,
        );
        if (typeof redirectToRes !== "string") {
          return redirectToRes;
        }
        await callbacks.onDisable(true);
        return {
          cookies: {
            [VAL_ENABLE_COOKIE_NAME]: {
              value: "false",
            },
          },
          status: 302,
          redirectTo: redirectToRes,
        };
      },
    },
    //#region auth
    "/authorize": {
      GET: async (req) => {
        const query = req.query;
        if (typeof query.redirect_to !== "string") {
          return {
            status: 400,
            json: {
              message: "Missing redirect_to query param",
            },
          };
        }
        const redirectTo = query.redirect_to;
        return authorize(redirectTo);
      },
    },

    "/callback": {
      GET: async (req) => {
        const cookies = req.cookies;
        const query = req.query;
        if (!options.project) {
          return {
            status: 302,
            cookies: {
              [VAL_STATE_COOKIE]: {
                value: null,
              },
            },
            redirectTo: getAppErrorUrl("Project is not set"),
          };
        }
        if (!options.valSecret) {
          return {
            status: 302,
            cookies: {
              [VAL_STATE_COOKIE]: {
                value: null,
              },
            },
            redirectTo: getAppErrorUrl("Secret is not set"),
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
            redirectTo: getAppErrorUrl(
              `Authorization callback failed. Details: ${callbackReqError}`,
            ),
          };
        }

        const data = await consumeCode(callbackReqSuccess.code);
        if (data === null) {
          return {
            status: 302,
            cookies: {
              [VAL_STATE_COOKIE]: {
                value: null,
              },
            },
            redirectTo: getAppErrorUrl(
              "Failed to exchange code for token - check that API Key and project are correct",
            ),
          };
        }
        const exp = getExpire();
        const valSecret = options.valSecret;
        if (!valSecret) {
          return {
            status: 302,
            cookies: {
              [VAL_STATE_COOKIE]: {
                value: null,
              },
            },
            redirectTo: getAppErrorUrl(
              "Setup is not correct: secret is missing",
            ),
          };
        }
        const cookie = encodeJwt(
          {
            ...data,
            exp, // this is the client side exp
          },
          valSecret,
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
      },
    },

    "/session": {
      GET: async (req) => {
        const cookies = req.cookies;
        if (serverOps instanceof ValOpsFS) {
          return {
            status: 200,
            json: {
              mode: "local",
              enabled: await callbacks.isEnabled(),
            },
          };
        }
        if (!options.project) {
          return {
            status: 500,
            json: {
              message: "Project is not set",
            },
          };
        }
        if (!options.valSecret) {
          return {
            status: 500,
            json: {
              message: "Secret is not set",
            },
          };
        }
        return withAuth(options.valSecret, cookies, "session", async (data) => {
          if (!options.valBuildUrl) {
            return {
              status: 500,
              json: {
                message: "Val is not correctly setup. Build url is missing",
              },
            };
          }
          const url = new URL(
            `/api/val/${options.project}/auth/session`,
            options.valBuildUrl,
          );
          const fetchRes = await fetch(url, {
            headers: getAuthHeaders(data.token, "application/json"),
          });
          if (fetchRes.status === 200) {
            const json = z
              .object({
                member_role: z
                  .union([
                    z.literal("owner"),
                    z.literal("developer"),
                    z.literal("editor"),
                  ])
                  .optional(),
                id: z.string(),
                full_name: z.string().optional(),
                username: z.string().optional(),
                avatar_url: z.string().optional(),
              })
              .safeParse(await fetchRes.json());
            if (json.success) {
              return {
                status: fetchRes.status,
                json: {
                  mode: "proxy",
                  enabled: await callbacks.isEnabled(),
                  ...json.data,
                },
              };
            } else {
              const message = getErrorMessageFromUnknownJson(
                json,
                "Could not parse session response. Unexpected error (no error message). Status: " +
                  fetchRes.status,
              );
              return {
                status: 500,
                json: {
                  message: message,
                  ...json,
                },
              };
            }
          } else {
            const json = z
              .object({
                message: z.string(),
              })
              .safeParse(await fetchRes.json());
            const message = getErrorMessageFromUnknownJson(
              json,
              "Unknown error",
            );
            return {
              status: fetchRes.status as ValServerErrorStatus,
              json: {
                message: message,
                ...json,
              },
            };
          }
        });
      },
    },

    "/logout": {
      GET: async (req) => {
        const query = req.query;
        const redirectTo = query.redirect_to;
        if (redirectTo) {
          return {
            status: 302,
            redirectTo: redirectTo,
            cookies: {
              [VAL_SESSION_COOKIE]: {
                value: "empty",
                options: {
                  httpOnly: true,
                  sameSite: "strict",
                  path: "/",
                  secure: true,
                  expires: new Date(0),
                },
              },
              [VAL_STATE_COOKIE]: {
                value: "empty",
                options: {
                  httpOnly: true,
                  sameSite: "strict",
                  path: "/",
                  secure: true,
                  expires: new Date(0),
                },
              },
            },
          };
        }
        return {
          status: 200,
          cookies: {
            [VAL_SESSION_COOKIE]: {
              value: "empty",
              options: {
                httpOnly: true,
                sameSite: "strict",
                path: "/",
                secure: true,
                expires: new Date(0),
              },
            },
            [VAL_STATE_COOKIE]: {
              value: "empty",
              options: {
                httpOnly: true,
                sameSite: "strict",
                path: "/",
                secure: true,
                expires: new Date(0),
              },
            },
          },
        };
      },
    },

    "/remote/settings": {
      GET: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              errorCode: "unauthorized",
              message: auth.error,
            },
          };
        }
        if (serverOps instanceof ValOpsHttp && !("id" in auth)) {
          return {
            status: 401,
            json: {
              errorCode: "unauthorized",
              message: "Unauthorized",
            },
          };
        }

        if (!options.project) {
          return {
            status: 400,
            json: {
              errorCode: "project-not-configured",
              message:
                "Project is not configured. Update your val.config file with a valid remote project",
            },
          };
        }
        const remoteFileAuthRes = await getRemoteFileAuth();
        if (remoteFileAuthRes.status !== 200) {
          return remoteFileAuthRes;
        }
        const remoteFileAuth = remoteFileAuthRes.json.remoteFileAuth;

        const settingsRes = await getSettings(options.project, remoteFileAuth);
        if (!settingsRes.success) {
          console.warn(
            "Could not get remote files settings: " + settingsRes.message,
          );
          return {
            status: 400,
            json: {
              errorCode: "error-could-not-get-settings",
              message: `Could not get remote files settings: ${settingsRes.message}`,
            },
          };
        }

        return {
          status: 200,
          json: {
            publicProjectId: settingsRes.data.publicProjectId,
            remoteFileBuckets: settingsRes.data.remoteFileBuckets,
            coreVersion: Internal.VERSION.core || "unknown",
          },
        };
      },
    },

    //#region stat
    "/stat": {
      POST: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        if (serverOps instanceof ValOpsHttp && !("id" in auth)) {
          return {
            status: 401,
            json: {
              message: "Unauthorized",
            },
          };
        }
        const profileId = "id" in auth ? (auth.id as AuthorId) : undefined;
        const currentStat = await serverOps.getStat({
          ...req.body,
          profileId,
        } as {
          baseSha: BaseSha;
          sourcesSha: SourcesSha;
          schemaSha: SchemaSha;
          patches: PatchId[];
          profileId?: AuthorId;
        } | null);
        if (currentStat.type === "error" && currentStat.networkError) {
          return {
            status: 503,
            json: {
              message: "Network error",
            },
          };
        }
        if (currentStat.type === "error" && currentStat.unauthorized) {
          return {
            status: 401,
            json: {
              message: "Unauthorized",
            },
          };
        }
        if (currentStat.type === "error") {
          return {
            status: 500,
            json: currentStat.error,
          };
        }
        const mode =
          serverOps instanceof ValOpsFS
            ? "fs"
            : serverOps instanceof ValOpsHttp
              ? "http"
              : "unknown";
        if (mode === "unknown") {
          return {
            status: 500,
            json: {
              message:
                "Server mode is neither fs nor http - this is an internal Val bug",
            },
          };
        }
        return {
          status: 200,
          json: {
            ...currentStat,
            profileId: profileId ?? null,
            mode,
            config: options.config,
          },
        };
      },
    },
    "/upload/patches": {
      POST: async (req) => {
        if (serverOps instanceof ValOpsHttp) {
          return {
            status: 400,
            json: {
              message: "Do not use this endpoint in HTTP mode",
            },
          };
        }
        const pathParts = req.path.split("/");
        const patchId = pathParts[1] as PatchId;
        const isValidPatchId = patchId.length === 36;
        const isValidEndpoint =
          pathParts[0] === "" && isValidPatchId && pathParts[2] === "files";
        if (!isValidEndpoint) {
          return {
            status: 400,
            json: {
              message: "Invalid endpoint",
            },
          };
        }
        const { filePath, parentRef, type, data, metadata } = req.body;
        const saveRes = await serverOps.saveBase64EncodedBinaryFileFromPatch(
          filePath,
          parentRef,
          patchId,
          data,
          type,
          metadata,
        );
        if (saveRes.error) {
          return {
            status: 400,
            json: {
              message: saveRes.error.message,
            },
          };
        }

        return {
          status: 200,
          json: {
            filePath,
            patchId,
          },
        };
      },
    },
    "/direct-file-upload-settings": {
      POST: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        if (serverOps instanceof ValOpsFS) {
          // In FS mode we do not use the remote server at all and just return an url that points to this server
          // which has an endpoint that handles this
          // A bit hacky perhaps, but we want to have as similar semantics as possible in client code when it comes to FS / HTTP
          const host = `/api/val`;
          return {
            status: 200,
            json: {
              nonce: null,
              baseUrl: `${host}/upload`, // NOTE: this is the /upload/patches endpoint - the client will add /patches/:patchId/files to this and post to it
            },
          };
        }
        const httpOps = serverOps;
        const profileId =
          "id" in auth && auth.id ? (auth.id as AuthorId) : undefined;
        if (!profileId) {
          return {
            status: 401,
            json: {
              message: "Unauthorized",
            },
          };
        }
        const corsOrigin = "*"; // TODO: add cors origin
        const presignedAuthNonce = await httpOps.getPresignedAuthNonce(
          profileId,
          corsOrigin,
        );
        if (presignedAuthNonce.status === "error") {
          return {
            status: presignedAuthNonce.statusCode,
            json: presignedAuthNonce.error,
          };
        }
        return {
          status: 200,
          json: {
            nonce: presignedAuthNonce.data.nonce,
            baseUrl: presignedAuthNonce.data.baseUrl,
          },
        };
      },
    },
    //#region patches
    "/patches": {
      PUT: async (req): Promise<z.infer<Api["/patches"]["PUT"]["res"]>> => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        if (serverOps instanceof ValOpsHttp && !("id" in auth)) {
          return {
            status: 401,
            json: {
              message: "Unauthorized",
            },
          };
        }

        const patches = req.body.patches;
        let parentRef = req.body.parentRef;
        const authorId = "id" in auth ? (auth.id as AuthorId) : null;
        const newPatchIds: PatchId[] = [];
        for (const patch of patches) {
          const createPatchRes = await serverOps.createPatch(
            patch.path,
            patch.patch,
            patch.patchId,
            parentRef,
            authorId,
          );
          if (result.isErr(createPatchRes)) {
            if (createPatchRes.error.errorType === "patch-head-conflict") {
              return {
                status: 409,
                json: {
                  type: "patch-head-conflict",
                  message: "Patch id conflict",
                },
              };
            } else {
              return {
                status: 400,
                json: {
                  type: "patch-error",
                  message: createPatchRes.error.error.message,
                  errors: {
                    [patch.path]: [
                      {
                        error: {
                          message: createPatchRes.error.error.message,
                        },
                      },
                    ],
                  },
                },
              };
            }
          } else {
            parentRef = {
              type: "patch",
              patchId: createPatchRes.value.patchId,
            };
            newPatchIds.push(createPatchRes.value.patchId);
          }
        }
        return {
          status: 200,
          json: {
            newPatchIds,
            parentRef,
          },
        };
      },
      GET: async (req): Promise<z.infer<Api["/patches"]["GET"]["res"]>> => {
        // TODO: Fix type error patchId is string somewhere and PatchId somewhere else
        const query = req.query;
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        if (serverOps instanceof ValOpsHttp && !("id" in auth)) {
          return {
            status: 401,
            json: {
              message: "Unauthorized",
            },
          };
        }
        const excludePatchOps = query.exclude_patch_ops === true;
        const fetchedPatchesRes = await serverOps.fetchPatches({
          patchIds: query.patch_id as PatchId[] | undefined,
          excludePatchOps: excludePatchOps,
        });
        if (fetchedPatchesRes.error) {
          // Error is singular
          console.error("Val: Failed to get patches", fetchedPatchesRes.error);
          return {
            status: 500,
            json: {
              message: fetchedPatchesRes.error.message,
              error: fetchedPatchesRes.error,
            },
          };
        }
        if (
          fetchedPatchesRes.errors &&
          Object.keys(fetchedPatchesRes.errors).length > 0
        ) {
          // Errors is plural. Different property than above.
          console.error("Val: Failed to get patches", fetchedPatchesRes.errors);
          return {
            status: 500,
            json: {
              message: "Failed to get patches",
              patchErrors: fetchedPatchesRes.errors,
            },
          };
        }
        const patches: {
          patchId: PatchId;
          path: ModuleFilePath;
          patch: Patch;
          parentRef: ParentRef;
          createdAt: string;
          authorId: AuthorId | null;
          appliedAt: { commitSha: CommitSha } | null;
        }[] = [];
        for (const [patchIdS, patchData] of Object.entries(
          fetchedPatchesRes.patches,
        )) {
          const patchId = patchIdS as PatchId;
          patches.push({
            patchId,
            ...patchData,
          });
        }
        // TODO: we should sort by parentRef instead:
        patches.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return {
          status: 200,
          json: {
            patches: patches,
            baseSha: await serverOps.getBaseSha(),
          },
        };
      },
      DELETE: async (req) => {
        const query = req.query;
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        if (serverOps instanceof ValOpsHttp && !("id" in auth)) {
          return {
            status: 401,
            json: {
              message: "Unauthorized",
            },
          };
        }
        const ids = query.id;
        const deleteRes = await serverOps.deletePatches(ids);
        if (deleteRes.errors && Object.keys(deleteRes.errors).length > 0) {
          console.error("Val: Failed to delete patches", deleteRes.errors);
          return {
            status: 500,
            json: {
              message: "Failed to delete patches",
              errors: Object.entries(deleteRes.errors).map(([id, error]) => ({
                patchId: id as PatchId,
                ...error,
              })),
            },
          };
        }
        return {
          status: 200,
          json: ids,
        };
      },
    },

    //#region schema
    "/schema": {
      GET: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        if (serverOps instanceof ValOpsHttp && !("id" in auth)) {
          return {
            status: 401,
            json: {
              message: "Unauthorized",
            },
          };
        }
        const moduleErrors = await serverOps.getModuleErrors();
        if (moduleErrors?.length > 0) {
          console.error("Val: Module errors", moduleErrors);
          return {
            status: 500,
            json: {
              message: `Got errors while fetching modules: ${moduleErrors
                .filter((error) => error)
                .map((error) => error.message)
                .join(", ")}`,
              details: moduleErrors,
            },
          };
        }
        const schemaSha = await serverOps.getSchemaSha();
        const schemas = await serverOps.getSchemas();
        const serializedSchemas: Record<ModuleFilePath, SerializedSchema> = {};
        try {
          for (const [moduleFilePathS, schema] of Object.entries(schemas)) {
            const moduleFilePath = moduleFilePathS as ModuleFilePath;
            serializedSchemas[moduleFilePath] = schema["executeSerialize"]();
          }
        } catch (e) {
          console.error("Val: Failed to serialize schemas", e);
          return {
            status: 500,
            json: {
              message: "Failed to serialize schemas",
              details: [
                { message: e instanceof Error ? e.message : JSON.stringify(e) },
              ],
            },
          };
        }

        return {
          status: 200,
          json: {
            schemaSha,
            schemas: serializedSchemas,
          },
        };
      },
    },

    // #region sources
    "/sources/~": {
      PUT: async (req) => {
        const query = req.query;
        const cookies = req.cookies;
        // TODO: filter results by moduleFilePath
        // const moduleFilePath = req.path || "";
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        if (serverOps instanceof ValOpsHttp && !("id" in auth)) {
          return {
            status: 401,
            json: {
              message: "Unauthorized",
            },
          };
        }
        const sourcesSha = await serverOps.getSourcesSha();
        const moduleErrors = await serverOps.getModuleErrors();
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
        const patchOps = await serverOps.fetchPatches({
          patchIds: undefined,
          excludePatchOps: false,
        });
        // We check authorization here, because it is the first call to the backend
        if (patchOps.error && patchOps.unauthorized) {
          return {
            status: 401,
            json: {
              message: "Unauthorized",
            },
          };
        }
        const patchAnalysis = serverOps.analyzePatches(patchOps.patches);
        const schemasRes = await serverOps.getSchemas();
        let sourcesRes = await serverOps.getSources();
        const onlyPatchedTreeModules = await serverOps.getSources({
          ...patchAnalysis,
          ...patchOps,
        });
        sourcesRes = {
          sources: {
            ...sourcesRes.sources,
            ...(onlyPatchedTreeModules.sources || {}),
          },
          errors: {
            ...sourcesRes.errors,
            ...(onlyPatchedTreeModules.errors || {}),
          },
        };
        const renderRes = await serverOps.getRenders(
          schemasRes,
          sourcesRes.sources,
        );

        let sourcesValidation: {
          errors: Record<
            ModuleFilePath,
            {
              invalidSource?: { message: string };
              validations: Record<SourcePath, ValidationError[]>;
            }
          >;
          files: Record<SourcePath, FileSource>;
          remoteFiles: Record<SourcePath, RemoteSource>;
        } = {
          errors: {},
          files: {},
          remoteFiles: {},
        };
        if (query.validate_sources || query.validate_binary_files) {
          const schemas = await serverOps.getSchemas();
          sourcesValidation = await serverOps.validateSources(
            schemas,
            sourcesRes.sources,
          );

          // TODO: send binary files validation errors
          if (query.validate_binary_files) {
            const binaryFilesValidation = await serverOps.validateFiles(
              schemas,
              sourcesRes.sources,
              sourcesValidation.files,
            );
            // TODO : actually do something with this
            await serverOps.validateRemoteFiles(
              schemas,
              sourcesRes.sources,
              sourcesValidation.remoteFiles,
            );
          }
        }

        const schemaSha = await serverOps.getSchemaSha();
        const modules: Record<
          ModuleFilePath,
          {
            source: Json;
            render: ReifiedRender | null;
            patches?: {
              applied: PatchId[];
              skipped?: PatchId[];
              errors?: Record<PatchId, { message: string }>;
            };
            validationErrors?: Record<SourcePath, ValidationError[]>;
          }
        > = {};
        for (const [moduleFilePathS, module] of Object.entries(
          sourcesRes.sources,
        )) {
          const moduleFilePath = moduleFilePathS as ModuleFilePath;
          // TODO: currently sourcesRes contains ALL MODULES.
          // We should only evaluate exactly what we need
          if (!req.path || moduleFilePath.startsWith(req.path)) {
            const skippedPatches: PatchId[] = [];
            const patchErrors: Record<PatchId, { message: string }> = {};
            const appliedPatches: PatchId[] =
              patchAnalysis.patchesByModule[moduleFilePath]?.map(
                (p) => p.patchId,
              ) || [];
            for (const { patchId, skipped, error } of sourcesRes.errors?.[
              moduleFilePath
            ] || []) {
              if (skipped) {
                skippedPatches.push(patchId);
              } else if (error) {
                patchErrors[patchId] = { message: error.message };
              } else {
                // unsure what makes sense here
                appliedPatches.push(patchId);
              }
            }
            modules[moduleFilePath] = {
              source: module,
              render: renderRes.renders[moduleFilePath] || null,
              patches:
                appliedPatches.length > 0 ||
                skippedPatches.length > 0 ||
                Object.keys(patchErrors).length > 0
                  ? {
                      applied: appliedPatches,
                      skipped:
                        skippedPatches.length > 0 ? skippedPatches : undefined,
                      errors:
                        Object.keys(patchErrors).length > 0
                          ? patchErrors
                          : undefined,
                    }
                  : undefined,
              validationErrors:
                sourcesValidation.errors[moduleFilePath]?.validations,
            };
          }
        }

        const res: z.infer<Api["/sources/~"]["PUT"]["res"]> = {
          status: 200,
          json: {
            schemaSha,
            sourcesSha,
            modules,
          },
        };
        return res;
      },
    },

    "/profiles": {
      GET: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }
        const profiles = await serverOps.getProfiles();
        return {
          status: 200,
          json: {
            profiles,
          },
        };
      },
    },
    "/commit-summary": {
      GET: async (req) => {
        const cookies = req.cookies;
        const auth = getAuth(cookies);
        if (auth.error) {
          return {
            status: 401,
            json: {
              message: auth.error,
            },
          };
        }

        const query = req.query;
        const patchIds = query.patch_id as PatchId[];
        const patches = await serverOps.fetchPatches({
          patchIds,
          excludePatchOps: false,
        });
        const analysis = serverOps.analyzePatches(
          patches.patches,
          patches.commits,
          commit,
        );
        const preparedCommit = await serverOps.prepare({
          ...analysis,
          ...patches,
        });
        const res = await serverOps.getCommitSummary(preparedCommit);
        if (res.error) {
          console.error("Failed to summarize", res.error);
          return {
            status: 400,
            json: {
              message: res.error.message,
            },
          };
        }
        return {
          status: 200,
          json: {
            baseSha: await serverOps.getBaseSha(),
            patchIds,
            commitSummary: res.commitSummary,
          },
        };
      },
    },
    "/save": {
      POST: async (req) => {
        const cookies = req.cookies;
        const body = req.body;
        const auth = getAuth(cookies);
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
              (id): id is PatchId => true, // TODO:
            ),
          ),
        });
        const bodyRes = PostSaveBody.safeParse(body);
        if (!bodyRes.success) {
          return {
            status: 400,
            json: {
              message: "Invalid body: " + fromError(bodyRes.error).toString(),
              details: bodyRes.error.issues,
            },
          };
        }
        const { patchIds } = bodyRes.data;
        const patches = await serverOps.fetchPatches({
          patchIds,
          excludePatchOps: false,
        });
        const analysis = serverOps.analyzePatches(
          patches.patches,
          patches.commits,
          commit,
        );
        const preparedCommit = await serverOps.prepare({
          ...analysis,
          ...patches,
        });
        if (preparedCommit.hasErrors) {
          console.error(
            "Failed to create commit",
            JSON.stringify(
              {
                sourceFilePatchErrors: preparedCommit.sourceFilePatchErrors,
                binaryFilePatchErrors: preparedCommit.binaryFilePatchErrors,
              },
              null,
              2,
            ),
          );
          return {
            status: 400,
            json: {
              message: "Failed to create commit",
              details: {
                sourceFilePatchErrors: Object.fromEntries(
                  Object.entries(preparedCommit.sourceFilePatchErrors).map(
                    ([key, errors]) => [
                      key,
                      errors.map((e) => ({
                        message: formatPatchSourceError(e),
                      })),
                    ],
                  ),
                ),
                binaryFilePatchErrors: preparedCommit.binaryFilePatchErrors,
              },
            },
          };
        }
        if (serverOps instanceof ValOpsFS) {
          const isRemoteRequired = getIsRemoteRequired(
            await serverOps.getSchemas(),
          );
          let mode: "skip-remote" | "upload-remote";
          let remoteFileAuthRes:
            | undefined
            | Awaited<ReturnType<typeof getRemoteFileAuth>>;
          if (isRemoteRequired) {
            mode = "upload-remote";
            remoteFileAuthRes = await getRemoteFileAuth();
          } else {
            mode = "skip-remote";
          }
          if (remoteFileAuthRes && remoteFileAuthRes.status !== 200) {
            return remoteFileAuthRes;
          }
          const remoteFileAuth = remoteFileAuthRes?.json?.remoteFileAuth;
          const saveRes = await serverOps.saveOrUploadFiles(
            preparedCommit,
            mode,
            remoteFileAuth,
          );
          if (Object.keys(saveRes.errors).length > 0) {
            console.error("Val: Failed to save files", saveRes.errors);
            return {
              status: 400,
              json: {
                message: "Failed to save files",
                details: Object.entries(saveRes.errors).map(([key, error]) => {
                  return {
                    message: `Got error: ${error} in ${key}`,
                  };
                }),
              },
            };
          }
          const deleteRes = await serverOps.deleteAllPatches();
          if (deleteRes.error) {
            console.error(
              `Val got an error while cleaning up patches after publish: ${deleteRes.error.message}`,
            );
          }
          return {
            status: 200,
            json: {} as Record<string, never>, // TODO:
          };
        } else if (serverOps instanceof ValOpsHttp) {
          if (auth.error === undefined && auth.id) {
            const message =
              body.message ||
              "Val CMS update (" +
                Object.keys(analysis.patchesByModule).length +
                " files changed)";
            const commitRes = await serverOps.commit(
              preparedCommit,
              message,
              auth.id as AuthorId,
              options.config.files?.directory || "/public/val",
            );
            if (commitRes.error) {
              console.error("Failed to commit", commitRes.error);
              if (
                "isNotFastForward" in commitRes &&
                commitRes.isNotFastForward
              ) {
                return {
                  status: 409,
                  json: {
                    isNotFastForward: true,
                    message:
                      "Cannot commit: this is not the latest version of this branch",
                  },
                };
              }
              return {
                status: 400,
                json: {
                  message: commitRes.error.message,
                  details: [],
                },
              };
            }
            // TODO: serverOps.markApplied(patchIds);
            return {
              status: 200,
              json: {} as Record<string, never>, // TODO:
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
      },
    },

    //#region files
    "/files": {
      GET: async (req) => {
        const query = req.query;
        const filePath = req.path;
        // NOTE: no auth here since you would need the patch_id to get something that is not published.
        // For everything that is published, well they are already public so no auth required there...
        // We could imagine adding auth just to be a 200% certain,
        // However that won't work since images are requested by the nextjs backend as a part of image optimization (again: as an example) which is a backend-to-backend op (no cookies, ...).
        // So: 1) patch ids are not possible to guess (but possible to brute force)
        //     2) the process of shimming a patch into the frontend would be quite challenging (so just trying out this attack would require a lot of effort)
        //     3) the benefit an attacker would get is an image that is not yet published (i.e. most cases: not very interesting)
        // Thus: attack surface + ease of attack + benefit = low probability of attack
        // If we couldn't argue that patch ids are secret enough, then this would be a problem.
        let cacheControl: string | undefined;
        let fileBuffer;
        let mimeType: string | undefined;
        const remote = query.remote === "true";
        if (query.patch_id) {
          fileBuffer = await serverOps.getBase64EncodedBinaryFileFromPatch(
            filePath,
            query.patch_id as PatchId,
            remote,
          );
          mimeType = Internal.filenameToMimeType(filePath);
          // TODO: reenable this:
          // cacheControl = "public, max-age=20000, immutable";
        } else {
          if (serverOps instanceof ValOpsHttp && remote) {
            console.error(
              `Remote file: ${filePath} requested without patch id. This is most likely a bug in Val.`,
            );
          }
          fileBuffer = await serverOps.getBinaryFile(filePath);
        }

        if (fileBuffer) {
          return {
            status: 200,
            headers: {
              // TODO: we could use ETag and return 304 instead
              "Content-Type": mimeType || "application/octet-stream",
              "Cache-Control":
                cacheControl || "public, max-age=0, must-revalidate",
            },
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
      },
    },
  };
};

function formatPatchSourceError(error: PatchSourceError): string {
  if ("message" in error) {
    return error.message;
  } else if (Array.isArray(error)) {
    return error.map(formatPatchSourceError).join("\n");
  } else {
    const _exhaustiveCheck: never = error;
    return "Unknown patch source error: " + JSON.stringify(_exhaustiveCheck);
  }
}

export type ValServerCallbacks = {
  isEnabled: () => Promise<boolean>;
  onEnable: (success: boolean) => Promise<void>;
  onDisable: (success: boolean) => Promise<void>;
};

function verifyCallbackReq(
  stateCookie: string | undefined,
  queryParams: Record<string, unknown>,
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
    const json = z
      .object({
        message: z.string(),
      })
      .safeParse(await fetchRes.json());
    if (json.success) {
      return {
        status: fetchRes.status as ValServerErrorStatus,
        json: json.data,
      };
    } else {
      const message = getErrorMessageFromUnknownJson(json, "Unknown error");
      return {
        status: fetchRes.status as ValServerErrorStatus,
        json: {
          message: message,
          ...json,
        },
      };
    }
  }
  console.error(
    "Unexpected failure (did not get a json) - Val down?",
    fetchRes.status,
    await fetchRes.text(),
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
  handler: (data: IntegratedServerJwtPayload) => Promise<T>,
): Promise<ReturnType<ServerOf<Api>["/session"]["GET"]> | T> {
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
          details: fromError(verification.error).toString(),
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
  type?: "application/json" | "application/json-patch+json",
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
  overrideHost: string | undefined,
): string | { status: 400; json: { message: string } } {
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

function getIsRemoteRequired(
  schemas: Record<ModuleFilePath, Schema<SelectorSource>>,
): boolean {
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath]["executeSerialize"]();
    const isRemoteRequired = hasRemoteFileSchema(schema);
    if (isRemoteRequired) {
      return true;
    }
  }
  return false;
}
