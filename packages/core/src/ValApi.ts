import { ApiPatchResponse, ApiTreeResponse } from ".";
import { result } from "./fp";
import { PatchJSON } from "./patch";
import { ModuleId } from "./val";

type FetchError = { message: string; statusCode?: number };

// TODO: move this to internal, only reason this is here is that react, ui and server all depend on it
export class ValApi {
  constructor(public host: string) {}

  getDisableUrl() {
    return `${this.host}/disable`;
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
    }).then((res) => parse<ApiPatchResponse>(res));
  }

  getSession() {
    return fetch(`${this.host}/session`).then((res) =>
      parse<{
        mode: "proxy" | "local";
        member_role: "owner" | "developer" | "editor";
      }>(res)
    );
  }

  getModules({
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
    }).then((res) => parse<ApiTreeResponse>(res));
  }
}

// TODO: validate
async function parse<T>(res: Response): Promise<result.Result<T, FetchError>> {
  try {
    if (res.ok) {
      return result.ok(await res.json());
    } else {
      return result.err({
        statusCode: res.status,
        message: await res.text(),
      });
    }
  } catch (err) {
    return result.err({
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
