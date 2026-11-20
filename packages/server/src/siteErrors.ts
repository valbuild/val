import { z } from "zod";
import type { RemoteFileAuth } from "./valServerConfig";

/**
 * A hosted site's recent errors, from Val Build:
 * `GET {valContentUrl}/v1/{org}/{project}/site-errors`. What `val errors` and
 * the MCP tool `get_site_errors` read. The Studio reads the same answer through
 * its admin proxy, as a web component served by Val Build.
 *
 * Errors are kept only for sites Val Build hosts: the platform's tail is what
 * sees them. A site served anywhere else answers `not-hosted`, which is said
 * rather than shown as an empty list, so "no errors" never means "nobody is
 * watching". See `docs/site-errors.md` in valbuild/home.
 *
 * Either credential `resolveRemoteFileAuth` gives works: the project's API key
 * or a developer's `val login` token.
 */

const SiteErrorSchema = z.object({
  fingerprint: z.string(),
  kind: z.enum(["exception", "console", "limit", "status"]),
  level: z.enum(["error", "warn"]),
  message: z.string(),
  stack: z.string().nullable(),
  path: z.string().nullable(),
  method: z.string().nullable(),
  status: z.number().nullable(),
  count: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  firstBuild: z.string().nullable(),
  lastBuild: z.string().nullable(),
  proposal: z.string().nullable(),
});

export type SiteError = z.infer<typeof SiteErrorSchema>;

const SiteErrorsAnswerSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    errors: z.array(SiteErrorSchema),
    retentionDays: z.number(),
    liveBuild: z.string().nullable(),
    dropped: z.boolean(),
  }),
  z.object({ status: z.literal("not-hosted") }),
]);

export type SiteErrorsAnswer = z.infer<typeof SiteErrorsAnswerSchema>;

export type SiteErrorsFailureReason =
  /** The credential was refused: a `val login` that ran out, or a wrong API key. */
  | "unauthenticated"
  /** The credential is good, and does not reach this project. */
  | "forbidden"
  /** No such project, as `project` in val.config names it. */
  | "not-found"
  /** Val Build answered that it could not read the errors just now. */
  | "unavailable"
  /** Val Build did not answer at all. */
  | "unreachable"
  /** Val Build answered with something that is not the answer. */
  | "invalid-response";

export type FetchSiteErrorsResult =
  | { status: "ok"; answer: SiteErrorsAnswer }
  | {
      status: "error";
      reason: SiteErrorsFailureReason;
      /** Val Build's own sentence where it gave one, for Details. */
      message: string;
    };

export type FetchSiteErrorsOptions = {
  /** `valContentUrl`, e.g. `https://content.val.build`. */
  contentUrl: string;
  /** `org/name`, as `project` in val.config. */
  project: string;
  credential: RemoteFileAuth;
  /** 1–200. Val Build's default when absent. */
  limit?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function fetchSiteErrors({
  contentUrl,
  project,
  credential,
  limit,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}: FetchSiteErrorsOptions): Promise<FetchSiteErrorsResult> {
  const [org, name] = project.split("/");
  const url = new URL(
    `v1/${encodeURIComponent(org ?? "")}/${encodeURIComponent(name ?? "")}/site-errors`,
    contentUrl.endsWith("/") ? contentUrl : `${contentUrl}/`,
  );
  if (limit !== undefined) url.searchParams.set("limit", String(limit));
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
  const parsed = SiteErrorsAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: "error",
      reason: "invalid-response",
      message: "Val Build's answer was not a list of site errors.",
    };
  }
  return { status: "ok", answer: parsed.data };
}

function reasonOf(status: number): SiteErrorsFailureReason {
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
