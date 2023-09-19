import { ApiTreeResponse } from "@valbuild/core";
import { result } from "@valbuild/core/fp";

type FetchError = { message: string; statusCode?: number };

export class ValApi {
  constructor(public host: string) {}

  getDisableUrl() {
    return `${this.host}/disable`;
  }

  getSession() {
    return fetch(`${this.host}/session`).then(
      parse<{
        mode: "proxy" | "local";
        member_role: "owner" | "developer" | "editor";
      }>
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
    }).then(parse<ApiTreeResponse>);
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
