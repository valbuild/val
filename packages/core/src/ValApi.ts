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

  postPatches(
    moduleId: ModuleId,
    patches: PatchJSON,
    commit?: string,
    headers?: Record<string, string> | undefined
  ) {
    let params = "";
    if (commit) {
      const p = new URLSearchParams();
      p.set("commit", commit);
      params = `?${p.toString()}`;
    }
    return fetch(`${this.host}/patches/~${moduleId}${params}`, {
      headers: headers || {
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify(patches),
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
