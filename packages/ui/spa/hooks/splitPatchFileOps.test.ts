import { Internal } from "@valbuild/core";
import type { Patch } from "@valbuild/shared/internal";
import { hasUnuploadedFileData, splitPatchFileOps } from "./splitPatchFileOps";

/**
 * A patch must never carry binary data to the server. Files are uploaded
 * directly from the client and the `file` op left in the patch carries only a
 * hash.
 *
 * These are the smallest PNGs in the repo, the same two used by
 * `ValOpsFS.test.ts` — 1x1 and 8x1.
 */
const smallPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";
const anotherSmallPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAABAQAAAADLe9LuAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";

const textEncoder = new TextEncoder();
const hashOf = (data: string) =>
  Internal.getSHA256Hash(textEncoder.encode(data));

describe("splitPatchFileOps", () => {
  it("replaces file data with its hash and keeps the data for upload", () => {
    const patch: Patch = [
      {
        op: "replace",
        path: ["image"],
        value: {
          _ref: "/public/val/image.png",
          _type: "file",
          metadata: { width: 1, height: 1, mimeType: "image/png" },
        },
      },
      {
        op: "file",
        path: ["image"],
        filePath: "/public/val/image.png",
        value: smallPng,
        remote: false,
      },
    ];

    const { patchOps, fileOps } = splitPatchFileOps(patch);

    // What goes to the server.
    expect(patchOps).toHaveLength(2);
    const sentFileOp = patchOps[1];
    if (sentFileOp.op !== "file") {
      throw new Error("expected the file op to survive as a file op");
    }
    expect(sentFileOp.value).toBe(hashOf(smallPng));
    expect(sentFileOp.value).not.toContain("base64");
    // The non-file op is untouched.
    expect(patchOps[0]).toEqual(patch[0]);

    // What gets uploaded, with its bytes intact.
    expect(fileOps).toHaveLength(1);
    expect(fileOps[0].value).toBe(smallPng);
    expect(fileOps[0].filePath).toBe("/public/val/image.png");
  });

  it("leaves no binary data anywhere in the patch it produces", () => {
    const patch: Patch = [
      {
        op: "file",
        path: ["a"],
        filePath: "/public/val/a.png",
        value: smallPng,
        remote: false,
      },
      {
        op: "file",
        path: ["b"],
        filePath: "/public/val/b.png",
        value: anotherSmallPng,
        remote: false,
      },
    ];

    const { patchOps, fileOps } = splitPatchFileOps(patch);

    expect(hasUnuploadedFileData(patch)).toBe(true);
    expect(hasUnuploadedFileData(patchOps)).toBe(false);
    expect(JSON.stringify(patchOps)).not.toContain("base64");
    // Two distinct files must not collapse to one hash.
    expect(fileOps).toHaveLength(2);
    const hashes = patchOps.map((op) => (op.op === "file" ? op.value : null));
    expect(hashes[0]).not.toEqual(hashes[1]);
  });

  it("hashes the same bytes to the same value, and different bytes differently", () => {
    const opFor = (data: string): Patch => [
      {
        op: "file",
        path: ["image"],
        filePath: "/public/val/image.png",
        value: data,
        remote: false,
      },
    ];

    const first = splitPatchFileOps(opFor(smallPng)).patchOps[0];
    const again = splitPatchFileOps(opFor(smallPng)).patchOps[0];
    const other = splitPatchFileOps(opFor(anotherSmallPng)).patchOps[0];
    if (first.op !== "file" || again.op !== "file" || other.op !== "file") {
      throw new Error("expected file ops");
    }
    // Stable, or the hash could not identify which bytes an op meant.
    expect(first.value).toEqual(again.value);
    expect(first.value).not.toEqual(other.value);
  });

  /**
   * A delete. Hashing `null` would turn a removal into the addition of a file
   * whose bytes are the four characters `null`, and the server decides whether to
   * stamp `patch_id` by checking exactly this for null.
   */
  it("leaves a null value alone, so a delete stays a delete", () => {
    const patch: Patch = [
      { op: "remove", path: ["image"] },
      {
        op: "file",
        path: ["image"],
        filePath: "/public/val/image.png",
        value: null,
        remote: false,
      },
    ];

    const { patchOps, fileOps } = splitPatchFileOps(patch);

    const sent = patchOps[1];
    if (sent.op !== "file") {
      throw new Error("expected a file op");
    }
    expect(sent.value).toBeNull();
    // Still reported, so the caller can see the op exists and decide there is
    // nothing to upload for it.
    expect(fileOps).toHaveLength(1);
    expect(fileOps[0].value).toBeNull();
  });

  it("leaves a non-string value alone", () => {
    const patch: Patch = [
      {
        op: "file",
        path: ["image"],
        filePath: "/public/val/image.png",
        value: { alreadyStructured: true },
        remote: false,
      },
    ];

    const sent = splitPatchFileOps(patch).patchOps[0];
    if (sent.op !== "file") {
      throw new Error("expected a file op");
    }
    expect(sent.value).toEqual({ alreadyStructured: true });
  });

  /**
   * A remote file's `filePath` is a whole remote ref rather than a project path.
   * The split must not care: the upload step is what resolves the ref, and
   * hashing has to happen for remote files exactly as it does for local ones —
   * remote is the case where shipping the bytes through the patch would be most
   * expensive.
   */
  it("hashes remote file ops too, and preserves the remote ref and flag", () => {
    const remoteRef =
      "https://remote.val.build/file/p/abc123/b/bucket/v/1.2.3/h/deadbeef/f/public/val/image.png";
    const patch: Patch = [
      {
        op: "file",
        path: ["image"],
        filePath: remoteRef,
        value: smallPng,
        remote: true,
      },
    ];

    const { patchOps, fileOps } = splitPatchFileOps(patch);

    const sent = patchOps[0];
    if (sent.op !== "file") {
      throw new Error("expected a file op");
    }
    expect(sent.value).toBe(hashOf(smallPng));
    expect(sent.filePath).toBe(remoteRef);
    expect(sent.remote).toBe(true);
    expect(fileOps[0].value).toBe(smallPng);
    expect(fileOps[0].remote).toBe(true);
  });

  it("preserves nestedFilePath and metadata, which the server needs", () => {
    const patch: Patch = [
      {
        op: "file",
        path: ["richtext"],
        filePath: "/public/val/inline.png",
        // Richtext nests a file inside the document; this is how the server
        // finds the node to stamp `patch_id` onto.
        nestedFilePath: ["children", "0"],
        value: smallPng,
        metadata: { width: 1, height: 1, mimeType: "image/png" },
        remote: false,
      },
    ];

    const sent = splitPatchFileOps(patch).patchOps[0];
    if (sent.op !== "file") {
      throw new Error("expected a file op");
    }
    expect(sent.nestedFilePath).toEqual(["children", "0"]);
    expect(sent.metadata).toEqual({
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
  });

  it("passes a patch with no file ops through untouched", () => {
    const patch: Patch = [{ op: "replace", path: ["title"], value: "hello" }];
    const { patchOps, fileOps } = splitPatchFileOps(patch);
    expect(patchOps).toEqual(patch);
    expect(fileOps).toEqual([]);
    expect(hasUnuploadedFileData(patch)).toBe(false);
  });
});

describe("hasUnuploadedFileData", () => {
  it("does not flag a hashed file op", () => {
    const patch: Patch = [
      {
        op: "file",
        path: ["image"],
        filePath: "/public/val/image.png",
        value: hashOf(smallPng),
        remote: false,
      },
    ];
    expect(hasUnuploadedFileData(patch)).toBe(false);
  });

  it("does not flag a delete", () => {
    const patch: Patch = [
      {
        op: "file",
        path: ["image"],
        filePath: "/public/val/image.png",
        value: null,
        remote: false,
      },
    ];
    expect(hasUnuploadedFileData(patch)).toBe(false);
  });
});
