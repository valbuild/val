import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { splitJobPrepare } from "./jobPrepare";

const { s } = initVal();
const schema = s.object({ t: s.string() })["executeSerialize"]();
const mod = (path: string) => path as ModuleFilePath;
const patch = (id: string) => id as PatchId;

describe("a publish job's prepare, split", () => {
  const chainOnly = {
    patchedSourceFiles: {
      "/content/a.val.ts": "a as published",
      "/content/b.val.ts": "b as published",
    },
  };
  const withJob = {
    patchedSourceFiles: {
      "/content/a.val.ts": "a as published", // not touched by the job
      "/content/b.val.ts": "b, edited by the job",
      "/content/posts/new.val.json": '{"title":"new"}', // written by the job
    },
    patchedBinaryFilesDescriptors: {
      "/public/val/old.png": { patchId: patch("p0"), remote: false },
      "/public/val/new.png": { patchId: patch("p2"), remote: false },
    },
    moduleVersions: {
      [mod("/content/a.val.ts")]: {
        source: { t: "a" },
        schema,
      },
      [mod("/content/b.val.ts")]: {
        source: { t: "b2" },
        schema,
      },
    },
    appliedPatches: {
      [mod("/content/a.val.ts")]: [patch("p0")], // committed since this build
      [mod("/content/b.val.ts")]: [patch("p0"), patch("p2")],
    },
  };

  test("the build gets every file of the job's content", () => {
    const split = splitJobPrepare({ chainOnly, withJob, jobPatchIds: ["p2"] });
    expect(split.buildSourceFiles).toEqual(withJob.patchedSourceFiles);
  });

  test("the archive gets only what the job changes", () => {
    const { archive } = splitJobPrepare({
      chainOnly,
      withJob,
      jobPatchIds: ["p2"],
    });
    expect(archive.patchedSourceFiles).toEqual({
      "/content/b.val.ts": "b, edited by the job",
      // a file under another path than its module's, found by comparing
      "/content/posts/new.val.json": '{"title":"new"}',
    });
    expect(Object.keys(archive.patchedBinaryFilesDescriptors)).toEqual([
      "/public/val/new.png",
    ]);
    expect(Object.keys(archive.modules)).toEqual(["/content/b.val.ts"]);
  });

  test("a deletion is a change too", () => {
    const { archive } = splitJobPrepare({
      chainOnly,
      withJob: {
        ...withJob,
        patchedSourceFiles: {
          ...chainOnly.patchedSourceFiles,
          "/content/a.val.ts": null,
        },
      },
      jobPatchIds: ["p2"],
    });
    expect(archive.patchedSourceFiles).toEqual({ "/content/a.val.ts": null });
  });
});
