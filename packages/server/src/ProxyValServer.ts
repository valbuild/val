import express from "express";
import crypto from "crypto";
import { decodeJwt, encodeJwt, getExpire, JwtPayload } from "./jwt";
import { parsePatch, PatchJSON } from "./patch/patch";
import * as result from "./fp/result";
import { getFileIdFromParams } from "./expressHelpers";
import { ValServer } from "./ValServer";
import { z } from "zod";

const VAL_SESSION_COOKIE = "val_session";
const VAL_STATE_COOKIE = "val_state";

export type ProxyValServerOptions = {
  apiKey: string;
  sessionKey: string;
  publicValApiRoute: string;
  valBuildUrl: string;
};

const fakeGitRef = "main"; // TODO: get this from env vars
export class ProxyValServer implements ValServer {
  constructor(readonly options: ProxyValServerOptions) {}

  async authorize(req: express.Request, res: express.Response): Promise<void> {
    const { redirect_to } = req.query;
    if (typeof redirect_to !== "string") {
      res.redirect(
        this.getAppErrorUrl("Login failed: missing redirect_to param")
      );
      return;
    }
    const token = crypto.randomUUID();
    const appAuthorizeUrl = this.getAuthorizeUrl(token);
    res
      .cookie(VAL_STATE_COOKIE, createStateCookie({ redirect_to, token }), {
        httpOnly: true,
        sameSite: "strict",
        expires: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
      })
      .redirect(appAuthorizeUrl);
  }

  async callback(req: express.Request, res: express.Response): Promise<void> {
    const { success: callbackReqSuccess, error: callbackReqError } =
      verifyCallbackReq(req.cookies[VAL_STATE_COOKIE], req.query);
    res.clearCookie(VAL_STATE_COOKIE); // we don't need this anymore

    if (callbackReqError !== null) {
      res.redirect(this.getAppErrorUrl("Failed to verify callback request"));
      return;
    }

    const data = await this.consumeCode(callbackReqSuccess.code);
    if (data === null) {
      res.redirect(this.getAppErrorUrl("Failed to exchange code for user"));
      return;
    }
    const exp = getExpire();
    const cookie = encodeJwt(
      {
        ...data,
        exp, // this is the client side exp
      },
      this.options.sessionKey
    );

    res
      .cookie(VAL_SESSION_COOKIE, cookie, {
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        expires: new Date(exp * 1000), // NOTE: this is not used for authorization, only for authentication
      })
      .redirect(callbackReqSuccess.redirect_uri || "/");
  }

  async logout(_req: express.Request, res: express.Response): Promise<void> {
    res
      .clearCookie(VAL_SESSION_COOKIE)
      .clearCookie(VAL_STATE_COOKIE)
      .sendStatus(200);
  }

  async withAuth<T>(
    req: express.Request,
    res: express.Response,
    handler: (data: JwtPayload) => Promise<T>
  ): Promise<T | undefined> {
    const cookie = req.cookies[VAL_SESSION_COOKIE];
    if (typeof cookie === "string") {
      const data = decodeJwt(cookie, this.options.sessionKey);
      if (data === null) {
        res.sendStatus(401);
        return;
      }
      return handler(data);
    } else {
      res.sendStatus(401);
    }
  }

  async session(req: express.Request, res: express.Response): Promise<void> {
    return this.withAuth(req, res, async (data) => {
      const url = new URL(
        "/api/val/auth/user/session",
        this.options.valBuildUrl
      );
      const fetchRes = await fetch(url, {
        headers: this.getAuthHeaders("application/json", data.token),
      });
      if (fetchRes.ok) {
        res
          .status(fetchRes.status)
          .json({ mode: "proxy", ...(await fetchRes.json()) });
      } else {
        res.sendStatus(fetchRes.status);
      }
    });
  }

