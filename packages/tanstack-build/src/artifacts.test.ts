import { ARTIFACT_PREFIXES, publishArtifacts } from "./artifacts";
import type { BuildOutput } from "./build";

/**
 * The artifact key namespace, which used to be written down three times.
 *
 * What these pin is the mapping content's `loaderPayload.ts` reads back: a
 * chunk filed under the wrong prefix does not fail at publish, it fails at
 * isolate startup with a missing export naming neither package nor version.
 */

const build = (overrides: Partial<BuildOutput> = {}): BuildOutput => ({
  serverCode: "export default 1",
  clientCode: "console.log(1)",
  serverChunks: {},
  clientChunks: {},
  publicFiles: {},
  assetFiles: {},
  cssCode: "",
  linksOwnCss: false,
  hash: "abc",
  vendorRev: "rev",
  timings: { server: 0, client: 0, tailwind: 0, total: 0 },
  warnings: [],
  ...overrides,
});

const keys = async (output: BuildOutput) =>
  (await publishArtifacts(output)).map((artifact) => artifact.key).sort();

describe("what a build declares", () => {
  test("the two bundles every publish must have", async () => {
    expect(await keys(build())).toEqual(["client", "server"]);
  });

  test("a project with no stylesheet has no css artifact", async () => {
    // Not an empty one: `loaderPayload.ts` decides whether the build links its
    // own CSS by asking whether the key is there at all, so uploading an empty
    // artifact would claim a stylesheet that does not exist.
    expect(await keys(build({ cssCode: "" }))).not.toContain("css");
    expect(await keys(build({ cssCode: "a{}" }))).toContain("css");
  });

  test("each record lands under its own prefix", async () => {
    expect(
      await keys(
        build({
          serverChunks: { "a.js": "1" },
          clientChunks: { "b.js": "2" },
          rscChunks: { "c.js": "3" },
          assetFiles: { "logo-x1.png": "base64" },
          publicFiles: { "favicon.ico": "base64" },
          rscCode: "rsc",
        }),
      ),
    ).toEqual([
      "asset/logo-x1.png",
      "chunk/client/b.js",
      "chunk/rsc/c.js",
      "chunk/server/a.js",
      "client",
      "public/favicon.ico",
      "rsc",
      "server",
    ]);
  });

  test("a nested public path keeps every segment", async () => {
    // An asset is addressed by the path the built code imports it at. A name
    // that gets normalised here produces a bundle whose imports resolve to
    // nothing, in the isolate, at runtime.
    expect(
      await keys(build({ publicFiles: { "val/logo.svg": "x" } })),
    ).toContain(`${ARTIFACT_PREFIXES.publicFiles}val/logo.svg`);
  });
});

describe("what content checks each artifact against", () => {
  test("bytes is the encoded length, not the string length", async () => {
    /*
     * The one that would have been silent. Content compares this against what
     * object storage received; a string's `.length` counts UTF-16 code units,
     * so one accented word in a page's markup makes the two disagree and the
     * publish is refused for a size mismatch that names no file.
     */
    const [artifact] = await publishArtifacts(
      build({ serverCode: "é", clientCode: "x" }),
    );
    const server = (await publishArtifacts(build({ serverCode: "é" }))).find(
      (candidate) => candidate.key === "server",
    );
    expect(artifact).toBeDefined();
    expect(server?.body).toBe("é");
    expect(server?.body.length).toBe(1);
    expect(server?.bytes).toBe(2);
  });

  test("the hash is of the bytes that are uploaded", async () => {
    const [artifact] = await publishArtifacts(
      build({ serverCode: "", clientCode: "hello" }),
    );
    // sha256("hello"), so a change to how the body is derived shows up here
    // rather than as an artifact content rejects after uploading it.
    expect(artifact?.key).toBe("client");
    expect(artifact?.sha256).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});
