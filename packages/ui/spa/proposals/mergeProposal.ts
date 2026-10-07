import { z } from "zod";
import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import type { PreparedJob, StudioJobClient } from "../publish/jobClient";
import type {
  DeployPhase,
  StudioDeployResult,
} from "../publish/runStudioDeploy";
import { runStudioJob } from "../publish/runStudioJob";

/**
 * Publish, in a proposal: merge it into the site, as this Studio tab sees it.
 * valbuild/home `docs/proposals.md`, Flow F, "How the merge job is built".
 *
 * Content made the merge a publish job, so this is the tab's part of one --
 * the same `runStudioJob` a site publish runs -- with one difference: the
 * prepare is the merge's own (`/publish-jobs/:id/merge-prepare`), which content
 * does from the proposal's last save and answers with the files to build.
 * Then content verifies and seals it, and this follows the press until it is
 * live or has failed.
 */
export type MergeStep = "building" | "publishing";

export type MergeOutcome =
  | { kind: "merged"; commit: string }
  | { kind: "failed"; message: string };

const MergePrepareAnswer = z.object({
  job: z
    .object({
      id: z.string(),
      step: z.enum(["prepare", "build", "upload"]).nullable(),
      base: z.string().nullable(),
      patches: z.array(z.string()),
    })
    .nullable(),
  sourceFiles: z.record(z.string(), z.string().nullable()),
});

export async function runProposalMerge(deps: {
  /** Press the merge: `POST /proposals/:name/merge`, through this deployment. */
  press: (input: {
    requestId: string;
    tab: string;
  }) => Promise<{ job: PublishTabJob | null }>;
  /** The publish API, through this deployment's proxy. */
  publishApi: (path: string, body: unknown) => Promise<unknown>;
  jobs: StudioJobClient;
  /** Build prepared files in this tab: `deployPreparedJob` over the Studio's deploy. */
  deploy: (
    prepared: PreparedJob,
    onPhase: (phase: DeployPhase) => void,
  ) => Promise<StudioDeployResult>;
  tab: string;
  requestId: string;
  onStep: (step: MergeStep) => void;
  /** Between looks at the press, once the tab's part is done. */
  pollMs?: number;
  /** How long to follow it before saying it is still going. */
  timeoutMs?: number;
  wait?: (ms: number) => Promise<void>;
}): Promise<MergeOutcome> {
  const wait =
    deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  deps.onStep("building");
  const pressed = await deps.press({
    requestId: deps.requestId,
    tab: deps.tab,
  });
  if (pressed.job !== null) {
    const job = pressed.job;
    const client: StudioJobClient = {
      ...deps.jobs,
      async prepare(tabJob) {
        const answer = MergePrepareAnswer.parse(
          await deps.publishApi(
            `/publish-jobs/${encodeURIComponent(tabJob.id)}/merge-prepare`,
            { tab: deps.tab },
          ),
        );
        return {
          job: answer.job,
          sourceFiles: answer.sourceFiles,
          binaryFiles: {},
          binaryFilesUnread: [],
          branch: null,
          buildable: true,
        };
      },
    };
    const ran = await runStudioJob({
      client,
      job,
      tab: deps.tab,
      deploy: deps.deploy,
      onPhase: (phase) => {
        if (phase.kind === "handing-off") deps.onStep("publishing");
      },
    });
    if (ran.status === "failed")
      return { kind: "failed", message: ran.message };
  }
  /*
   * Content's now -- or another tab's, if this one could not take it: verify
   * and the seal run without this tab. Followed until it is live or fails.
   */
  deps.onStep("publishing");
  const until = Date.now() + (deps.timeoutMs ?? 5 * 60_000);
  for (;;) {
    const status: PublishRequestStatus = await deps.jobs.requestStatus(
      deps.requestId,
    );
    if (status.kind === "live")
      return { kind: "merged", commit: status.commit };
    if (status.kind === "failed") {
      return { kind: "failed", message: status.message };
    }
    if (status.kind === "cancelled" || status.kind === "nothing-to-publish") {
      return { kind: "failed", message: "The publish was cancelled." };
    }
    if (Date.now() > until) {
      return {
        kind: "failed",
        message:
          "It is taking longer than it should. It may still go live: look at the site in a minute.",
      };
    }
    await wait(deps.pollMs ?? 1000);
  }
}
