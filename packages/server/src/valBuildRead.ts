import type { z } from "zod";
import type { RemoteFileAuth } from "./valServerConfig";

/**
 * One GET to Val Build's `/v1/{org}/{project}/…` with a developer's `val login`
 * token or the project's API key, read against a schema: what `fetchSiteErrors`
 * and `fetchSiteLogs` share, so both say the same things about the same
 * failures.
 */

export type ValBuildReadFailureReason =
  /** The credential was refused: a `val login` that ran out, or a wrong API key. */
  | "unauthenticated"
  /** The credential is good, and does not reach this project. */
  | "forbidden"
  /** No such project, as `project` in val.config names it. */
  | "not-found"
  /** Val Build answered that it could not read it just now. */
  | "unavailable"
  /** Val Build did not answer at all. */
  | "unreachable"
  /** Val Build answered with something that is not the answer. */
  | "invalid-response";

export type ValBuildReadResult<T> =
  | { status: "ok"; answer: T }
  | {
      status: "error";
      reason: ValBuildReadFailureReason;
      /** Val Build's own sentence where it gave one, for Details. */
      message: string;
    };

export async function readFromValBuild<S extends z.ZodTypeAny>({
  contentUrl,
  project,
  resource,
  query,
  credential,
  schema,
  invalid,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}: {
  contentUrl: string;
  /** `org/name`, as `project` in val.config. */
  project: string;
  /** What follows the project: `site-errors`, `logs`. */
  resource: string;
  query: Record<string, string>;
  credential: RemoteFileAuth;
  schema: S;
  /** What to say when the answer is not one. */
  invalid: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ValBuildReadResult<z.infer<S>>> {
  const [org, name] = project.split("/");
  const url = new URL(
    `v1/${encodeURIComponent(org ?? "")}/${encodeURIComponent(name ?? "")}/${resource}`,
    contentUrl.endsWith("/") ? contentUrl : `${contentUrl}/`,
  );
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        ...("pat" in credential
          ? { "x-val-pat": credential.pat }
          : { authorization: `Bearer ${credential.apiKey}` }),
      },
      // A credential goes to the host it was meant for, and nowhere a
      // redirect would send it.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      status: "error",
      reason: "unreachable",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      status: "error",
      reason: reasonOf(res.status),
      message: messageOf(body) ?? `Val Build answered ${res.status}.`,
    };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { status: "error", reason: "invalid-response", message: invalid };
  }
  return { status: "ok", answer: parsed.data };
}

function reasonOf(status: number): ValBuildReadFailureReason {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status >= 500) return "unavailable";
  return "invalid-response";
}

function messageOf(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }
  return null;
}
