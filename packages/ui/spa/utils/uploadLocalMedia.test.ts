import {
  Internal,
  ModuleFilePath,
  SerializedRecordSchema,
} from "@valbuild/core";
import {
  buildLocalMediaUploadPatches,
  isStudioUploadFix,
  LocalMediaUploadTarget,
} from "./uploadLocalMedia";

const SHA = "bfbd0a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f";
const BYTES = { dataUrl: "data:image/png;base64,AAAA", sha256: SHA };
const REMOTE = {
  publicProjectId: "3f9a2c1",
  bucket: "r2",
  coreVersion: "0.148.1",
  remoteHost: "https://3f9a2c1.valstart.dev/_val",
};
const IMAGES = "/src/media/images.val.ts" as ModuleFilePath;
const PAGE = "/src/routes/_site.index.val.ts" as ModuleFilePath;
const LOCAL = "/public/val/images/hero-dusk.png";
const ENTRY = {
  width: 2400,
  height: 1200,
  mimeType: "image/png",
  alt: "Hills",
};

const RECORD: SerializedRecordSchema = {
  type: "record",
  item: {
    type: "object",
    items: {},
    opt: false,
  },
  opt: false,
  mediaType: "images",
  accept: "image/*",
  dir: "/public/val/images",
};

function sourcePath(moduleFilePath: ModuleFilePath, ...segments: string[]) {
  return Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.patchPathToModulePath(segments),
  );
}

function galleryTarget(
  overrides: Partial<
    Extract<LocalMediaUploadTarget, { kind: "gallery-entry" }>
  > = {},
): LocalMediaUploadTarget {
  return {
    kind: "gallery-entry",
    moduleFilePath: IMAGES,
    patchPath: [],
    key: LOCAL,
    record: RECORD,
    entry: ENTRY,
    existingKeys: [LOCAL],
    referrers: [],
    ...overrides,
  };
}

function ok(target: LocalMediaUploadTarget) {
  const res = buildLocalMediaUploadPatches({
    target,
    bytes: BYTES,
    remote: REMOTE,
  });
  if (res.status !== "ok") throw new Error(res.message);
  return res.patches;
}

describe("uploading a local file from the Studio", () => {
  test("every upload-remote code, and nothing else", () => {
    expect(isStudioUploadFix("images:upload-remote")).toBe(true);
    expect(isStudioUploadFix("file:upload-remote")).toBe(true);
    expect(isStudioUploadFix("videos:upload-remote")).toBe(true);
    expect(isStudioUploadFix("image:download-remote")).toBe(false);
    expect(isStudioUploadFix("image:check-metadata")).toBe(false);
  });

  test("a gallery entry is renamed to the ref, and carries the bytes", () => {
    const { ref, primary, referrers } = ok(galleryTarget());
    const parts = Internal.remote.splitRemoteRef(ref);
    expect(parts).toMatchObject({
      status: "success",
      remoteHost: REMOTE.remoteHost,
      projectId: REMOTE.publicProjectId,
      bucket: REMOTE.bucket,
      version: REMOTE.coreVersion,
      fileHash: SHA.slice(0, 12),
      filePath: "public/val/images/hero-dusk.png",
    });
    expect(primary).toEqual({
      moduleFilePath: IMAGES,
      patch: [
        { op: "move", from: [LOCAL], path: [ref] },
        {
          op: "file",
          path: [ref],
          filePath: ref,
          value: BYTES.dataUrl,
          remote: true,
          metadata: { width: 2400, height: 1200, mimeType: "image/png" },
        },
      ],
    });
    expect(referrers).toEqual([]);
  });

  test("the ref is hashed as `val validate --fix` hashes it: the record's accept and dir", () => {
    // `handleRemoteGalleryFileUpload`'s schema. A different one bakes a
    // validation hash the CLI and the check never agree with.
    const { ref } = ok(galleryTarget());
    const expected = Internal.remote.getValidationHash(
      REMOTE.coreVersion,
      {
        type: "image",
        opt: false,
        options: { accept: "image/*", dir: "/public/val/images" },
      },
      "png",
      ENTRY,
      SHA.slice(0, 12),
      new TextEncoder(),
    );
    const parts = Internal.remote.splitRemoteRef(ref);
    expect(parts.status === "success" && parts.validationHash).toBe(expected);
  });

  test("every field that picked the entry is pointed at the ref, one patch per module", () => {
    const hero = sourcePath(PAGE, "hero", "image");
    const body = sourcePath(PAGE, "body", "0", "children", "1", "src");
    const { ref, referrers } = ok(
      galleryTarget({
        referrers: [
          { sourcePath: hero, path: LOCAL, hasPatchId: false },
          { sourcePath: body, path: LOCAL, hasPatchId: true },
        ],
      }),
    );
    expect(referrers).toEqual([
      {
        moduleFilePath: PAGE,
        patch: [
          { op: "replace", path: ["hero", "image", "path"], value: ref },
          {
            op: "replace",
            path: ["body", "0", "children", "1", "src", "path"],
            value: ref,
          },
          // A draft reads its URL off its own patch id: it gets the bytes too.
          expect.objectContaining({
            op: "file",
            path: ["body", "0", "children", "1", "src"],
            filePath: ref,
            remote: true,
          }),
        ],
      },
    ]);
  });

  test("a field of its own gets the ref as its path", () => {
    const { ref, primary } = ok({
      kind: "field",
      moduleFilePath: PAGE,
      patchPath: ["hero"],
      schema: { type: "image", opt: false, remote: true },
      value: { path: LOCAL, width: 8, height: 8, mimeType: "image/png" },
    });
    expect(primary.patch).toEqual([
      { op: "replace", path: ["hero", "path"], value: ref },
      {
        op: "file",
        path: ["hero"],
        filePath: ref,
        value: BYTES.dataUrl,
        remote: true,
        metadata: { width: 8, height: 8, mimeType: "image/png" },
      },
    ]);
  });

  test("a file Val does not know the size of is refused, with what to do", () => {
    const res = buildLocalMediaUploadPatches({
      target: galleryTarget({ entry: { alt: null } }),
      bytes: BYTES,
      remote: REMOTE,
    });
    expect(res).toEqual({
      status: "error",
      message: expect.stringContaining("Open it and save it again"),
    });
  });

  test("a path outside /public is refused rather than guessed at", () => {
    const res = buildLocalMediaUploadPatches({
      target: galleryTarget({ key: "/images/hero.png" }),
      bytes: BYTES,
      remote: REMOTE,
    });
    expect(res.status).toBe("error");
  });
});
