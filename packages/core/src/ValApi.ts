import {
  ApiCommitResponse,
  ApiGetPatchResponse,
  ApiPostPatchResponse,
  ApiTreeResponse,
} from ".";
import { result } from "./fp";
import { PatchJSON } from "./patch";
import { ModuleId } from "./val";

type FetchError = { message: string; statusCode?: number };

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

  async getPatches({
    patchIds,
    headers,
  }: {
    patchIds?: string[];
    headers?: Record<string, string> | undefined;
  }) {
    const patchIdsParam = patchIds
      ? `?${patchIds.map((id) => `${id}=${encodeURIComponent(id)}`).join("&")}`
      : "";
    return fetch(`${this.host}/patches/~${patchIdsParam}`, {
      headers: headers || {
        "Content-Type": "application/json",
      },
    })
      .then((res) => parse<ApiGetPatchResponse>(res))
      .catch(createError<ApiGetPatchResponse>);
  }
  getEditUrl() {
    return `${this.host}/static/edit`;
  }

  postPatches(
    moduleId: ModuleId,
    patches: PatchJSON,
    headers?: Record<string, string> | undefined
  ) {
    return fetch(`${this.host}/patches/~`, {
      headers: headers || {
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({ [moduleId]: patches }),
    })
      .then((res) => parse<ApiPostPatchResponse>(res))
      .catch(createError<ApiPostPatchResponse>);
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

  getTree({
    patch = false,
    includeSchema = false,
    includeSource = false,
    treePath = "/",
    headers,
  }: {
    patch?: boolean;
    includeSchema?: boolean;
    includeSource?: boolean;
    treePath?: string;
    headers?: Record<string, string> | undefined;
  }) {
    const params = new URLSearchParams();
    params.set("patch", patch.toString());
    params.set("schema", includeSchema.toString());
    params.set("source", includeSource.toString());
    return fetch(`${this.host}/tree/~${treePath}?${params.toString()}`, {
      headers,
    })
      .then((res) => parse<ApiTreeResponse>(res))
      .catch(createError<ApiTreeResponse>);
  }

  postCommit({
    patches,
    headers,
  }: {
    patches?: Record<ModuleId, string[]>;
    headers?: Record<string, string> | undefined;
  }) {
    return fetch(`${this.host}/commit`, {
      method: "POST",
      body: JSON.stringify({ patches }),
      headers: headers || {
        "Content-Type": "application/json",
      },
    })
      .then((res) => parse<ApiCommitResponse>(res))
      .catch(createError<ApiCommitResponse>);
  }
}

function createError<T>(err: unknown): result.Result<T, FetchError> {
  return result.err({
    statusCode: 500,
    message: err instanceof Error ? err.message : "Unknown error",
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
        return result.err({
          statusCode: res.status,
          message: json.message || res.statusText,
          details:
            json.details ||
            Object.fromEntries(
              Object.entries(json).filter(([key]) => key !== "message")
            ),
        });
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
