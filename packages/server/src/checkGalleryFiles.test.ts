import path from "path";
import { Internal } from "@valbuild/core";
import { checkGalleryFiles } from "./fixHandlers";

/**
 * What a gallery's entries and its directory disagree about.
 *
 * The case worth having tests for is the remote one, and it is worth saying why
 * it is not symmetric with the local one. A remote entry's bytes are on the
 * content host: `saveOrUploadFiles` uploads the remote descriptors and copies
 * only the local ones into the working tree, so a remote entry added through
 * the Studio never has a local file — while one promoted from a local file by
 * `val validate --fix` does, because that file was already there and stays.
 *
 * So "missing" cannot be asked of a remote entry, and "untracked" has to be.
 */

const PROJECT_ROOT = "/project";

/** Just enough of `IValFSHost` for these two checks. */
function fakeFs(filesOnDisk: string[]) {
  const absolute = new Set(filesOnDisk.map((f) => path.join(PROJECT_ROOT, f)));
  return {
    fileExists: (fileName: string) => absolute.has(fileName),
    readDirectory: (dir: string) => {
      const inDir = [...absolute].filter((f) => f.startsWith(dir + path.sep));
      if (inDir.length === 0) {
        // The real host throws for a directory that is not there, and the
        // handler reads that as "nothing untracked" rather than as a failure.
        throw new Error(`ENOENT: ${dir}`);
      }
      return inDir;
    },
  };
}

function remoteRef(localPath: `public/${string}`): string {
  return Internal.remote.createRemoteRef("https://remote.val.build", {
    publicProjectId: "pub-1",
    coreVersion: "1.0.0",
    bucket: "01",
    validationHash: "abcd",
    fileHash: "0123456789ab",
    filePath: localPath,
  });
}

describe("a remote key that does not parse", () => {
  /**
   * The case Copilot's review caught, and it is the same failure this module
   * exists to prevent, arriving through the back door.
   *
   * `splitRemoteRef` rejects any URL that is not exactly a ref: truncated by a
   * hand edit, a path outside `public/`, a `..` segment, or written by a core
   * version whose format it does not accept. Read as a LOCAL path, such a key
   * sends the missing-file check looking for `<projectRoot>/https://…`, finds
   * nothing, and `--fix` deletes the entry — at the one moment that key is the
   * only remaining record of where the bytes went.
   *
   * The malformed key is not being swept under the rug: the record schema
   * reports it as "Invalid remote URL format", which is an error for a person,
   * not a file for `--fix` to go missing.
   */
  it.each([
    ["truncated", "https://remote.val.build/file/p/pub-1/b/01"],
    [
      "a path outside public/",
      "https://remote.val.build/file/p/pub-1/b/01/v/1.0.0/h/abcd/f/0123456789ab/p/elsewhere/x.png",
    ],
    ["not a ref at all", "https://example.com/x.png"],
  ])("is never reported missing (%s)", (_why, key) => {
    const result = checkGalleryFiles({
      entryKeys: [key],
      directory: "/public/img",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs([]),
    });

    expect(result.missingTrackedFiles).toEqual([]);
  });

  it("does not claim a local file in the directory", () => {
    // The flip side: a URL key tracks nothing on disk, so a real file sitting
    // beside it is still untracked and still reported.
    const result = checkGalleryFiles({
      entryKeys: ["https://remote.val.build/file/p/pub-1/b/01"],
      directory: "/public/img",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs(["/public/img/unclaimed.png"]),
    });

    expect(result.missingTrackedFiles).toEqual([]);
    expect(result.untrackedFiles).toEqual(["/public/img/unclaimed.png"]);
  });

  it("a plain relative path is still local, so it is still checked", () => {
    // The guard is scoped to URLs. Anything else keeps the old behaviour, or
    // the fix would make every missing local file invisible.
    const result = checkGalleryFiles({
      entryKeys: ["/public/img/gone.png"],
      directory: "/public/img",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs([]),
    });

    expect(result.missingTrackedFiles).toEqual(["/public/img/gone.png"]);
  });
});

describe("local entries", () => {
  it("reports one whose file is not on disk", () => {
    const result = checkGalleryFiles({
      entryKeys: ["/public/img/there.png", "/public/img/gone.png"],
      directory: "/public/img",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs(["/public/img/there.png"]),
    });

    expect(result.missingTrackedFiles).toEqual(["/public/img/gone.png"]);
    expect(result.untrackedFiles).toEqual([]);
  });

  it("reports a file in the directory that no entry claims", () => {
    const result = checkGalleryFiles({
      entryKeys: ["/public/img/tracked.png"],
      directory: "/public/img",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs(["/public/img/tracked.png", "/public/img/stray.png"]),
    });

    expect(result.missingTrackedFiles).toEqual([]);
    expect(result.untrackedFiles).toEqual(["/public/img/stray.png"]);
  });

  it("is happy when the two agree", () => {
    const result = checkGalleryFiles({
      entryKeys: ["/public/img/a.png", "/public/img/b.png"],
      directory: "/public/img",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs(["/public/img/a.png", "/public/img/b.png"]),
    });

    expect(result).toEqual({ missingTrackedFiles: [], untrackedFiles: [] });
  });
});

describe("remote entries", () => {
  it("does not ask a remote entry for a local file", () => {
    // The regression this is here for. Publishing a remote image uploads it to
    // the content host and puts nothing in the working tree, so demanding a
    // local copy reported every published remote image as missing — and
    // `--fix` on that removes the entry, deleting the reference to a file that
    // is perfectly fine where it is.
    const result = checkGalleryFiles({
      entryKeys: [remoteRef("public/remote-images/photo.png")],
      directory: "/public/remote-images",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs([]),
    });

    expect(result).toEqual({ missingTrackedFiles: [], untrackedFiles: [] });
  });

  it("still claims the local file when there is one", () => {
    // `val validate --fix` promotes a local file to a remote ref and leaves the
    // file where it was. It is claimed by an entry, so it is not untracked —
    // which is what normalising the ref back to its local path is for.
    const result = checkGalleryFiles({
      entryKeys: [remoteRef("public/remote-images/photo.png")],
      directory: "/public/remote-images",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs(["/public/remote-images/photo.png"]),
    });

    expect(result).toEqual({ missingTrackedFiles: [], untrackedFiles: [] });
  });

  it("still reports an unclaimed file beside a remote entry", () => {
    const result = checkGalleryFiles({
      entryKeys: [remoteRef("public/remote-images/photo.png")],
      directory: "/public/remote-images",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs(["/public/remote-images/stray.png"]),
    });

    expect(result.untrackedFiles).toEqual(["/public/remote-images/stray.png"]);
  });

  it("judges each entry on its own", () => {
    // A gallery mid-migration holds both. The local one is still answerable for
    // its bytes; the remote one is not.
    const result = checkGalleryFiles({
      entryKeys: [
        remoteRef("public/img/uploaded.png"),
        "/public/img/not-yet.png",
      ],
      directory: "/public/img",
      projectRoot: PROJECT_ROOT,
      fs: fakeFs([]),
    });

    expect(result.missingTrackedFiles).toEqual(["/public/img/not-yet.png"]);
  });
});
