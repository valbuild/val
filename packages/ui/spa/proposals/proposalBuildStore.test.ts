import { BUILD_CANCELLED_MESSAGE } from "@valbuild/shared/publish";
import type { ProposalBuildOutcome } from "./proposalCode";
import {
  buildReport,
  cancelProposalBuild,
  proposalBuildState,
  resetProposalBuild,
  runProposalBuild,
  type ProposalBuildRun,
} from "./proposalBuildStore";

/** A build that ends only when its signal says so, as a stuck one does. */
const stuck = ({ signal }: ProposalBuildRun) =>
  new Promise<ProposalBuildOutcome>((resolve) => {
    signal.addEventListener("abort", () => {
      const reason: unknown = signal.reason;
      resolve(
        reason instanceof Error && reason.name !== "AbortError"
          ? { status: "failed", message: reason.message }
          : {
              status: "failed",
              message: BUILD_CANCELLED_MESSAGE,
              cancelled: true,
            },
      );
    });
  });

describe("runProposalBuild", () => {
  beforeEach(() => resetProposalBuild());
  afterEach(() => {
    resetProposalBuild();
    jest.useRealTimers();
  });

  test("Cancel ends a stuck build at once, as cancelled rather than failed", async () => {
    const build = runProposalBuild(stuck);
    expect(proposalBuildState().building).toBe(true);
    expect(cancelProposalBuild()).toBe(true);
    const outcome = await build;
    expect(outcome).toMatchObject({ status: "failed", cancelled: true });
    const state = proposalBuildState();
    expect(state.building).toBe(false);
    // Nothing to fix: no error is shown for a cancel.
    expect(state.error).toBeNull();
    expect(state.last?.status).toBe("cancelled");
    expect(cancelProposalBuild()).toBe(false);
  });

  test("the next Build after a cancel starts a new build, not the stuck one", async () => {
    const first = runProposalBuild(stuck);
    expect(runProposalBuild(stuck)).toBe(first);
    cancelProposalBuild();
    await first;
    const second = runProposalBuild(async () => ({
      status: "already-built",
      hash: null,
    }));
    expect(second).not.toBe(first);
    expect(await second).toEqual({ status: "already-built", hash: null });
  });

  test("a build that stops moving on is stopped, saying at which step", async () => {
    jest.useFakeTimers();
    let at = 0;
    const build = runProposalBuild(
      (run) => {
        run.progress("Uploading");
        return stuck(run);
      },
      { now: () => at, stallMs: 60_000 },
    );
    at = 59_000;
    jest.advanceTimersByTime(5_000);
    expect(proposalBuildState().building).toBe(true);
    at = 61_000;
    jest.advanceTimersByTime(5_000);
    const outcome = await build;
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.cancelled).toBeFalsy();
    expect(outcome.status === "failed" && outcome.message).toMatch(
      /no progress for 1 minutes while uploading/,
    );
    expect(proposalBuildState().error).toMatch(/uploading/);
  });

  test("progress keeps a slow build alive", async () => {
    jest.useFakeTimers();
    let at = 0;
    let progress: (label: string) => void = () => {};
    let finish: (outcome: ProposalBuildOutcome) => void = () => {};
    const build = runProposalBuild(
      (run) => {
        progress = run.progress;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      { now: () => at, stallMs: 60_000 },
    );
    for (let file = 0; file < 5; file++) {
      at += 50_000;
      progress("Uploading");
      jest.advanceTimersByTime(5_000);
    }
    expect(proposalBuildState().building).toBe(true);
    finish({ status: "already-built", hash: null });
    expect(await build).toEqual({ status: "already-built", hash: null });
  });

  test("times each step once, however often it reports", async () => {
    let at = 0;
    const outcome = await runProposalBuild(
      async ({ progress }) => {
        progress("Reading the proposal");
        at = 400;
        progress("Uploading");
        at = 900;
        progress("Uploading");
        at = 2_000;
        progress("Serving the build at the proposal's address");
        at = 5_000;
        return { status: "already-built", hash: null };
      },
      { now: () => at },
    );
    expect(outcome.status).toBe("already-built");
    const last = proposalBuildState().last;
    expect(last?.timings).toEqual([
      { step: "Reading the proposal", ms: 400 },
      { step: "Uploading", ms: 1_600 },
      { step: "Serving the build at the proposal's address", ms: 3_000 },
    ]);
    expect(last?.ms).toBe(5_000);
    expect(buildReport(proposalBuildState(), 8_000)).toEqual({
      status: "idle",
      last: {
        status: "already-built",
        seconds: 5,
        steps: [
          { step: "Reading the proposal", seconds: 0.4 },
          { step: "Uploading", seconds: 1.6 },
          { step: "Serving the build at the proposal's address", seconds: 3 },
        ],
        ended_seconds_ago: 3,
      },
    });
  });
});
