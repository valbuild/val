import { z } from "zod";
import type { RemoteFileAuth } from "./valServerConfig";
import {
  readFromValBuild,
  type ValBuildReadFailureReason,
  type ValBuildReadResult,
} from "./valBuildRead";

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

export type SiteErrorsFailureReason = ValBuildReadFailureReason;

export type FetchSiteErrorsResult = ValBuildReadResult<SiteErrorsAnswer>;

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

export function fetchSiteErrors({
  limit,
  ...options
}: FetchSiteErrorsOptions): Promise<FetchSiteErrorsResult> {
  return readFromValBuild({
    ...options,
    resource: "site-errors",
    query: limit !== undefined ? { limit: String(limit) } : {},
    schema: SiteErrorsAnswerSchema,
    invalid: "Val Build's answer was not a list of site errors.",
  });
}
