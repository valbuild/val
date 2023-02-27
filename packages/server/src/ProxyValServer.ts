import express, { Router } from "express";
import crypto from "crypto";

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
   * @example https://val.build
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

    const user = await exchangeCodeForUser(
      callbackReqSuccess.code,
      this.options.apiKey,
      this.options.valBuildUrl
    );
    if (user === null) {
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
      userToJwtPayload(user, exp),
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
      const user = decodeJwt(cookie, this.options.sessionKey);
      res.json(user);
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

type User = {
  id: string;
};
type JwtPayload = {
  sub: string;
  exp: number;
};

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

async function exchangeCodeForUser(
  code: string,
  secretKey: string,
  valBuildUrl: string
): Promise<User | null> {
  // TODO: search params
  return fetch(`${valBuildUrl}/api/val/auth/user/token?code=${code}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secretKey}`,
    },
  })
    .then(async (res) => {
      if (res.status === 200) {
        const user = await res.json();
        if (typeof user?.id == "string") {
          return user;
        } else {
          console.debug("Invalid user from code: ", user);
        }
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

function decodeJwt(cookie: string, sessionKey: string): JwtPayload | null {
  const [headerBase64, payloadBase64, signatureBase64] = cookie.split(".");
  if (!headerBase64 || !payloadBase64 || !signatureBase64) {
    console.debug("Invalid cookie: missing header, payload or signature");
    return null;
  }
  const signature = crypto
    .createHmac("sha256", sessionKey)
    .update(`${headerBase64}.${payloadBase64}`)
    .digest("base64");
  if (signature !== signatureBase64) {
    console.debug("Invalid cookie: invalid signature");
    return null;
  }
  const payload = JSON.parse(
    Buffer.from(payloadBase64, "base64").toString("utf8")
  );
  if (typeof payload !== "object" || payload === null) {
    console.debug("Invalid cookie: could not parse payload");
    return null;
  }
  if (typeof payload.sub !== "string") {
    console.debug(
      "Invalid cookie: invalid payload (sub was not a string)",
      payload
    );
    return null;
  }
  if (typeof payload.exp !== "number") {
    console.debug(
      "Invalid cookie: invalid payload (exp was not a number)",
      payload
    );
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    console.debug("Invalid cookie: expired", payload);
    return null;
  }
  return payload;
}

function getExpire(): number {
  return Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 4; // 4 days
}

const jwtHeader = {
  alg: "HS256",
  typ: "JWT",
};
const jwtHeaderBase64 = Buffer.from(JSON.stringify(jwtHeader)).toString(
  "base64"
);
function userToJwtPayload(user: User, exp: number): JwtPayload {
  return {
    sub: user.id,
    exp,
  };
}

function encodeJwt(payload: JwtPayload, sessionKey: string): string {
  // NOTE: this is only used for authentication, not for authorization (i.e. what a user can do) - this is handled when actually doing operations
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `${jwtHeaderBase64}.${payloadBase64}.${crypto
    .createHmac("sha256", sessionKey)
    .update(`${jwtHeaderBase64}.${payloadBase64}`)
    .digest("base64")}`;
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
    redirect_uri: encodeURIComponent(`${basePath}/callback?state=${token}`),
  }).toString()}`;
}

function getAppErrorUrl(error: string, valBuildUrl: string): string {
  return `${valBuildUrl}/authorize?${new URLSearchParams({
    error,
  }).toString()}`;
}
