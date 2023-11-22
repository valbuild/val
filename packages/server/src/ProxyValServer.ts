import express from "express";
import crypto from "crypto";
import { decodeJwt, encodeJwt, getExpire } from "./jwt";
import { PatchJSON } from "./patch/validation";
import {
  ValCookies,
  ValServer,
  ValServerError,
  ValServerErrorStatus,
  ValServerRedirectResult,
  ValServerResult,
} from "./ValServer";
import { z } from "zod";
import { Internal } from "@valbuild/core";
import { Readable } from "stream";

const VAL_SESSION_COOKIE = Internal.VAL_SESSION_COOKIE;
const VAL_STATE_COOKIE = Internal.VAL_STATE_COOKIE;
const VAL_ENABLED_COOKIE = Internal.VAL_ENABLE_COOKIE_NAME;

export type ProxyValServerOptions = {
  apiKey: string;
  route: string;
  valSecret: string;
  valBuildUrl: string;
  valContentUrl: string;
  gitCommit: string;
  gitBranch: string;
  valName: string;
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
};

class BrowserReadableStreamWrapper extends Readable {
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(readableStream: ReadableStream<Uint8Array>) {
    super();
    this.reader = readableStream.getReader();
  }

  _read() {
    this.reader
      .read()
      .then(({ done, value }) => {
        if (done) {
          this.push(null); // No more data to read
        } else {
          this.push(Buffer.from(value));
        }
      })
      .catch((error) => {
        this.emit("error", error);
      });
  }
}

export class ProxyValServer implements ValServer {
  constructor(readonly options: ProxyValServerOptions) {}

  async getFiles(
    treePath: string,
    query: { sha256?: string },
    cookies: ValCookies
  ): Promise<ValServerResult<ReadableStream<Uint8Array>>> {
    return this.withAuth(cookies, "getFiles", async (data) => {
      const url = new URL(
        `/v1/files/${this.options.valName}/${treePath}`,
        this.options.valContentUrl
      );
      if (typeof query.sha256 === "string") {
        url.searchParams.append("sha256", query.sha256 as string);
      } else {
        console.warn("Missing sha256 query param");
      }
      const fetchRes = await fetch(url, {
        headers: this.getAuthHeaders(data.token),
      });
      if (fetchRes.ok) {
        if (fetchRes.body) {
          return {
            status: fetchRes.status as 200 | 201,
            headers: {
              "Content-Type": fetchRes.headers.get("Content-Type") || "",
              "Content-Length": fetchRes.headers.get("Content-Length") || "0",
            },
            body: fetchRes.body,
          };
        } else {
          return {
            status: 500,
            body: {
              message: "No body in response",
            },
          };
        }
      } else {
        return {
          status: fetchRes.status as ValServerErrorStatus,
          body: {
            message: "Failed to get files",
          },
        };
      }
    });
  }

