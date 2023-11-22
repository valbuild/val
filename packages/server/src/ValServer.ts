import {
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ApiTreeResponse,
  Internal,
  Json,
} from "@valbuild/core";

const { VAL_SESSION_COOKIE, VAL_STATE_COOKIE, VAL_ENABLE_COOKIE_NAME } =
  Internal;
type VAL_SESSION_COOKIE = typeof VAL_SESSION_COOKIE;
type VAL_STATE_COOKIE = typeof VAL_STATE_COOKIE;
type VAL_ENABLE_COOKIE_NAME = typeof VAL_ENABLE_COOKIE_NAME;

type ValCookiesNames =
  | VAL_SESSION_COOKIE
  | VAL_STATE_COOKIE
  | VAL_ENABLE_COOKIE_NAME;
export type ValCookies<Names extends ValCookiesNames> = Partial<
  Record<Names, string>
>;
export type ValServerResultCookies<Names extends ValCookiesNames> =
  Partial<Record<
    Names,
    {
      value: string | null;
      options?: {
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: "lax" | "strict" | "none";
        expires?: Date;
      };
    }
  > | null>;
export type ValServerErrorStatus = 400 | 401 | 403 | 404 | 500 | 501;
export type ValServerError = {
  status: ValServerErrorStatus;
  headers?: Record<string, string>;
  body?: { message: string; details?: string };
};
export type ValServerRedirectResult<Names extends ValCookiesNames> =
  | {
      status: 302;
      cookies?: ValServerResultCookies<Names>;
      redirectTo: string;
      headers?: Record<string, string>;
    }
  | ValServerError;
export type ValServerResult<
  Names extends ValCookiesNames,
  Body extends
    | Json
    | ApiTreeResponse // TODO: should not be necessary - JSON is enough, but readonly / non-readonly arrays fail
    | ReadableStream<Uint8Array>
    | never = never
> =
  | {
      status: 200 | 201;
      headers?: Record<string, string>;
      cookies?: ValServerResultCookies<Names>;
      body?: Body;
    }
  | ValServerError;

export interface ValServer {
  authorize(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_SESSION_COOKIE>>;
  callback(
    query: { code?: string; state?: string },
    cookies: ValCookies<VAL_STATE_COOKIE>
  ): Promise<ValServerRedirectResult<VAL_STATE_COOKIE | VAL_SESSION_COOKIE>>;
  enable(query: { redirect_to?: string }): Promise<ValServerRedirectResult>;
  disable(query: { redirect_to?: string }): Promise<ValServerRedirectResult>;
  logout(): Promise<ValServerResult>;
  session(cookies: ValCookies): Promise<
    ValServerResult<{
      mode: "proxy" | "local";
      member_role: "owner" | "developer" | "editor";
    }>
  >;
  postPatches(
    treePath: string,
    cookies: ValCookies
  ): Promise<ValServerResult<ApiPostPatchResponse>>;
  getTree(
    treePath: string,
    query: { patch?: string; schema?: string; source?: string },
    cookies: ValCookies
  ): Promise<ValServerResult<ApiTreeResponse>>;
  commit(cookies: ValCookies): Promise<ValServerResult>; // TODO: add bod type here
  getFiles(
    treePath: string,
    query: { sha256?: string },
    cookies: ValCookies
  ): Promise<ValServerResult<ReadableStream<Uint8Array>>>;
  getPatches(
    treePath: string,
    query: { id?: string[] },
    cookies: ValCookies
  ): Promise<ValServerResult<ApiGetPatchResponse>>;
}
