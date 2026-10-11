import { initVal, type ModuleFilePath } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import { contentFromEnv, type ValContentVersion } from "./proposal";

const { s, c, config } = initVal();

/*
 * A content version: the site's content, served by a build that bundles an
 * older one. valbuild/home `docs/hosted-publishing.md`, step 2.
 *
 * The platform hands the server the modules that differ from the bundle
 * (`VAL_CONTENT`), the way it hands a proposal's address its saved content.
 * The server reads that Source instead of the bundle's, and names the
 * version's own place in the chain as its position -- never the build's, which
 * the content service would place by the build and replay the version's own
 * changes over a snapshot that already holds them.
 */

const PAGE = "/app/page.val.ts" as ModuleFilePath;
const FOOTER = "/app/footer.val.ts" as ModuleFilePath;
const modules = [
  {
    def: async () => ({
      default: c.define(PAGE, s.object({ title: s.string() }), {
        title: "From the bundle",
      }),
    }),
  },
  {
    def: async () => ({
      default: c.define(FOOTER, s.object({ text: s.string() }), {
        text: "Footer from the bundle",
      }),
    }),
  },
];

const ID = "e".repeat(64);
const version = (over: Partial<ValContentVersion> = {}): ValContentVersion => ({
  id: ID,
  job: "J-7",
  commit: "c7",
  modules: { [PAGE]: { title: "Published since the build" } },
  files: {
    "app/page.val.ts": 'export default c.define("/app/page.val.ts", s, {});\n',
  },
  ...over,
});

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

const ops = (v: ValContentVersion | undefined) =>
  new ValOpsHttp(
    "https://content.example",
    "org/project",
    null,
    { apiKey: "test" },
    { config, modules },
    {
      config,
      publishJob: "J-1",
      publishBuild: "base-build",
      ...(v !== undefined ? { contentVersion: v } : {}),
    },
  );

describe("a server given a content version", () => {
  test("reads the version's Source for what it holds, and the bundle's for the rest", async () => {
    const sources = await ops(version()).getBaseSources();
    expect(sources[PAGE]).toEqual({ title: "Published since the build" });
    expect(sources[FOOTER]).toEqual({ text: "Footer from the bundle" });
  });

  test("a server with none reads the bundle", async () => {
    const sources = await ops(undefined).getBaseSources();
    expect(sources[PAGE]).toEqual({ title: "From the bundle" });
  });

  test("names the version's job as its position, and never the build it runs in", async () => {
    const o = ops(version());
    await o.fetchPatchesInternal({ excludePatchOps: true }).catch(() => {});
    await o.getWebSocketNonce("profile");
    const overlay = new URL(sent[0]!.url);
    expect(overlay.pathname).toContain("/applicable/patches");
    expect(overlay.searchParams.get("job")).toBe("J-7");
    expect(overlay.searchParams.has("build")).toBe(false);
    expect(sent[1]!.body).toMatchObject({ job: "J-7" });
    expect(sent[1]!.body).not.toHaveProperty("build");
  });

  test("a version no job made names its commit", async () => {
    const o = ops(version({ job: null }));
    await o.fetchPatchesInternal({ excludePatchOps: true }).catch(() => {});
    const overlay = new URL(sent[0]!.url);
    expect(overlay.searchParams.get("commit")).toBe("c7");
    expect(overlay.searchParams.has("job")).toBe(false);
    expect(overlay.searchParams.has("build")).toBe(false);
  });

  test("at a proposal's address, the proposal's saves go over the version, and the rest is the version's", async () => {
    const both = new ValOpsHttp(
      "https://content.example",
      "org/project",
      null,
      { apiKey: "test" },
      { config, modules },
      {
        config,
        publishJob: "J-1",
        publishBuild: "base-build",
        contentVersion: version({
          modules: {
            [PAGE]: { title: "Published since the build" },
            [FOOTER]: { text: "Footer published since the build" },
          },
        }),
        proposal: {
          name: "0123456789abcdef0123",
          branch: "val/p/0123456789abcdef0123",
          commit: "save-1",
          modules: { [PAGE]: { title: "Saved in the proposal" } },
          files: {},
        },
      },
    );
    const sources = await both.getBaseSources();
    expect(sources[PAGE]).toEqual({ title: "Saved in the proposal" });
    expect(sources[FOOTER]).toEqual({
      text: "Footer published since the build",
    });
  });

  test("is not a proposal: nothing is compared against a site", async () => {
    expect(await ops(version()).siteSourcesUnderSnapshot()).toBeNull();
  });

  test("at a proposal's address, the site a proposal is compared against is the version's, not the bundle's", async () => {
    const both = new ValOpsHttp(
      "https://content.example",
      "org/project",
      null,
      { apiKey: "test" },
      { config, modules },
      {
        config,
        contentVersion: version(),
        proposal: {
          name: "0123456789abcdef0123",
          branch: "val/p/0123456789abcdef0123",
          commit: "save-1",
          modules: {
            [PAGE]: { title: "Saved in the proposal" },
            [FOOTER]: { text: "Footer saved in the proposal" },
          },
          files: {},
        },
      },
    );
    expect(await both.siteSourcesUnderSnapshot()).toEqual({
      [PAGE]: { title: "Published since the build" },
      [FOOTER]: { text: "Footer from the bundle" },
    });
  });

  test("without one, the build is named as before", async () => {
    await ops(undefined)
      .fetchPatchesInternal({ excludePatchOps: true })
      .catch(() => {});
    const overlay = new URL(sent[0]!.url);
    expect(overlay.searchParams.get("job")).toBe("J-1");
    expect(overlay.searchParams.get("build")).toBe("base-build");
  });
});

