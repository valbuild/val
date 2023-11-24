import {
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ApiTreeResponse,
} from "@valbuild/core";
import {
  VAL_ENABLE_COOKIE_NAME,
  VAL_SESSION_COOKIE,
  VAL_STATE_COOKIE,
  ValCookies,
  ValServerError,
  ValServerJsonResult,
  ValServerRedirectResult,
  ValServerResult,
} from "@valbuild/shared/internal";

export const ENABLE_COOKIE_VALUE = {
  value: "true",
  options: {
    httpOnly: false,
    sameSite: "lax",
  },
} as const;

export function getRedirectUrl(
  query: { redirect_to?: string | undefined },
  overrideHost: string | undefined
): string | ValServerError {
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

export type ValServerCallbacks = {
  isEnabled: () => Promise<boolean>;
  onEnable: (success: boolean) => Promise<void>;
  onDisable: (success: boolean) => Promise<void>;
};

export interface ValServer {
  // Sets cookie state:
  authorize(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_SESSION_COOKIE>>;
  callback(
    query: { code?: string; state?: string },
    cookies: ValCookies<VAL_STATE_COOKIE>
  ): Promise<ValServerRedirectResult<VAL_STATE_COOKIE | VAL_SESSION_COOKIE>>;
  enable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>>;
  disable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>>;
  logout(): Promise<ValServerResult<VAL_STATE_COOKIE | VAL_SESSION_COOKIE>>;
  // Data:
  session(cookies: ValCookies<VAL_SESSION_COOKIE>): Promise<
    ValServerJsonResult<{
      mode: "proxy" | "local";
      member_role?: "owner" | "developer" | "editor";
      enabled: boolean;
    }>
  >;
  getTree(
    treePath: string,
    query: { patch?: string; schema?: string; source?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiTreeResponse>>;
  getPatches(
    query: { id?: string[] },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiGetPatchResponse>>;
  postPatches(
    body: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>>;
  postCommit(
    cookies: ValCookies<VAL_SESSION_COOKIE>
    // eslint-disable-next-line @typescript-eslint/ban-types
  ): Promise<ValServerJsonResult<{}>>; // TODO: add body type here
  // Streams:
  getFiles(
    treePath: string,
    query: { sha256?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerResult<never, ReadableStream<Uint8Array>>>;
}
