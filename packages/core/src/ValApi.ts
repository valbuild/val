import {
  ApiCommitResponse,
  ApiGetPatchResponse,
  ApiPostValidationErrorResponse,
  ApiPostPatchResponse,
  ApiPostValidationResponse,
  ApiTreeResponse,
  Json,
  ApiSchemaResponse,
} from ".";
import { result } from "./fp";
import { getSHA256Hash } from "./getSha256";
import { Patch } from "./patch";
import { ModuleFilePath, PatchId } from "./val";

type FetchError = { message: string; details?: unknown; statusCode?: number };
const textEncoder = new TextEncoder();

// TODO: move this to internal, only reason this is here is that react, ui and server all depend on it
export class ValApi {
  constructor(public host: string) {}

  getDisableUrl(redirectTo: string) {
    return `${this.host}/disable?redirect_to=${encodeURIComponent(redirectTo)}`;
  }
  getLoginUrl(redirectTo: string) {
    return `${this.host}/authorize?redirect_to=${encodeURIComponent(
      redirectTo
    )}`;
  }

  getEnableUrl(redirectTo: string) {
    return `${this.host}/enable?redirect_to=${encodeURIComponent(redirectTo)}`;
  }

  async getPatches() {
    return fetch(`${this.host}/patches/~`, {
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((res) => parse<ApiGetPatchResponse>(res))
      .catch(createError<ApiGetPatchResponse>);
  }

  async deletePatches(ids: string[], headers?: Record<string, string>) {
    const params = new URLSearchParams();
    ids.forEach((id) => params.append("id", id));
    return fetch(`${this.host}/patches/~?${params}`, {
      method: "DELETE",
      headers: headers || {
        "Content-Type": "application/json",
      },
    })
      .then((res) => parse<Json>(res))
      .catch(createError<Json>);
  }

  getEditUrl() {
    return `/val`;
  }

  getSession() {
    return fetch(`${this.host}/session`).then((res) =>
      parse<{
        mode: "proxy" | "local";
        member_role: "owner" | "developer" | "editor";
      }>(res).catch(
        createError<{
          mode: "proxy" | "local";
          member_role: "owner" | "developer" | "editor";
        }>
      )
    );
  }

  getSchema({ headers }: { headers?: Record<string, string> | undefined }) {
    return fetch(`${this.host}/schema`, {
      method: "GET",
      headers,
    })
      .then((res) => parse<ApiSchemaResponse>(res))
      .catch(createError<ApiSchemaResponse>);
  }

  putTree({
    treePath = "/",
    patchIds,
    addPatch,
    validateAll,
    validateSource,
    validateBinaryFiles,
    headers,
  }: {
    treePath?: string;
    patchIds?: PatchId[];
    addPatch?: {
      path: ModuleFilePath;
      patch: Patch;
    };
    validateAll?: boolean;
    validateSource?: boolean;
    validateBinaryFiles?: boolean;
    headers?: Record<string, string> | undefined;
  }) {
    const params = new URLSearchParams();
    const patchesSha = getSHA256Hash(
      textEncoder.encode(
        ((patchIds as string[]) || [])
          .concat(JSON.stringify(addPatch || {}))
          .join(";")
      )
    );

    params.set("patches_sha", patchesSha);
    params.set("validate_all", (validateAll || false).toString());
    params.set("validate_source", (validateSource || false).toString());
    params.set(
      "validate_binary_files",
      (validateBinaryFiles || false).toString()
    );
    return fetch(`${this.host}/tree/~${treePath}?${params.toString()}`, {
      method: "PUT",
      body: JSON.stringify({ patchIds, addPatch }),
      headers,
    })
      .then((res) => parse<ApiTreeResponse>(res))
      .catch(createError<ApiTreeResponse>);
  }

  postCommit({
    patches,
    headers,
  }: {
    patches?: Record<ModuleFilePath, PatchId[]>;
    headers?: Record<string, string> | undefined;
  }): Promise<
    result.Result<
      ApiCommitResponse,
      FetchError | ApiPostValidationErrorResponse
    >
  > {
    return fetch(`${this.host}/commit`, {
      method: "POST",
      body: JSON.stringify({ patches }),
      headers: headers || {
        "Content-Type": "application/json",
      },
    })
      .then(async (res) => {
        if (res.ok) {
          return parse<ApiCommitResponse>(res);
        } else if (
          res.status === 400 &&
          res.headers.get("content-type") === "application/json"
        ) {
          const jsonRes = await res.json();
          if ("validationErrors" in jsonRes) {
            return result.err(jsonRes as ApiPostValidationErrorResponse);
          } else {
            return formatError(res.status, jsonRes, res.statusText);
          }
        }
        return parse<ApiCommitResponse>(res);
      })
      .catch(createError<ApiCommitResponse>);
  }

  postValidate({
    patches,
    headers,
  }: {
    patches?: Record<ModuleFilePath, PatchId[]>;
    headers?: Record<string, string> | undefined;
  }): Promise<
    result.Result<
      ApiPostValidationResponse | ApiPostValidationErrorResponse,
      FetchError
    >
  > {
    return fetch(`${this.host}/validate`, {
      method: "POST",
      body: JSON.stringify({ patches }),
      headers: headers || {
        "Content-Type": "application/json",
      },
    })
      .then(async (res) => {
        return parse<
          ApiPostValidationResponse | ApiPostValidationErrorResponse
        >(res);
      })
      .catch(
        createError<ApiPostValidationResponse | ApiPostValidationErrorResponse>
      );
  }
}

function createError<T>(err: unknown): result.Result<T, FetchError> {
  return result.err({
    statusCode: 500,
    message:
      err instanceof Error
        ? err.message
        : typeof err === "object" &&
          err &&
          "message" in err &&
          typeof err.message === "string"
        ? err.message
        : "Unknown error",
    details:
      typeof err === "object" && err && "details" in err
        ? err.details
        : undefined,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatError(status: number, json: any, statusText?: string) {
  return result.err({
    statusCode: status,
    message: json.message || statusText,
    details:
      json.details ||
      Object.fromEntries(
        Object.entries(json).filter(([key]) => key !== "message")
      ),
  });
}

// TODO: validate
async function parse<T>(res: Response): Promise<result.Result<T, FetchError>> {
  try {
    if (res.ok) {
      return result.ok(await res.json());
    } else {
      try {
        const json = await res.json();
        return formatError(res.status, json, res.statusText);
      } catch (err) {
        return result.err({
          statusCode: res.status,
          message: res.statusText,
        });
      }
    }
  } catch (err) {
    return result.err({
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
