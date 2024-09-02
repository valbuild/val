import { Internal, Json } from "@valbuild/core";

export const VAL_SESSION_COOKIE = Internal.VAL_SESSION_COOKIE;
export const VAL_STATE_COOKIE = Internal.VAL_STATE_COOKIE;
export const VAL_ENABLE_COOKIE_NAME = Internal.VAL_ENABLE_COOKIE_NAME;

export type VAL_SESSION_COOKIE = typeof VAL_SESSION_COOKIE;
export type VAL_STATE_COOKIE = typeof VAL_STATE_COOKIE;
export type VAL_ENABLE_COOKIE_NAME = typeof VAL_ENABLE_COOKIE_NAME;

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
        path?: string;
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
  json?: { message: string; details?: unknown };
};
export type ValServerRedirectResult<Names extends ValCookiesNames> =
  | {
      status: 302;
      cookies?: ValServerResultCookies<Names>;
      redirectTo: string;
      headers?: Record<string, string | undefined>;
    }
  | ValServerError;
export type ValServerResult<
  Names extends ValCookiesNames,
  Body extends string | ReadableStream<Uint8Array> | never = never,
> =
  | {
      status: 200 | 201;
      headers?: Record<string, string | undefined>;
      cookies?: ValServerResultCookies<Names>;
      body?: Body;
    }
  | ValServerError;

export type ValServerJsonResult<
  Body extends Json | never = never,
  Error extends Json | never = never,
> =
  | {
      status: 200 | 201;
      json: Body;
    }
  | ValServerError
  | (Error extends Json ? { status: 400; json: Error } : never);

export type ValServerGenericResult =
  | ValServerJsonResult<Json>
  | ValServerError
  | ValServerRedirectResult<ValCookiesNames>
  | ValServerResult<ValCookiesNames, string | ReadableStream<Uint8Array>>;

export type ValUIRequestHandler = (
  path: string,
  url: string,
) => Promise<ValServerGenericResult>;

export type ValSession =
  | { mode: "unauthorized"; enabled?: boolean }
  | { mode: "local"; enabled?: boolean }
  | {
      mode: "proxy";
      member_role?: "owner" | "developer" | "editor";
      enabled?: boolean;
      id: string;
      full_name?: string | null;
      username?: string | null;
      avatar_url?: string | null;
    };