  async getIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    return this.withAuth(req, res, async ({ token }) => {
      const gitRef = fakeGitRef;
      const id = getFileIdFromParams(req.params);
      const url = new URL(
        `/api/val/modules/${encodeURIComponent(gitRef)}/${id}`,
        this.options.valBuildUrl
      );
      const fetchRes = await fetch(url, {
        headers: this.getAuthHeaders("application/json-patch+json", token),
      });
      if (fetchRes.ok) {
        res.status(fetchRes.status).json(await fetchRes.json());
      } else {
        res.sendStatus(fetchRes.status);
      }
    });
  }

  async patchIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    this.withAuth(req, res, async ({ token }) => {
      // First validate that the body has the right structure
      const patchJSON = PatchJSON.safeParse(req.body);
      if (!patchJSON.success) {
        res.status(401).json(patchJSON.error.issues);
        return;
      }
      // Then parse/validate
      const patch = parsePatch(patchJSON.data);
      if (result.isErr(patch)) {
        res.status(401).json(patch.error);
        return;
      }
      const id = getFileIdFromParams(req.params);
      const gitRef = fakeGitRef;
      const url = new URL(
        `/api/val/modules/${encodeURIComponent(gitRef)}/${id}}`,
        this.options.valBuildUrl
      );
      // Proxy patch to val.build
      const fetchRes = await fetch(url, {
        method: "PATCH",
        headers: this.getAuthHeaders("application/json-patch+json", token),
        body: JSON.stringify(patch),
      });
      if (fetchRes.ok) {
        res.status(fetchRes.status).json(await fetchRes.json());
      } else {
        res.sendStatus(fetchRes.status);
      }
    });
  }

  private getAuthHeaders(
    type: "application/json" | "application/json-patch+json",
    token: string
  ) {
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
    const url = new URL("/api/val/auth/user/token", this.options.valBuildUrl);
    url.searchParams.set("code", encodeURIComponent(code));
    return fetch(url, {
      method: "POST",
      headers: this.getAuthHeaders("application/json", this.options.apiKey), // NOTE: we use apiKey as auth on this endpoint (we do not have a token yet)
    })
      .then(async (res) => {
        if (res.status === 200) {
          const token = await res.text();
          const decodedToken = decodeToken(token);
          if (!decodedToken) {
            return null;
          }
          return {
            ...decodedToken,
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

  private getAuthorizeUrl(token: string): string {
    const url = new URL("/authorize", this.options.valBuildUrl);
    url.searchParams.set(
      "redirect_uri",
      encodeURIComponent(`${this.options.publicValApiRoute}/callback`)
    );
    url.searchParams.set("state", token);
    return url.toString();
  }

  private getAppErrorUrl(error: string): string {
    const url = new URL("/authorize", this.options.valBuildUrl);
    url.searchParams.set("error", encodeURIComponent(error));
    return url.toString();
  }
}

function verifyCallbackReq(
  stateCookie: string,
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

const ValToken = z.object({
  sub: z.string(),
  exp: z.number(),
  project: z.string(),
  org: z.string(),
});
type ValToken = z.infer<typeof ValToken>;

/**
 * @returns valid data or null if invalid (forces user to re-auth)
 */
function decodeToken(token: string): ValToken | null {
  try {
    const [headerBase64, payloadBase64, signatureBase64, ...rest] =
      token.split(".");
    if (
      !headerBase64 ||
      !payloadBase64 ||
      !signatureBase64 ||
      rest.length > 0
    ) {
      console.debug(
        "Invalid token: token format is not exactly {header}.{payload}.{signature}",
        token
      );
      return null;
    }
    const payload = Buffer.from(payloadBase64, "base64").toString("utf8");
    const parsedPayload = JSON.parse(payload) as unknown;
    const payloadVerification = ValToken.safeParse(parsedPayload);
    if (!payloadVerification.success) {
      console.debug(
        "Invalid code jwt token payload",
        payloadVerification.error
      );
      return null;
    }
    return payloadVerification.data;
  } catch (err) {
    console.debug("Failed to parse token", err);
    return null;
  }
}
