import {
  ApiCommitResponse,
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ApiPostValidationErrorResponse,
  ApiTreeResponse,
  ApiDeletePatchResponse,
  ApiPostValidationResponse,
  ValModules,
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
  ValServerResultCookies,
  ValSession,
} from "@valbuild/shared/internal";

export type ValServerOptions = {
  valEnableRedirectUrl?: string;
  valDisableRedirectUrl?: string;
  git: {
    commit?: string;
    branch?: string;
  };
};

export abstract class ValServer2 implements IValServer {
  constructor(
    readonly valModules: ValModules,
    readonly options: ValServerOptions,
    readonly callbacks: ValServerCallbacks
  ) {}

  //#region auth
  authorize(query: {
    redirect_to?: string | undefined;
  }): Promise<ValServerRedirectResult<"val_state">> {
    throw new Error("Method not implemented.");
  }
  callback(
    query: { code?: string | undefined; state?: string | undefined },
    cookies: Partial<Record<"val_state", string>>
  ): Promise<
    ValServerRedirectResult<"val_enable" | "val_state" | "val_session">
  > {
    throw new Error("Method not implemented.");
  }
  enable(query: {
    redirect_to?: string | undefined;
  }): Promise<ValServerRedirectResult<"val_enable">> {
    throw new Error("Method not implemented.");
  }
  disable(query: {
    redirect_to?: string | undefined;
  }): Promise<ValServerRedirectResult<"val_enable">> {
    throw new Error("Method not implemented.");
  }
  logout(): Promise<ValServerResult<"val_state" | "val_session">> {
    throw new Error("Method not implemented.");
  }
  session(
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ValSession>> {
    throw new Error("Method not implemented.");
  }

  //#region patches
  getPatches(
    query: { id?: string[] | undefined },
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiGetPatchResponse>> {
    throw new Error("Method not implemented.");
  }
  postPatches(
    body: unknown,
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>> {
    throw new Error("Method not implemented.");
  }
  deletePatches(
    query: { id?: string[] | undefined },
    cookies: Partial<Record<"val_session", string>>
  ): Promise<ValServerJsonResult<ApiDeletePatchResponse>> {
    throw new Error("Method not implemented.");
  }

  //#region tree ops
  putTree(
    body: unknown,
    treePath: string,
    query: { base_sha?: string | undefined; patches_sha?: string | undefined },
    cookies: Partial<Record<"val_session", string>>,
    requestHeaders: RequestHeaders
  ): Promise<ValServerJsonResult<ApiTreeResponse>> {
    throw new Error("Method not implemented.");
  }
  putValidate(
    body: unknown,
    query: { base_sha?: string | undefined; patches_sha?: string | undefined },
    cookies: Partial<Record<"val_session", string>>,
    requestHeaders: RequestHeaders
  ): Promise<
    ValServerJsonResult<
      ApiPostValidationErrorResponse | ApiPostValidationResponse
    >
  > {
    throw new Error("Method not implemented.");
  }
  postCommit(
    body: unknown,
    cookies: Partial<Record<"val_session", string>>,
    requestHeaders: RequestHeaders
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  > {
    throw new Error("Method not implemented.");
  }

  //#region files
  putFiles(
    filePath: string,
    body: unknown,
    query: { base_sha?: string | undefined; patches_sha?: string | undefined },
    cookies: Partial<Record<"val_session", string>>,
    requestHeaders: RequestHeaders
  ): Promise<
    | ValServerError
    | {
        status: 302;
        cookies?: ValServerResultCookies<"val_enable"> | undefined;
        redirectTo: string;
        headers?: Record<string, string | undefined> | undefined;
      }
    | {
        status: 200 | 201;
        headers?: Record<string, string | undefined> | undefined;
        cookies?: ValServerResultCookies<never> | undefined;
        body?: ReadableStream<Uint8Array> | undefined;
      }
  > {
    throw new Error("Method not implemented.");
  }
}

export type ValServerCallbacks = {
  isEnabled: () => Promise<boolean>;
  onEnable: (success: boolean) => Promise<void>;
  onDisable: (success: boolean) => Promise<void>;
};

export interface IValServer {
  authorize(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_STATE_COOKIE>>;
  callback(
    query: { code?: string; state?: string },
    cookies: ValCookies<VAL_STATE_COOKIE>
  ): Promise<
    ValServerRedirectResult<
      VAL_STATE_COOKIE | VAL_SESSION_COOKIE | VAL_ENABLE_COOKIE_NAME
    >
  >;
  enable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>>;
  disable(query: {
    redirect_to?: string;
  }): Promise<ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>>;
  logout(): Promise<ValServerResult<VAL_STATE_COOKIE | VAL_SESSION_COOKIE>>;
  session(
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ValSession>>;

  getPatches(
    query: { id?: string[] },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiGetPatchResponse>>;
  postPatches(
    body: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiPostPatchResponse>>;
  deletePatches(
    query: { id?: string[] },
    cookies: ValCookies<VAL_SESSION_COOKIE>
  ): Promise<ValServerJsonResult<ApiDeletePatchResponse>>;

  putTree(
    body: unknown,
    treePath: string,
    query: { base_sha?: string; patches_sha?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<ValServerJsonResult<ApiTreeResponse>>;
  putValidate(
    body: unknown,
    query: { base_sha?: string; patches_sha?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<
    ValServerJsonResult<
      ApiPostValidationResponse | ApiPostValidationErrorResponse
    >
  >;
  postCommit(
    body: unknown,
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<
    ValServerJsonResult<ApiCommitResponse, ApiPostValidationErrorResponse>
  >;

  putFiles(
    filePath: string,
    body: unknown,
    query: { base_sha?: string; patches_sha?: string },
    cookies: ValCookies<VAL_SESSION_COOKIE>,
    requestHeaders: RequestHeaders
  ): Promise<
    | ValServerResult<never, ReadableStream<Uint8Array>>
    | ValServerRedirectResult<VAL_ENABLE_COOKIE_NAME>
  >;
}

export type RequestHeaders = {
  host?: string | null;
  "x-forwarded-proto"?: string | null;
};
