import type { PatchId } from "@valbuild/core";
import {
  commitCarriesFiles,
  commitCarriesRemoteFiles,
} from "./commitCarriesRemoteFiles";

/**
 * What `/save` asks before reading remote credentials. A text-only commit in
 * a project with `files: { remote: true }` was refused for want of a
 * `val login` token, because the question used to be asked of the schemas.
 */
const PATCH = "6f4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c" as PatchId;
const REMOTE_REF =
  "https://remote.val.build/file/p/pid/b/01/v/0.141.0/h/abcd/f/0123456789ab/p/public/val/hero.png";

describe("commitCarriesRemoteFiles", () => {
  test("a text-only commit uploads nothing, and needs no credentials", () => {
    const commit = { patchedBinaryFilesDescriptors: {} };
    expect(commitCarriesRemoteFiles(commit)).toBe(false);
    expect(commitCarriesFiles(commit)).toBe(false);
  });

  test("a commit with a local file uploads nothing remote", () => {
    const commit = {
      patchedBinaryFilesDescriptors: {
        "/public/val/hero.png": { patchId: PATCH, remote: false },
      },
    };
    expect(commitCarriesRemoteFiles(commit)).toBe(false);
    expect(commitCarriesFiles(commit)).toBe(true);
  });

  test("a commit with a remote file needs credentials", () => {
    const commit = {
      patchedBinaryFilesDescriptors: {
        "/public/val/notes.txt": { patchId: PATCH, remote: false },
        [REMOTE_REF]: { patchId: PATCH, remote: true },
      },
    };
    expect(commitCarriesRemoteFiles(commit)).toBe(true);
  });
});
