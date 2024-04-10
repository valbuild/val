import { ValConfig } from "@valbuild/core";
import { createValApiRouter } from "@valbuild/server";
import { createValServer } from "@valbuild/server";
import type { draftMode } from "next/headers";
import { NextResponse } from "next/server";

const initValNextAppRouter = (
  config: ValConfig,
  nextConfig: ValServerNextConfig
) => {
  const route = "/api/val"; // TODO: get from config
  return createValApiRouter(
    route,
    createValServer(route, config, {
      async isEnabled() {
        return nextConfig.draftMode().isEnabled;
      },
      async onEnable() {
        nextConfig.draftMode().enable();
      },
      async onDisable() {
        nextConfig.draftMode().disable();
      },
    }),
    (valRes): NextResponse => {
      let headersInit: HeadersInit | undefined = undefined;
      const valResHeaders = ("headers" in valRes && valRes.headers) || {};
      for (const key in valResHeaders) {
        const value = valResHeaders[key];
        if (typeof value === "string") {
          if (!headersInit) {
            headersInit = {};
          }
          headersInit[key] = value;
        }
      }
      const headers = new Headers(headersInit);
      if ("cookies" in valRes && valRes.cookies) {
        headers.set("Set-Cookie", "");
        for (const [cookieName, cookie] of Object.entries(valRes.cookies)) {
          const cookieValue = `${cookieName}=${encodeURIComponent(
            cookie.value || ""
          )}${cookie.options?.httpOnly ? "; HttpOnly" : ""}${
            cookie.options?.secure ? "; Secure" : ""
          }${
            cookie.options?.sameSite
              ? `; SameSite=${cookie.options.sameSite}`
              : ""
          }${cookie.options?.path ? `; Path=${cookie.options.path}` : ""}${
            cookie.options?.expires
              ? `; Expires=${cookie.options.expires.toISOString()}`
              : `${!cookie.value ? "; Max-Age=0" : ""}`
          }`;
          headers.append("Set-Cookie", cookieValue);
        }
      }
      if ("json" in valRes) {
        headers.set("Content-Type", "application/json");
        return NextResponse.json(valRes.json, {
          headers,
          status: valRes.status,
        });
      } else if (valRes.status === 302) {
        headers.set("Location", valRes.redirectTo);
        return NextResponse.redirect(valRes.redirectTo, {
          status: valRes.status,
          headers: headers,
        });
      }
      return new NextResponse("body" in valRes ? valRes.body : null, {
        headers,
        status: valRes.status,
      });
    }
  );
};

type ValServerNextConfig = {
  draftMode: typeof draftMode;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValServer(
  config: ValConfig & {
    disableCache?: boolean;
  },
  nextConfig: ValServerNextConfig
): {
  valNextAppRouter: ReturnType<typeof initValNextAppRouter>;
} {
  return {
    valNextAppRouter: initValNextAppRouter(config, nextConfig),
  };
}
