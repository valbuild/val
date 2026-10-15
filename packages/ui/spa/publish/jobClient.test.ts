import { createStudioJobClient } from "./jobClient";
import { onPlanRefusal } from "../utils/planRefusal";

/*
 * A merge's job is prepared by content, from the proposal's last save --
 * whichever tab builds it: the one Publish was pressed in, the builder tab a
 * page that cannot build opens, or a free tab taking queued work. This
 * server's own prepare knows only the site's pending changes.
 */
describe("preparing a job", () => {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const body = url.endsWith("/merge-prepare")
      ? {
          job: { id: "J9", step: "build", base: "c1", patches: ["merge:p1"] },
          sourceFiles: { "src/a.val.ts": "export default 1;" },
        }
      : {
          sourceFiles: {},
          binaryFiles: {},
          binaryFilesUnread: [],
          branch: null,
          buildable: true,
          job: { id: "J1", step: "build", base: null, patches: ["x"] },
        };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createStudioJobClient({ api: "/api/val", fetchImpl });

  beforeEach(() => {
    calls.length = 0;
  });

  test("a merge's job: content's merge-prepare, through the publish proxy", async () => {
    const prepared = await client.prepare(
      { id: "J9", step: "prepare", base: "c1", patches: ["merge:p1"] },
      "tab-1",
    );
    expect(calls).toEqual([
      {
        url: "/api/val/publish-api/publish-jobs/J9/merge-prepare",
        body: { tab: "tab-1" },
      },
    ]);
    expect(prepared).toEqual({
      job: { id: "J9", step: "build", base: "c1", patches: ["merge:p1"] },
      sourceFiles: { "src/a.val.ts": "export default 1;" },
      binaryFiles: {},
      binaryFilesUnread: [],
      branch: null,
      buildable: true,
    });
  });

  test("the site's job: this server's prepare, as before", async () => {
    await client.prepare(
      { id: "J1", step: "prepare", base: null, patches: ["x"] },
      "tab-1",
    );
    expect(calls.map((call) => call.url)).toEqual([
      "/api/val/publish-job-prepare",
    ]);
  });
});

/*
 * A merge that changes only content goes live on the live build (valbuild/home
 * `docs/hosted-publishing.md`, step 8): content answers its prepare with a job
 * nobody builds, and says so. The tab must keep the saying, or it reads a job
 * with no step as one it has lost.
 */
test("a merge that changes only content is answered as one nobody builds, and says so", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        job: {
          id: "J9",
          step: null,
          base: "c1",
          patches: ["merge:p1"],
          contentOnly: true,
        },
        sourceFiles: { "src/a.val.ts": "export default 1;" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const prepared = await createStudioJobClient({
    api: "/api/val",
    fetchImpl,
  }).prepare(
    { id: "J9", step: "prepare", base: "c1", patches: ["merge:p1"] },
    "tab-1",
  );
  expect(prepared.job).toEqual({
    id: "J9",
    step: null,
    base: "c1",
    patches: ["merge:p1"],
    contentOnly: true,
  });
});

/*
 * Publish in a proposal is pressed by a person -- content records who asked
 * for the merge -- so it goes through the proposals proxy, which carries the
 * editor's session. What comes back is a press's answer like any other.
 */
test("a merge is pressed through the proposals proxy, and answered as a press", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(
      JSON.stringify({
        request: { kind: "publishing" },
        job: { id: "J9", step: "prepare", base: "c1", patches: ["merge:p1"] },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const pressed = await createStudioJobClient({
    api: "/api/val/",
    fetchImpl,
  }).pressMerge("p1", "r1", "tab-1");
  expect(calls).toEqual([
    {
      url: "/api/val/proposals-api/p1/merge",
      body: { requestId: "r1", tab: "tab-1" },
    },
  ]);
  expect(pressed).toEqual({
    request: { kind: "publishing" },
    job: { id: "J9", step: "prepare", base: "c1", patches: ["merge:p1"] },
  });
});

/*
 * A press the plan does not allow -- a trial's 3 publishes, a trial that
 * ended -- is refused with a 403 whose body says why as data. The shell
 * listens for it (`onPlanRefusal`) to say so with the next step beside it.
 */
describe("a press Val Build refuses for the plan", () => {
  test("is told to the shell, and still thrown with Val Build's sentence", async () => {
    const body = {
      statusCode: 403,
      message: "website's trial includes 3 publishes, and they are used.",
      error: {
        code: "trial-publishes",
        fix: "add-card",
        billingUrl: "https://admin.val.build/~/acme?section=billing",
      },
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(body), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    const heard: string[] = [];
    const stop = onPlanRefusal((refusal) => heard.push(refusal.code));
    try {
      const client = createStudioJobClient({ api: "/api/val", fetchImpl });
      await expect(client.press("r1", "tab-1")).rejects.toThrow(
        "website's trial includes 3 publishes, and they are used.",
      );
    } finally {
      stop();
    }
    expect(heard).toEqual(["trial-publishes"]);
  });
});
