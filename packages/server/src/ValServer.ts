import { Internal, Json } from "@valbuild/core";
import express from "express";

type ValCookies =
  | typeof Internal.VAL_SESSION_COOKIE
  | typeof Internal.VAL_STATE_COOKIE
  | typeof Internal.VAL_ENABLE_COOKIE_NAME;
export type ValServerResultCookies = Record<
  ValCookies,
  {
    value: string;
    options?: {
      httpOnly?: true;
      sameSite?: "lax";
      expires?: Date;
    };
  } | null
>;
export type ValServerError = {
  status: 400 | 401 | 403 | 404 | 500;
  headers?: Record<string, string>;
  body?: { message: string; details?: string };
};
export type ValServerRedirectResult =
  | {
      status: 302;
      cookies?: ValServerResultCookies;
      redirectTo: string;
      headers?: Record<string, string>;
    }
  | ValServerError;
export type ValServerResult<Body extends Json | never = never> =
  | {
      status: 200 | 201;
      headers?: Record<string, string>;
      cookies?: ValServerResultCookies;
      body?: Body;
    }
  | ValServerError;
export interface ValServer {
  authorize(redirectTo: string): Promise<ValServerRedirectResult>;
  callback(req: express.Request, res: express.Response): Promise<void>;
  logout(req: express.Request, res: express.Response): Promise<void>;
  session(req: express.Request, res: express.Response): Promise<void>;
  postPatches(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void>;
  commit(req: express.Request, res: express.Response): Promise<void>;
  enable(req: express.Request, res: express.Response): Promise<void>;
  disable(req: express.Request, res: express.Response): Promise<void>;
  getTree(req: express.Request, res: express.Response): Promise<void>;
  getFiles(req: express.Request, res: express.Response): Promise<void>;
  getPatches(req: express.Request, res: express.Response): Promise<void>;
}