describe("contentFromEnv", () => {
  test("names no version when the platform hands over none", () => {
    expect(contentFromEnv({})).toBeUndefined();
    expect(contentFromEnv({ VAL_CONTENT: "" })).toBeUndefined();
  });

  test("reads the version the platform hands over", () => {
    expect(
      contentFromEnv({
        VAL_CONTENT: JSON.stringify({
          id: ID,
          job: "J-7",
          commit: "c7",
          modules: { [PAGE]: { title: "x" } },
          files: { "app/page.val.ts": "text", "app/x.val.json": 3 },
        }),
      }),
    ).toEqual({
      id: ID,
      job: "J-7",
      commit: "c7",
      modules: { [PAGE]: { title: "x" } },
      files: { "app/page.val.ts": "text" },
    });
  });

  test("refuses a version it cannot read, rather than serve the bundle as though it were the version", () => {
    expect(() => contentFromEnv({ VAL_CONTENT: "{" })).toThrow(/VAL_CONTENT/);
    expect(() => contentFromEnv({ VAL_CONTENT: "[]" })).toThrow(/VAL_CONTENT/);
    expect(() =>
      contentFromEnv({ VAL_CONTENT: JSON.stringify({ job: null }) }),
    ).toThrow(/id/);
    expect(() =>
      contentFromEnv({
        VAL_CONTENT: JSON.stringify({ id: ID, modules: [], files: {} }),
      }),
    ).toThrow(/modules/);
  });

  test("refuses a version that names neither its job nor its commit: it would be placed at the build", () => {
    expect(() =>
      contentFromEnv({
        VAL_CONTENT: JSON.stringify({ id: ID, modules: {}, files: {} }),
      }),
    ).toThrow(/job or a commit/);
  });
});

/*
 * A version too large for one variable: the platform moves a module's Source,
 * or a file's text, into a variable of its own and names it under `refs`.
 * Out of band, never inside Source: content is text editors write, and a
 * reference resolved in there would read any variable the isolate holds --
 * `VAL_SECRET` included -- into a page. And only `VAL_CONTENT_<n>`, for the
 * same reason.
 */
describe("contentFromEnv with references", () => {
  const handed = (over: Record<string, unknown>) =>
    JSON.stringify({ id: ID, job: "J-7", commit: "c7", ...over });

  test("reads a module's Source and a file's text from the variables named", () => {
    expect(
      contentFromEnv({
        VAL_CONTENT: handed({
          modules: { [PAGE]: { title: "inline" } },
          files: {},
          refs: {
            modules: { [FOOTER]: "env://VAL_CONTENT_1" },
            files: { "app/x.val.json": "env://VAL_CONTENT_2" },
          },
        }),
        VAL_CONTENT_1: JSON.stringify({ text: "From a variable" }),
        VAL_CONTENT_2: '{"title":"Hello"}',
      }),
    ).toEqual({
      id: ID,
      job: "J-7",
      commit: "c7",
      modules: {
        [PAGE]: { title: "inline" },
        [FOOTER]: { text: "From a variable" },
      },
      files: { "app/x.val.json": '{"title":"Hello"}' },
    });
  });

  test("never resolves a reference inside Source", () => {
    expect(
      contentFromEnv({
        VAL_CONTENT: handed({
          modules: { [PAGE]: { title: "env://VAL_CONTENT_1" } },
          files: { "app/page.val.ts": "env://VAL_CONTENT_1" },
        }),
        VAL_CONTENT_1: JSON.stringify("resolved"),
      }),
    ).toEqual({
      id: ID,
      job: "J-7",
      commit: "c7",
      modules: { [PAGE]: { title: "env://VAL_CONTENT_1" } },
      files: { "app/page.val.ts": "env://VAL_CONTENT_1" },
    });
  });

  test("refuses to read any variable but VAL_CONTENT_<n>", () => {
    for (const name of [
      "VAL_SECRET",
      "VAL_CONTENT",
      "VAL_CONTENT_",
      "VAL_CONTENT_1x",
      "val_content_1",
    ]) {
      expect(() =>
        contentFromEnv({
          VAL_CONTENT: handed({
            refs: { modules: { [PAGE]: `env://${name}` } },
          }),
          VAL_SECRET: JSON.stringify({ title: "a secret" }),
          VAL_CONTENT_1x: "{}",
          val_content_1: "{}",
        }),
      ).toThrow(/VAL_CONTENT_<n>/);
    }
  });

  test("refuses a scheme it does not know, rather than skip the module", () => {
    expect(() =>
      contentFromEnv({
        VAL_CONTENT: handed({
          refs: { modules: { [PAGE]: "blob://" + "a".repeat(64) } },
        }),
      }),
    ).toThrow(/blob:\/\//);
  });

  test("refuses a reference to a variable that is not there", () => {
    expect(() =>
      contentFromEnv({
        VAL_CONTENT: handed({
          refs: { files: { "app/x.val.json": "env://VAL_CONTENT_3" } },
        }),
      }),
    ).toThrow(/VAL_CONTENT_3/);
  });

  test("refuses a referenced module that is not JSON", () => {
    expect(() =>
      contentFromEnv({
        VAL_CONTENT: handed({
          refs: { modules: { [PAGE]: "env://VAL_CONTENT_1" } },
        }),
        VAL_CONTENT_1: "{",
      }),
    ).toThrow(/VAL_CONTENT_1/);
  });

  test("refuses a path named both inline and by reference", () => {
    expect(() =>
      contentFromEnv({
        VAL_CONTENT: handed({
          modules: { [PAGE]: { title: "inline" } },
          refs: { modules: { [PAGE]: "env://VAL_CONTENT_1" } },
        }),
        VAL_CONTENT_1: JSON.stringify({ title: "referenced" }),
      }),
    ).toThrow(new RegExp(PAGE));
  });
});
