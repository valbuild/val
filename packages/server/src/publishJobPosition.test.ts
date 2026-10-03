import { initVal } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";

const { config } = initVal();

/**
 * A build a tab made for a publish job has no commit to say where it sits in
 * the content service's chain, so it names its job -- on the overlay request
 * and on the websocket nonce, the two places a commit would have gone. A build
 * with a commit sends the commit, and only that.
 */
describe("a build names its publish job where it has no commit", () => {
  const sent: Array<{ url: string; body: unknown }> = [];
  beforeEach(() => {
    sent.length = 0;
    jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      sent.push({
        url: String(input),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return new Response(JSON.stringify({ message: "stub" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const ops = (
    git: { commit: string; branch: string } | null,
    publishJob?: string,
  ) =>
    new ValOpsHttp(
      "https://content.example",
      "org/project",
      git,
      { apiKey: "test" },
      { config, modules: [] },
      { config, ...(publishJob !== undefined ? { publishJob } : {}) },
    );

  const askOverlay = (o: ValOpsHttp) =>
    o.fetchPatchesInternal({ excludePatchOps: true }).catch(() => undefined);

  test("a tab's build: the job, on the overlay and the nonce", async () => {
    const o = ops(null, "J-1");
    await askOverlay(o);
    await o.getWebSocketNonce("profile");
    const overlay = new URL(sent[0]!.url);
    expect(overlay.pathname).toContain("/applicable/patches");
    expect(overlay.searchParams.get("job")).toBe("J-1");
    expect(overlay.searchParams.has("commit")).toBe(false);
    expect(sent[1]!.body).toMatchObject({ profileId: "profile", job: "J-1" });
  });

  test("a build of a commit sends the commit and no job", async () => {
    const o = ops({ commit: "c".repeat(40), branch: "main" }, "J-1");
    await askOverlay(o);
    await o.getWebSocketNonce("profile");
    const overlay = new URL(sent[0]!.url);
    expect(overlay.searchParams.get("commit")).toBe("c".repeat(40));
    expect(overlay.searchParams.has("job")).toBe(false);
    expect(sent[1]!.body).not.toHaveProperty("job");
  });

  test("a build that names neither sends neither", async () => {
    const o = ops(null);
    await askOverlay(o);
    await o.getWebSocketNonce("profile");
    const overlay = new URL(sent[0]!.url);
    expect(overlay.searchParams.has("job")).toBe(false);
    expect(overlay.searchParams.has("commit")).toBe(false);
    expect(sent[1]!.body).toEqual({ profileId: "profile" });
  });
});

/**
 * Which build is asking, when the platform running it says (`VAL_BUILD`):
 * sent beside whatever else the build says about itself, on both requests, so
 * the content service can place a build the edge still serves after a publish
 * as itself rather than as the new one.
 */
describe("a build the platform names sends its hash with every position", () => {
  const sent: Array<{ url: string; body: unknown }> = [];
  beforeEach(() => {
    sent.length = 0;
    jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      sent.push({
        url: String(input),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return new Response(JSON.stringify({ message: "stub" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const ops = (
    git: { commit: string; branch: string } | null,
    named: { publishJob?: string; publishBuild?: string },
  ) =>
    new ValOpsHttp(
      "https://content.example",
      "org/project",
      git,
      { apiKey: "test" },
      { config, modules: [] },
      { config, ...named },
    );

  const ask = async (o: ValOpsHttp) => {
    await o.fetchPatchesInternal({ excludePatchOps: true }).catch(() => {});
    await o.getWebSocketNonce("profile");
    return { overlay: new URL(sent[0]!.url), nonce: sent[1]!.body };
  };

  test("a seed, which names nothing else: the build alone", async () => {
    const { overlay, nonce } = await ask(ops(null, { publishBuild: "b0" }));
    expect(overlay.searchParams.get("build")).toBe("b0");
    expect(overlay.searchParams.has("job")).toBe(false);
    expect(overlay.searchParams.has("commit")).toBe(false);
    expect(nonce).toEqual({ profileId: "profile", build: "b0" });
  });

  test("a tab's build: the build and its job", async () => {
    const { overlay, nonce } = await ask(
      ops(null, { publishJob: "J-1", publishBuild: "b1" }),
    );
    expect(overlay.searchParams.get("build")).toBe("b1");
    expect(overlay.searchParams.get("job")).toBe("J-1");
    expect(nonce).toEqual({ profileId: "profile", job: "J-1", build: "b1" });
  });

  test("CI's build: the build and its commit", async () => {
    const commit = "c".repeat(40);
    const { overlay, nonce } = await ask(
      ops({ commit, branch: "main" }, { publishBuild: "b2" }),
    );
    expect(overlay.searchParams.get("build")).toBe("b2");
    expect(overlay.searchParams.get("commit")).toBe(commit);
    expect(nonce).toEqual({
      profileId: "profile",
      branch: "main",
      commitSha: commit,
      build: "b2",
    });
  });

  test("off the platform, no build is sent", async () => {
    const { overlay, nonce } = await ask(ops(null, {}));
    expect(overlay.searchParams.has("build")).toBe(false);
    expect(nonce).toEqual({ profileId: "profile" });
  });
});
