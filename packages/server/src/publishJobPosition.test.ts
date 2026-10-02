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
