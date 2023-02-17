import express, { Router, RequestHandler } from "express";
import { Service } from "./Service";
import { validatePatch } from "./patch/patch";
import { PatchError } from "./patch/ops";
import * as result from "./fp/result";
import { formatJSONPointer } from "./patch/operation";
import crypto from "crypto";

const getFileIdFromParams = (params: { 0: string }) => {
  return `/${params[0]}`;
};

const secretKey = process.env.VAL_SECRET_KEY || ""; // TODO: rename to VAL_API_KEY? use service, get from config

export function createRequestHandler(
  service: Service,
  route = "/"
): RequestHandler {
  if (secretKey) {
    return new ValServer(route, service).createRouter();
  } else {
    return new DevValServer(service).createRouter();
  }
}

const VAL_SESSION_COOKIE = "val_session";
const VAL_STATE_COOKIE = "val_state";

export interface IValServer {
  createRouter(): Router;

  // TODO: getIds, patchIds not used - should be private in implementations:
  getIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void>;

  patchIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void>;
}

export class ValServer implements IValServer {
  private readonly valAppUrl: string;
  constructor(readonly route: string, readonly service: Service) {
    this.valAppUrl = `${this.service.appBaseUrl}${route}`; // TODO: the way we pass route feels wrong
  }

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
    if (typeof this.service.appBaseUrl !== "string") {
      // TODO: we should never be in this state / we should be in dev mode or fail on start if we do not have a val base url.
      res.redirect(getAppErrorUrl("Val config is wrong: missing app base url"));
      return;
    }
    const { redirect_to } = req.query;
    if (typeof redirect_to !== "string") {
      res.redirect(getAppErrorUrl("Login failed: missing redirect_to param"));
      return;
    }
    const token = crypto.randomUUID(); // TODO: is crypto really available on Vercel edge? Seems like it from the docs, but check non the less
    const appAuthorizeUrl = getAuthorizeUrl(token, this.valAppUrl);
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
      res.redirect(getAppErrorUrl("Failed to verify callback request"));
      return;
    }

    const user = await exchangeCodeForUser(callbackReqSuccess.code, secretKey);
    if (user === null) {
      res.redirect(getAppErrorUrl("Failed to exchange code for user"));
      return;
    }
    const cookie = createUserCookie(user, secretKey);

    res
      .cookie(VAL_SESSION_COOKIE, cookie, {
        httpOnly: true,
        sameSite: "strict",
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3), // 5 days - NOTE: this is not used for authorization, only for authentication
      })
      .redirect(callbackReqSuccess.redirect_uri || "/");
  }

  async whoami(req: express.Request, res: express.Response): Promise<void> {
    const cookie = req.cookies[VAL_SESSION_COOKIE];
    if (typeof cookie === "string") {
      const user = getUserFromCookie(cookie, secretKey);
      res.json(user);
    } else {
      res.sendStatus(401);
    }
  }

  async logout(_req: express.Request, res: express.Response): Promise<void> {
    res.clearCookie(VAL_SESSION_COOKIE);
    res.clearCookie(VAL_STATE_COOKIE);
    res.sendStatus(200);
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

export class DevValServer implements IValServer {
  constructor(readonly service: Service) {}

  createRouter(): Router {
    const router = Router();
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

  async getIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    try {
      console.log(req.params);
      const valContent = await this.service.get(
        getFileIdFromParams(req.params)
      );
      console.log(JSON.stringify(valContent, null, 2));
      res.json(valContent);
    } catch (err) {
      console.error(err);
      res.sendStatus(500);
    }
  }

  async patchIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    const patch = validatePatch(req.body);
    if (result.isErr(patch)) {
      res
        .status(401)
        .send(
          patch.error
            .map(
              ({ path, message }) => `${formatJSONPointer(path)}: ${message}`
            )
            .join("\n")
        );
      return;
    }
    const id = getFileIdFromParams(req.params);
    try {
      await this.service.patch(id, patch.value);
      res.send("OK");
    } catch (err) {
      if (err instanceof PatchError) {
        res.status(401).send(err.message);
      } else {
        console.error(err);
        res
          .status(500)
          .send(err instanceof Error ? err.message : "Unknown error");
      }
    }
  }
}

