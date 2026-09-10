import { Internal, ValConfig, ValModules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "@valbuild/server";
import { VERSION } from "../version";
import { valDraftMode, type ValDraftMode } from "./valDraftMode";

/**
 * The Val API, as a handler you can mount on a TanStack Start server route.
 *
 * `createValApiRouter` already speaks the platform's own vocabulary — it takes
 * a `Request` and hands back a `ValServerGenericResult` — so all this adds is
 * the conversion to a `Response`, which for Next needed `NextResponse` and here
 * does not need anything.
 */
const initValApiHandler = (
  valModules: ValModules,
  config: ValConfig,
  draftMode: ValDraftMode,
  formatter?: (code: string, filePath: string) => Promise<string> | string,
): ((req: Request) => Promise<Response>) => {
  const route = "/api/val"; // TODO: get from config
  const coreVersion = Internal.VERSION.core;
  if (!coreVersion) {
    throw new Error("Could not get @valbuild/core package version");
  }
  const tanstackVersion = VERSION;
  if (!tanstackVersion) {
    throw new Error("Could not get @valbuild/tanstack package version");
  }

  return createValApiRouter(
    route,
    createValServer(
      valModules,
      route,
      {
        versions: {
          /*
           * Reported as `next` because that is the field the wire contract has.
           *
           * `Versions` in `@valbuild/server` names the framework half of the
           * pair `next`, and admin.val.build reads it. Renaming it is a change
           * to a published contract with a server on the other end, so the
           * TanStack package fills the same field rather than adding one
           * nothing reads.
           */
          next: tanstackVersion,
          core: coreVersion,
        },
        ...config,
      },
      config,
      {
        isEnabled() {
          return draftMode.isEnabled();
        },
        onEnable() {
          return draftMode.enable();
        },
        onDisable() {
          return draftMode.disable();
        },
      },
      formatter,
    ),
    (valRes): Response => {
      const headers = new Headers();
      const valResHeaders = ("headers" in valRes && valRes.headers) || {};
      for (const key in valResHeaders) {
        const value = valResHeaders[key];
        if (typeof value === "string") {
          headers.set(key, value);
        }
      }
      if ("cookies" in valRes && valRes.cookies) {
        for (const [cookieName, cookie] of Object.entries(valRes.cookies)) {
          headers.append("Set-Cookie", serializeCookie(cookieName, cookie));
        }
      }
      if ("json" in valRes) {
        headers.set("Content-Type", "application/json");
        return new Response(JSON.stringify(valRes.json), {
          headers,
          status: valRes.status,
        });
      }
      if (valRes.status === 302) {
        headers.set("Location", valRes.redirectTo);
        /*
         * Built by hand rather than with `Response.redirect`.
         *
         * `Response.redirect` produces an immutable response whose headers
         * cannot be added to, and the redirect that enables Val is precisely
         * the one that has to set cookies on its way out.
         */
        return new Response(null, {
          status: valRes.status,
          headers,
        });
      }
      return new Response("body" in valRes ? valRes.body : null, {
        headers,
        status: valRes.status,
      });
    },
  );
};

/**
 * One `Set-Cookie` header value.
 *
 * `value` is nullable because clearing a cookie is expressed as a null value
 * rather than a separate op — which is also why a falsy value gets `Max-Age=0`
 * below when no explicit expiry was given.
 */
type ValResponseCookie = {
  value: string | null;
  options?: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string | boolean;
    path?: string;
    expires?: Date;
  };
};

function serializeCookie(name: string, cookie: ValResponseCookie): string {
  const options = cookie.options;
  /*
   * `Path=/` unless told otherwise — the default is not "the whole site".
   *
   * A `Set-Cookie` with no `Path` defaults to the DIRECTORY of the request
   * that set it, and every cookie Val sets is set by a response from
   * `/api/val/...`. So `val_enable` — which the page reads from
   * `document.cookie` to decide whether to mount the Studio overlay — was
   * scoped to `/api/val` and invisible on the site itself: enabling Val
   * appeared to do nothing at all. Next's `NextResponse` normalises this for
   * the Next package; a plain `Response` does not.
   */
  const path = options?.path ?? "/";
  return (
    `${name}=${encodeURIComponent(cookie.value || "")}` +
    `${options?.httpOnly ? "; HttpOnly" : ""}` +
    `${options?.secure ? "; Secure" : ""}` +
    `${options?.sameSite ? `; SameSite=${options.sameSite}` : ""}` +
    `; Path=${path}` +
    `${
      options?.expires
        ? `; Expires=${options.expires.toISOString()}`
        : `${!cookie.value ? "; Max-Age=0" : ""}`
    }`
  );
}

export function initValServer(
  valModules: ValModules,
  config: ValConfig & {
    disableCache?: boolean;
  },
  opts?: {
    formatter?: (code: string, filePath: string) => Promise<string> | string;
    /**
     * How preview mode is stored for a browser.
     *
     * Defaults to Val's own cookie (`valDraftMode()`), which is what an app
     * wants unless it already has a preview mechanism of its own to hang this
     * off. Whatever is passed here MUST be the same object the content readers
     * get, or the API will enable a preview the loaders cannot see.
     */
    draftMode?: ValDraftMode;
  },
): {
  /**
   * The Val API. Mount it on `/api/val/$` for every method:
   *
   * @example
   * // src/routes/api/val.$.ts
   * import { createFileRoute } from "@tanstack/react-router";
   * import { valApiHandler } from "../../val/server";
   *
   * export const Route = createFileRoute("/api/val/$")({
   *   server: {
   *     handlers: {
   *       GET: ({ request }) => valApiHandler(request),
   *       POST: ({ request }) => valApiHandler(request),
   *       PUT: ({ request }) => valApiHandler(request),
   *       PATCH: ({ request }) => valApiHandler(request),
   *       DELETE: ({ request }) => valApiHandler(request),
   *       HEAD: ({ request }) => valApiHandler(request),
   *     },
   *   },
   * });
   */
  valApiHandler: (req: Request) => Promise<Response>;
  /** The draft-mode flag this server reads and writes. */
  draftMode: ValDraftMode;
} {
  const draftMode = opts?.draftMode ?? valDraftMode();
  return {
    valApiHandler: initValApiHandler(
      valModules,
      config,
      draftMode,
      opts?.formatter,
    ),
    draftMode,
  };
}