  async authorize(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<"val_session">> {
    if (typeof query.redirect_to !== "string") {
      return {
        status: 404,
        body: {
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
        val_session: {
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
  }): Promise<ValServerRedirectResult> {
    if (typeof query.redirect_to !== "string") {
      return {
        status: 404,
        body: {
          message: "Missing redirect_to query param",
        },
      };
    }

    let redirectUrlToUse = query.redirect_to;
    const redirectUrl = this.options.valEnableRedirectUrl;
    if (redirectUrl) {
      redirectUrlToUse =
        redirectUrl + "?redirect_to=" + encodeURIComponent(redirectUrlToUse);
    }
    return {
      cookies: {
        [VAL_ENABLED_COOKIE]: {
          value: "true",
          options: {
            httpOnly: false,
            sameSite: "lax",
          },
        },
      },
      status: 302,
      redirectTo: redirectUrlToUse,
    };
  }

  async disable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult> {
    if (typeof query.redirect_to !== "string") {
      return {
        status: 404,
        body: {
          message: "Missing redirect_to query param",
        },
      };
    }
    let redirectUrlToUse = query.redirect_to;
    const redirectUrl = this.options.valEnableRedirectUrl;
    if (redirectUrl) {
      redirectUrlToUse =
        redirectUrl + "?redirect_to=" + encodeURIComponent(redirectUrlToUse);
    }
    return {
      cookies: {
        [VAL_ENABLED_COOKIE]: {
          value: null,
        },
      },
      status: 302,
      redirectTo: redirectUrlToUse,
    };
  }

  async callback(
    query: { code?: string; state?: string },
    cookies: ValCookies<"val_state">
  ): Promise<ValServerRedirectResult<"val_state" | "val_session">> {
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
        [VAL_SESSION_COOKIE]: {
          value: cookie,
          options: {
            httpOnly: true,
            sameSite: "strict",
            secure: true,
            expires: new Date(exp * 1000), // NOTE: this is not used for authorization, only for authentication
          },
        },
      },
      redirectTo: callbackReqSuccess.redirect_uri || "/",
    };
  }

  async logout(): Promise<ValServerResult> {
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

  async withAuth<T>(
    cookies: ValCookies,
    errorMessageType: string,
    handler: (data: IntegratedServerJwtPayload) => Promise<T>
  ): Promise<T | ValServerError> {
    const cookie = cookies[VAL_SESSION_COOKIE];
    if (typeof cookie === "string") {
      const verification = IntegratedServerJwtPayload.safeParse(
        decodeJwt(cookie, this.options.valSecret)
      );
      if (!verification.success) {
        return {
          status: 401,
          body: {
            message: "Invalid token",
          },
        };
      }
      return handler(verification.data).catch((err) => {
        console.error(`Failed while processing: ${errorMessageType}`, err);
        return {
          status: 500,
          body: {
            message: err.message,
          },
        };
      });
    } else {
      return {
        status: 401,
        body: {
          message: "No token",
        },
      };
    }
  }

  async session(cookies: ValCookies): Promise<
    ValServerResult<{
      mode: "proxy" | "local";
      member_role: "owner" | "developer" | "editor";
    }>
  > {
    return this.withAuth(cookies, "session", async (data) => {
      const url = new URL(
        `/api/val/${this.options.valName}/auth/session`,
        this.options.valBuildUrl
      );
      const fetchRes = await fetch(url, {
        headers: this.getAuthHeaders(data.token, "application/json"),
      });
      if (fetchRes.ok) {
        return {
          status: fetchRes.status as 200 | 201,
          body: { mode: "proxy", ...(await fetchRes.json()) },
        };
      } else {
        return {
          status: fetchRes.status as ValServerErrorStatus,
          body: {
            message: "Failed to get session",
          },
        };
      }
    });
  }

  async getTree(
    treePath: string,
    query: { patch?: string; schema?: string; source?: string },
    cookies: ValCookies
  ): Promise<ValServerResult> {
    return this.withAuth(cookies, "getTree", async (data) => {
      const { patch, schema, source } = query;
      const commit = this.options.gitCommit;
      if (!commit) {
        return {
          status: 401,
          body: {
            message:
              "Could not detect the git commit. Check if env is missing VAL_GIT_COMMIT.",
          },
        };
      }
      const params = new URLSearchParams({
        patch: (patch === "true").toString(),
        schema: (schema === "true").toString(),
        source: (source === "true").toString(),
        commit,
      });
      const url = new URL(
        `/v1/tree/${this.options.valName}/heads/${this.options.gitBranch}/${req.params["0"]}/?${params}`,
        this.options.valContentUrl
      );
      const json = await fetch(url, {
        headers: this.getAuthHeaders(data.token, "application/json"),
      })
        .then((res) => res.json())
        .catch((err) => {
          console.error(err);
          throw err;
        });
      res.send(json);
    });
  }
  async getPatches(
    treePath: string,
    query: { id?: string[] },
    cookies: ValCookies
  ): Promise<ValServerResult> {
    const patchIds = query.id || [];
    const params =
      patchIds.length > 0
        ? `?${patchIds.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`
        : "";
    return this.withAuth(cookies, "getPatches", async ({ token }) => {
      const url = new URL(
        `/v1/patches/${this.options.valName}/heads/${this.options.gitBranch}/${treePath}${params}`,
        this.options.valContentUrl
      );
      // Proxy patch to val.build
      const fetchRes = await fetch(url, {
        method: "GET",
        headers: this.getAuthHeaders(token, "application/json"),
      });
      if (fetchRes.ok) {
        const json = await fetchRes.json();
        return {
          status: fetchRes.status as 200,
          body: json,
        };
      } else {
        return {
          status: fetchRes.status as ValServerErrorStatus,
          body: {
            message: "Failed to get patches",
          },
        };
      }
    });
  }

  async postPatches(
    treePath: string,
    cookies: ValCookies
  ): Promise<ValServerResult<ApiPostPatchResponse>> {
    const commit = this.options.gitCommit;
    if (!commit) {
      return {
        status: 401,
        body: {
          message:
            "Could not detect the git commit. Check if env is missing VAL_GIT_COMMIT.",
        },
      };
    }
    const params = new URLSearchParams({
      commit,
    });
    await this.withAuth(req, res, async ({ token }) => {
      // First validate that the body has the right structure
      const patchJSON = z.record(PatchJSON).safeParse(req.body);
      if (!patchJSON.success) {
        res.status(401).json(patchJSON.error.issues);
        return;
      }
      // Then parse/validate
      // TODO:
      const patch = patchJSON.data;
      // const patch = parsePatch(patchJSON.data);
      // if (result.isErr(patch)) {
      //   res.status(401).json(patch.error);
      //   return;
      // }
      const url = new URL(
        `/v1/patches/${this.options.valName}/heads/${this.options.gitBranch}/${treePath}/?${params}`,
        this.options.valContentUrl
      );
      // Proxy patch to val.build
      const fetchRes = await fetch(url, {
        method: "POST",
        headers: this.getAuthHeaders(token, "application/json"),
        body: JSON.stringify(patch),
      });
      if (fetchRes.ok) {
        res.status(fetchRes.status).json(await fetchRes.json());
      } else {
        res.sendStatus(fetchRes.status);
      }
    }).catch((e) => {
      res.status(500).send({ error: { message: e?.message, status: 500 } });
    });
  }

  async commit(): Promise<ValServerResult> {
    return this.withAuth(req, res, async ({ token }) => {
      const url = new URL(
        `/api/val/commit/${encodeURIComponent(this.options.gitBranch)}`,
        this.options.valBuildUrl
      );
      const fetchRes = await fetch(url, {
        method: "POST",
        headers: this.getAuthHeaders(token),
      });
      if (fetchRes.ok) {
        res.status(fetchRes.status).json(await fetchRes.json());
      } else {
        res.sendStatus(fetchRes.status);
      }
    });
  }

  private getAuthHeaders(
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
      headers: this.getAuthHeaders(this.options.apiKey, "application/json"), // NOTE: we use apiKey as auth on this endpoint (we do not have a token yet)
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