type User = {
  id: string;
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

function exchangeCodeForUser(
  code: string,
  secretKey: string
): Promise<User | null> {
  // TODO: search params
  return fetch(`${VAL_APP_URL}/api/val/auth/user/code?code=${code}`, {
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

// function getAuthKeys(json: any) {
//   if (typeof json !== "object" || json === null) {
//     return null;
//   }
//   const { auth_keys } = json;
//   if (typeof auth_keys !== "object" || auth_keys === null) {
//     return null;
//   }
//   if (auth_keys)
//   return secret_key;
// }

// function getUserFromCookie(cookie: string, secretKey: string): User | null {
//   const { success, error } = decrypt(cookie, secretKey);
//   if (error) {
//     console.debug("Invalid cookie: ", error);
//     return null;
//   }
//   if (success && typeof success === "object" && "id" in success) {
//     if (typeof success.id === "string") {
//       return {
//         id: success.id,
//       };
//     }
//   }
//   console.log('Invalid cookie: no "id" of type string in object');
//   return null;
// }

// function createUserCookie(user: User, secretKey: string): string {
//   // TODO: we do not really need to encrypt - a signature is enough
//   // TODO: we could embed unencrypted user data in the cookie so we can use the cookie client side as well, though we do not need that right now
//   return encrypt(user, secretKey);
// }

function getUserFromCookie(cookie: string, secretKey: string): User | null {
  // TODO: see comment in createUserCookie
  const [userBase64, signatureBase64] = cookie.split(".");
  if (!userBase64 || !signatureBase64) {
    console.debug("Invalid cookie: no user or signature");
    return null;
  }
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(userBase64)
    .digest("base64");
  if (signature !== signatureBase64) {
    console.debug("Invalid cookie: invalid signature");
    return null;
  }
  const user = JSON.parse(Buffer.from(userBase64, "base64").toString("utf8"));
  if (typeof user !== "object" || user === null) {
    console.debug("Invalid cookie: could not parse user");
    return null;
  }
  if (typeof user.id !== "string") {
    console.debug("Invalid cookie: invalid user (id was not a string)", user);
    return null;
  }
  return user;
}

function createUserCookie(user: User, secretKey: string): string {
  // TODO: use some library for this - preferable something that generates JWT or something similar
  // Erlend suggests @openid/appauth - so should try that
  // tried with simply encrypting using tweetnacl, but it relies on Crypto which not defined on vercel edge?
  // think openid also relies on Crypto, libsodium is wasm so won't work on edge?
  // tried with tweetnacl-ts which seems to use crypto package so it works I think but there I had issues with an invalid key length which is not surprising, which very likely can be fixed, but I did not want to spend more time on this NOW - we should make sure this is secure though
  // NOTE: this is only used for authentication, not for authorization (i.e. what a user can do) - this is handled on on the val app
  const userBase64 = Buffer.from(JSON.stringify(user)).toString("base64");
  return `${userBase64}.${crypto
    .createHmac("sha256", secretKey)
    .update(userBase64)
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

const VAL_APP_URL = process.env.VAL_APP_URL || "http://app.val.build"; // TODO: move this out of module scope
function getAuthorizeUrl(token: string, basePath: string): string {
  return `${VAL_APP_URL}/authorize?${new URLSearchParams({
    redirect_uri: `${basePath}/callback?state=${token}`,
  }).toString()}`;
}
function getAppErrorUrl(error: string): string {
  return `${VAL_APP_URL}/authorize?${new URLSearchParams({
    error,
  }).toString()}`;
}
