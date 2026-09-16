import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import type { ParentRef } from "@valbuild/shared/internal";
import { ValOpsMemory } from "./ValOpsMemory";

const { s, c, config } = initVal();

const PATH = "/content/test.val.ts" as ModuleFilePath;
const valModules: ValModules = {
  config,
  modules: [
    {
      def: () =>
        Promise.resolve({
          default: c.define(PATH, s.string(), "hello"),
        }),
    },
  ],
};

const ops = () =>
  new ValOpsMemory(valModules, { config, sourceFiles: { [PATH]: "" } });

// A 1x1 PNG, as the browser produces it: FileReader.readAsDataURL.
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082",
  "hex",
);
const DATA_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
const META = { mimeType: "image/png", width: 1, height: 1 };

const PARENT = { type: "head", headBaseSha: "x" } as unknown as ParentRef;

describe("ValOpsMemory binary files", () => {
  test("an upload can be read back before its patch exists", async () => {
    /*
     * The ordering that shapes this. A patch's `file` op carries a HASH, not
     * the bytes, so the upload is its own request and arrives first -- the
     * record it belongs to is written afterwards. A store that rejected a file
     * for an unknown patch would reject every upload.
     */
    const o = ops();
    const patchId = crypto.randomUUID() as PatchId;

    const saved = await o.saveBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      PARENT,
      patchId,
      DATA_URL,
      "image",
      META,
    );
    expect(saved).toEqual({ patchId, filePath: "/public/val/photo.png" });

    const read = await o.getBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      patchId,
      false,
    );
    expect(read).not.toBeNull();
    // The BYTES, not a re-encoded data url: this is what /api/val/files serves.
    expect(read!.equals(PNG_BYTES)).toBe(true);
  });

  test("a null data url records a deletion", async () => {
    const o = ops();
    const patchId = crypto.randomUUID() as PatchId;
    await o.saveBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      PARENT,
      patchId,
      DATA_URL,
      "image",
      META,
    );
    await o.saveBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      PARENT,
      patchId,
      null,
      "image",
      undefined,
    );
    expect(
      await o.getBase64EncodedBinaryFileFromPatch(
        "/public/val/photo.png",
        patchId,
        false,
      ),
    ).toBeNull();
  });

  test("something that is not a data url is refused, not stored", async () => {
    const o = ops();
    const patchId = crypto.randomUUID() as PatchId;
    const res = await o.saveBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      PARENT,
      patchId,
      "not a data url",
      "image",
      META,
    );
    expect("error" in res).toBe(true);
    expect(
      await o.getBase64EncodedBinaryFileFromPatch(
        "/public/val/photo.png",
        patchId,
        false,
      ),
    ).toBeNull();
  });

  test("dropping a patch drops its bytes", async () => {
    // These are images. Keeping them after the only thing that can reach them
    // is gone is a leak with no reader, in a store that lives in memory.
    const o = ops();
    const patchId = crypto.randomUUID() as PatchId;
    await o.saveBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      PARENT,
      patchId,
      DATA_URL,
      "image",
      META,
    );
    await o.deletePatches([patchId]);
    expect(
      await o.getBase64EncodedBinaryFileFromPatch(
        "/public/val/photo.png",
        patchId,
        false,
      ),
    ).toBeNull();
  });

  test("two patches can hold different bytes for the same path", async () => {
    // The key is the pair. Keying by path alone would let a second edit of the
    // same image overwrite the first patch's bytes, so reverting one patch
    // would show the other's picture.
    const o = ops();
    const a = crypto.randomUUID() as PatchId;
    const b = crypto.randomUUID() as PatchId;
    const other = Buffer.from("different bytes entirely");

    await o.saveBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      PARENT,
      a,
      DATA_URL,
      "image",
      META,
    );
    await o.saveBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      PARENT,
      b,
      `data:image/png;base64,${other.toString("base64")}`,
      "image",
      META,
    );

    const fromA = await o.getBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      a,
      false,
    );
    const fromB = await o.getBase64EncodedBinaryFileFromPatch(
      "/public/val/photo.png",
      b,
      false,
    );
    expect(fromA!.equals(PNG_BYTES)).toBe(true);
    expect(fromB!.equals(other)).toBe(true);
  });

  test("a published local file is a miss, not a crash", async () => {
    // Remote files only: a published image is on the content host and the
    // source carries its URL, so there is nothing here to find. Callers read
    // this as "no such file", which is the truth.
    expect(await ops().getBinaryFile("/public/val/photo.png")).toBeNull();
  });
});
