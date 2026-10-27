import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import type { Operation, Patch } from "@valbuild/core/patch";
import type { ParentRef } from "@valbuild/shared/internal";
import { ValOpsMemory } from "./ValOpsMemory";

/**
 * A patch's `file` ops become a `patch_id` on the value whose bytes they
 * carry, which is what makes `mediaUrl` serve a draft from the patch store.
 *
 * A video names up to three kinds of file in ONE object — the video, its
 * poster and each caption track — and the Studio uploads them in ONE patch,
 * every `file` op on the video's own path, told apart by `nestedFilePath`.
 * The injected ops were keyed by the field's path alone, so the last one won:
 * the video kept its patch_id and its poster did not (or the other way round),
 * and the one left out was looked for at a published URL that holds nothing.
 */
const { s, c, config } = initVal();
const PATH = "/content/video.val.ts" as ModuleFilePath;
const schema = s.object({ intro: s.video().nullable() });
const valModules: ValModules = {
  config,
  modules: [
    {
      def: () =>
        Promise.resolve({ default: c.define(PATH, schema, { intro: null }) }),
    },
  ],
};
const PARENT = { type: "head", headBaseSha: "x" } as unknown as ParentRef;

async function sourcesAfter(patch: Patch) {
  const ops = new ValOpsMemory(valModules, {
    config,
    sourceFiles: { [PATH]: "" },
  });
  const patchId = crypto.randomUUID() as PatchId;
  await ops.createPatch(PATH, patch, patchId, PARENT, null, null);
  const fetched = await ops.fetchPatches({ excludePatchOps: false });
  const analysis = ops.analyzePatches(fetched.patches);
  const { sources } = await ops.getSources({ ...analysis, ...fetched });
  return { source: sources[PATH], patchId };
}

describe("file ops on one video", () => {
  test("the video, its poster and each caption track each get the patch_id", async () => {
    const { source, patchId } = await sourcesAfter([
      {
        op: "replace",
        path: ["intro"],
        value: {
          path: "/public/val/intro_abc12.mp4",
          mimeType: "video/mp4",
          poster: { path: "/public/val/intro-poster_def34.jpg" },
          captions: [
            { path: "/public/val/intro.en_aaaaa.vtt", srclang: "en" },
            { path: "/public/val/intro.nb_bbbbb.vtt", srclang: "nb" },
          ],
        },
      },
      {
        op: "file",
        path: ["intro"],
        filePath: "/public/val/intro_abc12.mp4",
        value: "sha-of-video",
        remote: false,
      },
      {
        op: "file",
        path: ["intro"],
        nestedFilePath: ["poster"],
        filePath: "/public/val/intro-poster_def34.jpg",
        value: "sha-of-poster",
        remote: false,
      },
      {
        op: "file",
        path: ["intro"],
        nestedFilePath: ["captions", "0"],
        filePath: "/public/val/intro.en_aaaaa.vtt",
        value: "sha-of-en",
        remote: false,
      },
      {
        op: "file",
        path: ["intro"],
        nestedFilePath: ["captions", "1"],
        filePath: "/public/val/intro.nb_bbbbb.vtt",
        value: "sha-of-nb",
        remote: false,
      },
    ]);
    expect(source).toEqual({
      intro: {
        path: "/public/val/intro_abc12.mp4",
        mimeType: "video/mp4",
        patch_id: patchId,
        poster: {
          path: "/public/val/intro-poster_def34.jpg",
          patch_id: patchId,
        },
        captions: [
          {
            path: "/public/val/intro.en_aaaaa.vtt",
            srclang: "en",
            patch_id: patchId,
          },
          {
            path: "/public/val/intro.nb_bbbbb.vtt",
            srclang: "nb",
            patch_id: patchId,
          },
        ],
      },
    });
  });

  test("replacing only the poster drafts only the poster", async () => {
    const { source, patchId } = await sourcesAfter([
      {
        op: "replace",
        path: ["intro"],
        value: {
          path: "/public/val/intro_abc12.mp4",
          mimeType: "video/mp4",
          poster: { path: "/public/val/intro-poster_def34.jpg" },
        },
      },
      {
        op: "file",
        path: ["intro"],
        nestedFilePath: ["poster"],
        filePath: "/public/val/intro-poster_def34.jpg",
        value: "sha-of-poster",
        remote: false,
      },
    ]);
    expect(source).toEqual({
      intro: {
        path: "/public/val/intro_abc12.mp4",
        mimeType: "video/mp4",
        poster: {
          path: "/public/val/intro-poster_def34.jpg",
          patch_id: patchId,
        },
      },
    });
  });

  test("an HLS stream's many files on the video's own path are one patch_id", async () => {
    const { source, patchId } = await sourcesAfter([
      {
        op: "replace",
        path: ["intro"],
        value: {
          path: "/public/val/intro_abc12/master.m3u8",
          mimeType: "application/vnd.apple.mpegurl",
        },
      },
      ...["master.m3u8", "720p.m3u8", "720p.mp4"].map(
        (name): Operation => ({
          op: "file",
          path: ["intro"],
          filePath: `/public/val/intro_abc12/${name}`,
          value: `sha-of-${name}`,
          remote: false,
        }),
      ),
    ]);
    expect(source).toEqual({
      intro: {
        path: "/public/val/intro_abc12/master.m3u8",
        mimeType: "application/vnd.apple.mpegurl",
        patch_id: patchId,
      },
    });
  });
});
