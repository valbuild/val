import {
  parseCancel,
  parseDiscard,
  parseJob,
  parseNewestCiRun,
  parsePress,
  parseRenew,
  parseRequestStatus,
  type JobStepBody,
  type PressResponse,
  type PublishRequestStatus,
  type PublishTabJob,
} from "@valbuild/shared/internal";
import { z } from "zod";
import { callJson } from "./publishClient";

/**
 * Publishing as a queued job, as a Studio tab speaks it.
 *
 * valbuild/home's docs/app-mode.md, "Publishing is a queued job", is the
 * design: a press is a REQUEST that returns at once; the tab that pressed runs
 * the job it is given -- prepare, build, upload -- and content runs verify and
 * the seal. Everything goes through this deployment: the job routes through
 * the publish proxy, and the prepare through this server's own route, which is
 * the one place a job's sources can be computed.
 */
export type StudioJobClient = {
  /** A press of Publish. Idempotent on `requestId`. */
  press(requestId: string, tab: string): Promise<PressResponse>;
  /** Try again: resume a paused queue and press anew. */
  tryAgain(requestId: string, tab: string): Promise<PressResponse>;
  /** Where a press is. */
  requestStatus(requestId: string): Promise<PublishRequestStatus>;
  /** A free tab asking for queued work. */
  next(tab: string): Promise<PublishTabJob | null>;
  /** The job's prepare, by this server: its sources, and content's archive of them. */
  prepare(job: PublishTabJob, tab: string): Promise<PreparedJob>;
  /** The tab reports a step it ran. */
  step(jobId: string, body: JobStepBody): Promise<PublishTabJob | null>;
  /** The tab is still building. `false`: it no longer holds the job. */
  renew(jobId: string, tab: string): Promise<boolean>;
  cancel(jobId: string): Promise<boolean>;
  /** Discard a failed job's changes; answers what another job still holds. */
  discard(jobId: string, unstagePatchIds?: string[]): Promise<string[]>;
  /**
   * Connected: the newest CI run the branch's workflow reported -- where
   * "View run" goes for a build that failed. `null` when none was reported.
   */
  newestCiRun(): Promise<{
    status: "failed" | "succeeded";
    url: string | null;
  } | null>;
};

/** What the tab builds a job from: `/api/val/publish-job-prepare`'s answer. */
export type PreparedJob = {
  job: PublishTabJob | null;
  sourceFiles: Record<string, string | null>;
  binaryFiles: Record<string, string>;
  binaryFilesUnread: string[];
  branch: string | null;
  /** Can this tab build the job from these sources? See the route's `buildable`. */
  buildable: boolean;
};

export function createStudioJobClient(options: {
  api: string;
  fetchImpl?: typeof fetch;
}): StudioJobClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const api = options.api.replace(/\/+$/, "");
  const proxy = (path: string, method: "GET" | "POST", body?: unknown) =>
    callJson(fetchImpl, `${api}/publish-api${path}`, method, body);
  const job = (jobId: string, step: string) =>
    `/publish-jobs/${encodeURIComponent(jobId)}/${step}`;

  return {
    press: async (requestId, tab) =>
      parsePress(
        await proxy("/publish-requests", "POST", { requestId, tab }),
        "POST /v1/publish-requests",
      ),
    tryAgain: async (requestId, tab) =>
      parsePress(
        await proxy("/publish-requests/try-again", "POST", { requestId, tab }),
        "POST /v1/publish-requests/try-again",
      ),
    requestStatus: async (requestId) =>
      parseRequestStatus(
        await proxy(
          `/publish-requests/${encodeURIComponent(requestId)}`,
          "GET",
        ),
      ).request,
    next: async (tab) =>
      parseJob(
        await proxy("/publish-jobs/next", "POST", { tab }),
        "POST /v1/publish-jobs/next",
      ).job,
    prepare: async (tabJob, tab) => {
      const answer = await callJson(
        fetchImpl,
        `${api}/publish-job-prepare`,
        "POST",
        { jobId: tabJob.id, tab, patchIds: tabJob.patches },
      );
      return parsePreparedJob(answer);
    },
    step: async (jobId, body) =>
      parseJob(
        await proxy(job(jobId, "steps"), "POST", body),
        "POST /v1/publish-jobs/{id}/steps",
      ).job,
    renew: async (jobId, tab) =>
      parseRenew(await proxy(job(jobId, "renew"), "POST", { tab })).renewed,
    cancel: async (jobId) =>
      parseCancel(await proxy(job(jobId, "cancel"), "POST", {})).cancelled,
    discard: async (jobId, unstagePatchIds) =>
      parseDiscard(
        await proxy(
          job(jobId, "discard"),
          "POST",
          unstagePatchIds ? { unstagePatchIds } : {},
        ),
      ).stillHeld,
    newestCiRun: async () =>
      parseNewestCiRun(await proxy("/ci-runs/newest", "GET")).run,
  };
}

/** `/api/val/publish-job-prepare`'s answer, checked: it crossed a network. */
const preparedJob = z.object({
  sourceFiles: z.record(z.string(), z.string().nullable()),
  binaryFiles: z.record(z.string(), z.string()),
  binaryFilesUnread: z.array(z.string()),
  branch: z.string().nullable(),
  buildable: z.boolean().optional(),
});

function parsePreparedJob(body: unknown): PreparedJob {
  const job = parseJob(body, "POST /api/val/publish-job-prepare").job;
  const parsed = preparedJob.safeParse(body);
  if (!parsed.success)
    throw new Error(
      "The server's publish prepare answered with something this Studio cannot read.",
    );
  const { buildable, ...rest } = parsed.data;
  return { job, ...rest, buildable: buildable ?? true };
}
