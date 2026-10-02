import type { PublishTabJob } from "@valbuild/shared/internal";
import type { DeployPhase, StudioDeployResult } from "./runStudioDeploy";
import type { PreparedJob, StudioJobClient } from "./jobClient";
import { StudioPublishError } from "./publishClient";

/**
 * A publish job, as the tab that holds it runs it: prepare, build, upload --
 * and then it is content's (valbuild/home, docs/app-mode.md, "Publishing is a
 * queued job"). Content runs verify and the seal, and "Live" arrives on the
 * websocket, so a tab that closes after its upload costs nothing.
 *
 * The tab holds the job by a lease, renewed on a timer while it works. A
 * renewal answered `false` means the job is no longer this tab's -- its lease
 * lapsed and its requests went back to the queue, or it was cancelled -- and
 * the tab stops: another tab, or this one's next job, will build it.
 *
 * Every step is reported by name, so a report retried after a lost answer
 * does nothing twice, and a failure is reported as the step's: content counts
 * the attempts and, after the last, fails the job with Try again.
 */

export type JobPhase =
  | { kind: "preparing" }
  | { kind: "deploying"; phase: DeployPhase }
  | { kind: "handing-off" };

export type StudioJobResult =
  /**
   * The tab's part is done, and content has the job. `built`: this tab built
   * and uploaded it. `false` is a job whose build is CI's -- a connected
   * project's, where the tab's part is the prepare alone.
   */
  | { status: "handed-off"; jobId: string; built: boolean }
  /** The job is no longer this tab's. Nothing to report. */
  | { status: "lost"; jobId: string }
  /** A step failed, and was reported as failed. */
  | { status: "failed"; jobId: string; message: string };

/** How often the tab renews its lease. Content's job lease is 30 s. */
export const RENEW_EVERY_MS = 10_000;

export async function runStudioJob(options: {
  client: StudioJobClient;
  job: PublishTabJob;
  tab: string;
  /**
   * Build the job from its prepared sources, stopping once the artifacts are
   * confirmed: `runStudioDeploy` with `until: "confirmed"` and no commit.
   */
  deploy: (
    prepared: PreparedJob,
    onPhase: (phase: DeployPhase) => void,
  ) => Promise<StudioDeployResult>;
  onPhase: (phase: JobPhase) => void;
  renewEveryMs?: number;
  /**
   * Can this tab build at all? Connected only: a tab that cannot (no
   * cross-origin isolation) reports "no build", and CI builds the push. A
   * managed job never reaches a tab that cannot -- it is handed to one that can.
   */
  canBuild?: () => boolean;
}): Promise<StudioJobResult> {
  const { client, job, tab, onPhase } = options;
  let lost = false;
  const renewing = setInterval(() => {
    client.renew(job.id, tab).then(
      (renewed) => {
        if (!renewed) lost = true;
      },
      // A renewal that did not get through is not a lost job: the lease is
      // 30 s and the next one may.
      () => {},
    );
  }, options.renewEveryMs ?? RENEW_EVERY_MS);
  const lostResult: StudioJobResult = { status: "lost", jobId: job.id };

  try {
    onPhase({ kind: "preparing" });
    let prepared: PreparedJob;
    try {
      prepared = await client.prepare(job, tab);
    } catch (error) {
      /*
       * 502 is content answering the prepare with a failure, which content
       * has already counted as an attempt at the step. Anything else never
       * reached it, so the tab reports it.
       */
      const message = messageOf(error);
      if (!(error instanceof StudioPublishError && error.statusCode === 502)) {
        await client
          .step(job.id, { tab, step: "prepare", ok: false, message })
          .catch(() => null);
      }
      return { status: "failed", jobId: job.id, message };
    }
    if (lost || prepared.job === null) return lostResult;
    // Content's already: nothing for this tab to build (connected).
    if (prepared.job.step === null) {
      return { status: "handed-off", jobId: job.id, built: false };
    }
    if (prepared.job.step !== "build") return lostResult;

    /*
     * Connected, and nothing to build here: the server embeds no source, or
     * this tab cannot run the builder. Said, not attempted -- content seals
     * the job without a build, and CI builds the push.
     */
    if (!prepared.buildable || !(options.canBuild?.() ?? true)) {
      onPhase({ kind: "handing-off" });
      const handed = await client.step(job.id, {
        tab,
        step: "build",
        ok: true,
        noBuild: true,
      });
      if (lost || handed === null || handed.step !== null) return lostResult;
      return { status: "handed-off", jobId: job.id, built: false };
    }

    const deployed = await options.deploy(prepared, (phase) =>
      onPhase({ kind: "deploying", phase }),
    );
    if (lost) return lostResult;
    if (deployed.status !== "uploaded") {
      const message =
        deployed.status === "failed"
          ? deployed.message
          : "The build went further than a job's build should.";
      /*
       * With the reason: if the build fails for good, content's failure is
       * what every Studio shows, and without it that said "build failed 3
       * times" and nothing else.
       */
      await client
        .step(job.id, { tab, step: "build", ok: false, message })
        .catch(() => null);
      return { status: "failed", jobId: job.id, message };
    }

    onPhase({ kind: "handing-off" });
    const built = await client.step(job.id, {
      tab,
      step: "build",
      ok: true,
      build: deployed.publishId,
    });
    if (built === null || built.step !== "upload") return lostResult;
    const uploaded = await client.step(job.id, {
      tab,
      step: "upload",
      ok: true,
    });
    /*
     * Handed off only if content took it: the job comes back with no step for
     * a tab. Anything else -- a lease lost while the report was in flight, a
     * job content left at the upload -- is not this tab's to wait on.
     */
    if (lost || uploaded === null || uploaded.step !== null) return lostResult;
    return { status: "handed-off", jobId: job.id, built: true };
  } finally {
    clearInterval(renewing);
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * How many times one job is built in a row. Content counts the attempts at a
 * step and fails the job after its last (`MAX_STEP_ATTEMPTS`, 3), so this is
 * only a backstop for failures content never heard about.
 */
const MAX_RUNS = 5;

/**
 * Run a job until this tab's part of it is over: handed off, lost, or failed
 * for good.
 *
 * A failed step is counted by content, which keeps the job at that step for
 * the tab to run again -- until its last attempt, when it fails the job.
 * Whether it is still this tab's is the renewal's answer, so a failure is
 * followed by one, and a `true` runs it again.
 */
export async function runJobToEnd(options: {
  client: Pick<StudioJobClient, "renew">;
  job: PublishTabJob;
  tab: string;
  run: () => Promise<StudioJobResult>;
}): Promise<StudioJobResult> {
  let result: StudioJobResult = { status: "lost", jobId: options.job.id };
  for (let runs = 0; runs < MAX_RUNS; runs++) {
    result = await options.run().catch(
      (error: unknown): StudioJobResult => ({
        status: "failed",
        jobId: options.job.id,
        message: messageOf(error),
      }),
    );
    if (result.status !== "failed") return result;
    const again = await options.client
      .renew(options.job.id, options.tab)
      .catch(() => false);
    if (!again) return result;
  }
  return result;
}
