import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import type { PreparedJob, StudioJobClient } from "../publish/jobClient";
import { runProposalMerge, type MergeStep } from "./mergeProposal";

const NAME = "0123456789abcdef0123";
const job = (step: PublishTabJob["step"]): PublishTabJob => ({
  id: "J7",
  step,
  base: "C1",
  patches: [`merge:${NAME}`],
});

/** A content service in miniature: the merge's job, its steps, its press. */
function world(opts: {
  statuses?: PublishRequestStatus[];
  buildFails?: boolean;
}) {
  const calls: string[] = [];
  const statuses = [...(opts.statuses ?? [{ kind: "live", commit: "C2" }])];
  const built: PreparedJob[] = [];
  const steps: MergeStep[] = [];
  const jobs: StudioJobClient = {
    press: async () => {
      throw new Error("a merge is not pressed as the site's Publish");
    },
    tryAgain: async () => {
      throw new Error("not used");
    },
    requestStatus: async () => {
      calls.push("status");
      return statuses.length > 1 ? statuses.shift()! : statuses[0]!;
    },
    next: async () => null,
    prepare: async () => {
      throw new Error("a merge is not prepared by the Val server");
    },
    step: async (_id, body) => {
      calls.push(`step ${body.step} ${body.ok ? "ok" : "failed"}`);
      return body.step === "build" ? job("upload") : job(null);
    },
    renew: async () => true,
    cancel: async () => true,
    discard: async () => [],
    newestCiRun: async () => null,
  };
  return {
    calls,
    built,
    steps,
    run: () =>
      runProposalMerge({
        press: async (input) => {
          calls.push(`press ${input.requestId}`);
          return { job: job("prepare") };
        },
        publishApi: async (path) => {
          calls.push(`POST ${path}`);
          return {
            job: job("build"),
            sourceFiles: { "content/a.val.ts": "the proposal's text" },
          };
        },
        jobs,
        deploy: async (prepared) => {
          built.push(prepared);
          return opts.buildFails
            ? {
                status: "failed",
                message: "A page failed to build.",
                problems: [],
              }
            : { status: "uploaded", publishId: "P1" };
        },
        tab: "t1",
        requestId: "m1",
        onStep: (step) => steps.push(step),
        wait: async () => {},
      }),
  };
}

test("presses the merge, builds the proposal's files here, hands it to content and follows it until live", async () => {
  const w = world({
    statuses: [{ kind: "publishing" }, { kind: "live", commit: "C2" }],
  });
  expect(await w.run()).toEqual({ kind: "merged", commit: "C2" });
  expect(w.calls).toEqual([
    "press m1",
    "POST /publish-jobs/J7/merge-prepare",
    "step build ok",
    "step upload ok",
    "status",
    "status",
  ]);
  expect(w.built[0]?.sourceFiles).toEqual({
    "content/a.val.ts": "the proposal's text",
  });
  expect(w.steps).toEqual(["building", "publishing", "publishing"]);
});

test("a build that fails is reported as the step's, and the merge said to have failed", async () => {
  const w = world({ buildFails: true });
  expect(await w.run()).toEqual({
    kind: "failed",
    message: "A page failed to build.",
  });
  expect(w.calls).toContain("step build failed");
  expect(w.calls).not.toContain("status");
});

test("a merge content refuses at the seal is said to have failed, in content's words", async () => {
  const w = world({
    statuses: [
      {
        kind: "failed",
        message:
          "Kari published changes to /products after this proposal started",
        actions: ["try-again"],
        job: "J7",
      },
    ],
  });
  expect(await w.run()).toEqual({
    kind: "failed",
    message: "Kari published changes to /products after this proposal started",
  });
});
