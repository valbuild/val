import express, { Router } from "express";
import crypto from "crypto";
import { decodeJwt, encodeJwt, getExpire } from "./jwt";

const VAL_SESSION_COOKIE = "val_session";
const VAL_STATE_COOKIE = "val_state";

export type ProxyValServerOptions = {
  apiKey: string;
  sessionKey: string;
  /**
   * Url of the hosted Val endpoints.
   * Typically the public url of your application with /api/val appended.
   *
   * @example https://foo.vercel.app/api/val
   */
  publicValApiRoute: string;
  /**
   * The base url of Val
   *
   * @example https://app.val.build
   */
  valBuildUrl: string;
};

export class ProxyValServer {
  constructor(readonly options: ProxyValServerOptions) {}

  createRouter(): Router {
    const router = Router();
    router.get("/whoami", this.whoami.bind(this));
    router.get("/authorize", this.authorize.bind(this));
    router.get("/callback", this.callback.bind(this));
    router.get("/logout", this.logout.bind(this));
    router.get<{ 0: string }>("/ids/*", this.getIds.bind(this));
    router.patch<{ 0: string }>(
      "/ids/*",
      express.json({
        type: "application/json-patch+json",
      }),
      this.patchIds.bind(this)
    );
    return router;
  }

  async authorize(req: express.Request, res: express.Response): Promise<void> {
    const { redirect_to } = req.query;
    if (typeof redirect_to !== "string") {
      res.redirect(
        getAppErrorUrl(
          "Login failed: missing redirect_to param",
          this.options.valBuildUrl
        )
      );
      return;
    }
    const token = crypto.randomUUID();
    const appAuthorizeUrl = getAuthorizeUrl(
      token,
      this.options.publicValApiRoute,
      this.options.valBuildUrl
    );
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
      verifyCallbackReq(req);
    res.clearCookie(VAL_STATE_COOKIE); // we don't need this anymore

    if (callbackReqError !== null) {
      res.redirect(
        getAppErrorUrl(
          "Failed to verify callback request",
          this.options.valBuildUrl
        )
      );
      return;
    }

    const data = await consumeCode(
      callbackReqSuccess.code,
      this.options.apiKey,
      this.options.valBuildUrl
    );
    if (data === null) {
      res.redirect(
        getAppErrorUrl(
          "Failed to exchange code for user",
          this.options.valBuildUrl
        )
      );
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

  async whoami(req: express.Request, res: express.Response): Promise<void> {
    const cookie = req.cookies[VAL_SESSION_COOKIE];
    if (typeof cookie === "string") {
      const data = decodeJwt(cookie, this.options.sessionKey);
      res.json(data);
    } else {
      res.sendStatus(401);
    }
  }

  async logout(_req: express.Request, res: express.Response): Promise<void> {
    res
      .clearCookie(VAL_SESSION_COOKIE)
      .clearCookie(VAL_STATE_COOKIE)
      .sendStatus(200);
  }

  async getIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    throw new Error("Not implemented");
  }

  async patchIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    throw new Error("Not implemented");
  }
}

function verifyCallbackReq(req: express.Request):
  | {
      success: { code: string; redirect_uri?: string };
      error: null;
    }
  | { success: false; error: string } {
  const stateCookie = req.cookies[VAL_STATE_COOKIE];

  if (typeof stateCookie !== "string") {
    return { success: false, error: "No state cookie" };
  }

  const { code, state: tokenFromQuery } = req.query;

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

async function consumeCode(
  code: string,
  apiKey: string,
  valBuildUrl: string
): Promise<{ sub: string; exp: number; token: string } | null> {
  // TODO: search params
  return fetch(`${valBuildUrl}/api/val/auth/user/token?code=${code}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  })
    .then(async (res) => {
      if (res.status === 200) {
        const token = await res.text();
        const dataBase64 = token.split(".")[1];
        const data = JSON.parse(
          Buffer.from(dataBase64, "base64").toString("utf8")
        );
        if (typeof data?.sub !== "string") {
          console.debug("Invalid user from code (no sub)", data);
        }
        if (typeof data?.exp !== "number") {
          console.debug("Invalid user from code (no sub)", data);
          return null;
        }
        return {
          sub: data?.sub,
          exp: data?.exp,
          token,
        };
      } else {
        console.debug("Failed to get user from code: ", res.status);
      }
      return null;
    })
    .catch((err) => {
      console.debug("Failed to get user from code: ", err);
      return null;
    });
}

type StateCookie = {
  redirect_to: string;
  token: string;
};

function getStateFromCookie(cookie: string):
  | {
      success: StateCookie;
      error: null;
    }
  | { success: false; error: string } {
  const decoded = Buffer.from(cookie, "base64").toString("utf8");
  const parsed = JSON.parse(decoded);
  if (!parsed) {
    return {
      success: false,
      error: "Invalid state cookie: could not parse",
    };
  }
  if (typeof parsed.token !== "string") {
    return {
      success: false,
      error: "Invalid state cookie: no token in parsed object",
    };
  }
  if (typeof parsed.redirect_to !== "string") {
    return {
      success: false,
      error: "Invalid state cookie: no redirect_to in parsed object",
    };
  }
  return { success: parsed, error: null };
}

function createStateCookie(state: StateCookie): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64");
}

function getAuthorizeUrl(
  token: string,
  basePath: string,
  valBuildUrl: string
): string {
  return `${valBuildUrl}/authorize?${new URLSearchParams({
    redirect_uri: encodeURIComponent(`${basePath}/callback`),
    state: token,
  }).toString()}`;
}

function getAppErrorUrl(error: string, valBuildUrl: string): string {
  return `${valBuildUrl}/authorize?${new URLSearchParams({
    error,
  }).toString()}`;
}
