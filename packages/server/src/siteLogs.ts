import { z } from "zod";
import type { RemoteFileAuth } from "./valServerConfig";
import {
  readFromValBuild,
  type ValBuildReadFailureReason,
  type ValBuildReadResult,
} from "./valBuildRead";

/**
 * A hosted site's last hour of requests, from Val Build:
 * `GET {valContentUrl}/v1/{org}/{project}/logs`. What `val logs` and the MCP
 * tool `get_logs` read. The Studio reads the same answer through its admin
 * proxy, as a web component served by Val Build.
 *
 * Each request is what the site's server did with one visit: where, how it
 * ended, how long it took, and every line it printed. Kept for an hour, for
 * sites Val Build hosts; a site served anywhere else answers `not-hosted`.
 * `after` asks for what arrived since an earlier answer's `cursor`, and `live`
 * tells Val Build someone is watching, so it gathers new requests every few
 * seconds instead of once a minute. See `docs/site-errors.md` in valbuild/home.
 */

const LineSchema = z.object({
  time: z.string(),
  level: z.enum(["error", "warn", "info", "debug"]),
  message: z.string(),
  stack: z.string().nullable(),
});

const RequestSchema = z.object({
  id: z.string(),
  time: z.string(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  status: z.number().nullable(),
  durationMs: z.number().nullable(),
  cpuMs: z.number().nullable(),
  outcome: z.enum(["ok", "exception", "cpu", "memory", "canceled"]),
  build: z.string().nullable(),
  proposal: z.string().nullable(),
  lines: z.array(LineSchema),
  errorFingerprint: z.string().nullable(),
});

export type SiteLogRequest = z.infer<typeof RequestSchema>;
export type SiteLogLine = z.infer<typeof LineSchema>;

const SiteLogsAnswerSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    requests: z.array(RequestSchema),
    cursor: z.string(),
    histogram: z.object({
      start: z.string(),
      bucketMs: z.number(),
      buckets: z.array(
        z.object({ error: z.number(), warn: z.number(), info: z.number() }),
      ),
    }),
    liveBuild: z.string().nullable(),
    retentionHours: z.number(),
    truncated: z.boolean(),
  }),
  z.object({ status: z.literal("not-hosted") }),
]);

export type SiteLogsAnswer = z.infer<typeof SiteLogsAnswerSchema>;
export type SiteLogsFailureReason = ValBuildReadFailureReason;
export type FetchSiteLogsResult = ValBuildReadResult<SiteLogsAnswer>;

/** A request's level: the worst thing about it, as Val Build filters by. */
export type SiteLogRequestLevel = "error" | "warn" | "info";

export type FetchSiteLogsOptions = {
  /** `valContentUrl`, e.g. `https://content.val.build`. */
  contentUrl: string;
  /** `org/name`, as `project` in val.config. */
  project: string;
  credential: RemoteFileAuth;
  /** Requests that arrived at or after this time. An hour back at most. */
  since?: Date;
  /** Only what arrived after an earlier answer's `cursor`. */
  after?: string;
  /** Val Build's search: words, and `status:5xx`, `path:/blog/*`, `method:`, `level:`, `build:live`, `is:stopped`. */
  q?: string;
  levels?: readonly SiteLogRequestLevel[];
  /** 1–1000. 200 when absent. */
  limit?: number;
  /** Someone is watching: gather new requests every few seconds for the next 30. */
  live?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function fetchSiteLogs({
  since,
  after,
  q,
  levels,
  limit,
  live,
  ...options
}: FetchSiteLogsOptions): Promise<FetchSiteLogsResult> {
  const query: Record<string, string> = {};
  if (since !== undefined) query["since"] = since.toISOString();
  if (after !== undefined) query["after"] = after;
  if (q !== undefined && q.trim() !== "") query["q"] = q.trim();
  if (levels !== undefined) query["levels"] = levels.join(",");
  if (limit !== undefined) query["limit"] = String(limit);
  if (live === true) query["live"] = "1";
  return readFromValBuild({
    ...options,
    resource: "logs",
    query,
    schema: SiteLogsAnswerSchema,
    invalid: "Val Build's answer was not the site's logs.",
  });
}

/** The worst thing about a request: how it ended, its status, its worst line. */
export function siteLogRequestLevel(
  request: Pick<SiteLogRequest, "outcome" | "status" | "lines">,
): SiteLogRequestLevel {
  if (
    (request.outcome !== "ok" && request.outcome !== "canceled") ||
    (request.status !== null && request.status >= 500) ||
    request.lines.some((line) => line.level === "error")
  ) {
    return "error";
  }
  if (request.lines.some((line) => line.level === "warn")) return "warn";
  return "info";
}
