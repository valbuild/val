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
      let headers = "headers" in valRes ? valRes.headers : {};
      if ("cookies" in valRes && valRes.cookies) {
        for (const [cookieName, cookie] of Object.entries(valRes.cookies)) {
          if (cookie) {
            headers = {
              ...headers,
              "Set-Cookie": `${cookieName}=${cookie.value}${
                cookie.options?.httpOnly ? "; HttpOnly" : ""
              }${cookie.options?.secure ? "; Secure" : ""}${
                cookie.options?.sameSite
                  ? `; SameSite=${cookie.options.sameSite}`
                  : ""
              }${
                cookie.options?.expires
                  ? `; Expires=${cookie.options.expires}`
                  : ""
              }`,
            };
          }
        }
      }
      if ("json" in valRes) {
        return NextResponse.json(valRes.json, {
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          status: valRes.status,
        });
      } else if (valRes.status === 302) {
        return NextResponse.redirect(valRes.redirectTo, {
          status: valRes.status,
          headers: {
            ...headers,
            Location: valRes.redirectTo,
          },
        });
      }
      return new NextResponse("body" in valRes ? valRes.body : null, {
        headers: valRes.headers,
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
  config: ValConfig,
  nextConfig: ValServerNextConfig
): {
  valNextAppRouter: ReturnType<typeof initValNextAppRouter>;
} {
  return {
    valNextAppRouter: initValNextAppRouter(config, nextConfig),
  };
}
