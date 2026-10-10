import { createStudioJobClient } from "./jobClient";

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
