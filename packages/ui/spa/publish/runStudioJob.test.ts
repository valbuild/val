import type { JobStepBody, PublishTabJob } from "@valbuild/shared/internal";
import type { PreparedJob, StudioJobClient } from "./jobClient";
import { StudioPublishError } from "./publishClient";
import { runStudioJob } from "./runStudioJob";
import type { StudioDeployResult } from "./runStudioDeploy";

const job: PublishTabJob = {
  id: "J1",
  step: "prepare",
  base: null,
  patches: ["p1"],
};

function fakeClient(over: Partial<StudioJobClient> = {}) {
  const steps: JobStepBody[] = [];
  const renewals: string[] = [];
  const prepared: PreparedJob = {
    job: { ...job, step: "build" },
    sourceFiles: { "/content/a.val.ts": "text" },
    binaryFiles: {},
    binaryFilesUnread: [],
    branch: "main",
  };
  const client: StudioJobClient = {
    press: async () => ({ request: { kind: "publishing" }, job }),
    tryAgain: async () => ({ request: { kind: "publishing" }, job }),
    requestStatus: async () => ({ kind: "publishing" }),
    next: async () => null,
    prepare: async () => prepared,
    step: async (_id, body) => {
      steps.push(body);
      const after =
        body.step === "build" && body.ok
          ? "upload"
          : body.step === "upload" && body.ok
            ? null
            : body.step;
      return { ...job, step: after };
    },
    renew: async (jobId) => {
      renewals.push(jobId);
      return true;
    },
    cancel: async () => true,
    discard: async () => [],
    newestCiRun: async () => null,
    ...over,
  };
  return { client, steps, renewals, prepared };
}

const uploaded: StudioDeployResult = { status: "uploaded", publishId: "pub1" };

test("prepare, build and upload -- then the job is content's", async () => {
  const { client, steps, prepared } = fakeClient();
  const deployedWith: PreparedJob[] = [];
  const result = await runStudioJob({
    client,
    job,
    tab: "ada",
    deploy: async (p) => {
      deployedWith.push(p);
      return uploaded;
    },
    onPhase: () => {},
  });
  expect(result).toEqual({ status: "handed-off", jobId: "J1", built: true });
  expect(deployedWith).toEqual([prepared]); // built from what the server prepared
  // The build step names the publish it declared; then the upload.
  expect(steps).toEqual([
    { tab: "ada", step: "build", ok: true, build: "pub1" },
    { tab: "ada", step: "upload", ok: true },
  ]);
});

test("a build that fails is reported as the build step failing", async () => {
  const { client, steps } = fakeClient();
  const result = await runStudioJob({
    client,
    job,
    tab: "ada",
    deploy: async () => ({
      status: "failed",
      message: "rolldown",
      problems: [],
    }),
    onPhase: () => {},
  });
  expect(result).toEqual({
    status: "failed",
    jobId: "J1",
    message: "rolldown",
  });
  expect(steps).toEqual([{ tab: "ada", step: "build", ok: false }]);
});

test("a prepare the server could not do is reported; one content refused is not reported twice", async () => {
  const notReached = fakeClient({
    prepare: async () => {
      throw new StudioPublishError(500, "could not render", {});
    },
  });
  await runStudioJob({
    client: notReached.client,
    job,
    tab: "ada",
    deploy: async () => uploaded,
    onPhase: () => {},
  });
  expect(notReached.steps).toEqual([
    { tab: "ada", step: "prepare", ok: false },
  ]);

  // 502: content answered the prepare with a failure, and counted it itself.
  const refused = fakeClient({
    prepare: async () => {
      throw new StudioPublishError(502, "the archive could not be written", {});
    },
  });
  const result = await runStudioJob({
    client: refused.client,
    job,
    tab: "ada",
    deploy: async () => uploaded,
    onPhase: () => {},
  });
  expect(result.status).toBe("failed");
  expect(refused.steps).toEqual([]);
});

test("a job that is no longer this tab's is left alone", async () => {
  jest.useFakeTimers();
  try {
    let renewed = true;
    const { client, steps } = fakeClient({ renew: async () => renewed });
    let release!: () => void;
    const building = new Promise<void>((r) => (release = r));
    const running = runStudioJob({
      client,
      job,
      tab: "ada",
      deploy: async () => {
        await building;
        return uploaded;
      },
      onPhase: () => {},
      renewEveryMs: 1_000,
    });
    // The lease lapsed while the tab was building: a renewal says so.
    renewed = false;
    await jest.advanceTimersByTimeAsync(1_000);
    release();
    expect(await running).toEqual({ status: "lost", jobId: "J1" });
    expect(steps).toEqual([]); // no report about a job it does not hold
  } finally {
    jest.useRealTimers();
  }
});

test("a job that moved on before its prepare answered is left alone", async () => {
  const { client, steps, prepared } = fakeClient();
  client.prepare = async () => ({ ...prepared, job: null }); // cancelled meanwhile
  const deployed: PreparedJob[] = [];
  const result = await runStudioJob({
    client,
    job,
    tab: "ada",
    deploy: async (p) => {
      deployed.push(p);
      return uploaded;
    },
    onPhase: () => {},
  });
  expect(result.status).toBe("lost");
  expect(deployed).toEqual([]); // not built
  expect(steps).toEqual([]);
});

test("the lease is renewed while the tab works, and not after", async () => {
  jest.useFakeTimers();
  try {
    const { client, renewals } = fakeClient();
    let release!: () => void;
    const building = new Promise<void>((r) => (release = r));
    const running = runStudioJob({
      client,
      job,
      tab: "ada",
      deploy: async () => {
        await building;
        return uploaded;
      },
      onPhase: () => {},
      renewEveryMs: 1_000,
    });
    await jest.advanceTimersByTimeAsync(3_500);
    expect(renewals).toEqual(["J1", "J1", "J1"]);
    release();
    await running;
    await jest.advanceTimersByTimeAsync(5_000);
    expect(renewals).toHaveLength(3);
  } finally {
    jest.useRealTimers();
  }
});

test("a job that is content's once prepared is handed off unbuilt -- a connected one", async () => {
  const { client, steps, prepared } = fakeClient();
  client.prepare = async () => ({ ...prepared, job: { ...job, step: null } });
  const deployed: PreparedJob[] = [];
  const result = await runStudioJob({
    client,
    job,
    tab: "ada",
    deploy: async (p) => {
      deployed.push(p);
      return uploaded;
    },
    onPhase: () => {},
  });
  expect(result).toEqual({ status: "handed-off", jobId: "J1", built: false });
  expect(deployed).toEqual([]); // CI builds it
  expect(steps).toEqual([]);
});

test("an upload content did not take is not a hand-off", async () => {
  // The lease went elsewhere while the upload was reported: content answers
  // with the job still at a tab's step, and it is not this tab's to wait on.
  const { client } = fakeClient();
  const step = client.step;
  client.step = async (id, body) =>
    body.step === "upload" ? { ...job, step: "build" } : step(id, body);
  const result = await runStudioJob({
    client,
    job,
    tab: "ada",
    deploy: async () => uploaded,
    onPhase: () => {},
  });
  expect(result).toEqual({ status: "lost", jobId: "J1" });
});
