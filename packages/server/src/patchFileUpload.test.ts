import { ModuleFilePath, PatchId, initVal } from "@valbuild/core";
import { Script } from "node:vm";
import { transform } from "sucrase";
import { ValOpsFS } from "./ValOpsFS";
import fs from "fs";
import path from "node:path";
import os from "node:os";
import synchronizedPrettier from "@prettier/sync";
import { result } from "@valbuild/core/fp";

/**
 * Files in patches must be uploaded directly from the client. The `file` op left
 * in the patch carries a HASH of the bytes, never the bytes.
 *
 * These tests exist because the server does not enforce that, and cannot easily:
 * `createPatch` stores whatever a `file` op's `value` happens to be, and the only
 * thing that ever reads a `file` op's value is a null check — used to decide
 * whether to stamp `patch_id` onto the file source. The binary is read back from
 * the UPLOADED file and nowhere else.
 *
 * So base64 left in a `file` op is not a slower route to the same result. It is
 * dead weight that produces no file, and the failure is silent: the patch
 * applies, the source points at a path, and there is nothing there. The second
 * test below is that fact, pinned.
 *
 * The two PNGs are the smallest in the repo, the same pair `ValOpsFS.test.ts`
 * uses — 1x1 and 8x1.
 */
const smallPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";
const anotherSmallPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAABAQAAAADLe9LuAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";

const IMAGE_PATH = "/public/val/uploaded.png";
const MODULE = "/test/files.val.js" as ModuleFilePath;

function setup() {
  const { s, c, config } = initVal();
  const evalModule = (code: string) =>
    new Script(
      transform(code, { transforms: ["imports"] }).code,
    ).runInNewContext({
      exports: {},
      require: (requirePath: string) => {
        if (requirePath === "val.config") {
          return { s, c, config };
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(requirePath);
      },
      module: { exports: {} },
    });

  const source = synchronizedPrettier.format(
    `
    import { s, c } from "val.config";

    export default c.define(
      "${MODULE}",
      s.object({
        testImage: s.image(),
      }),
      {
        testImage: c.image("/public/val/initial.png", {
          width: 1,
          height: 1,
          mimeType: "image/png",
        }),
      },
    );
    `,
    { filepath: "test.val.js" },
  );

  // The OS temp dir, NOT the repo-local `.tmp`: `ValOpsFS.test.ts` does
  // `rmSync(".tmp", { recursive: true })` at the top of its run, and jest runs
  // suites in parallel workers — so a suite holding files under `.tmp` gets them
  // deleted underneath it. That is a ~12% flake when these two interleave, and
  // it presents as a bewildering "the file I just uploaded is gone".
  //
  // `prepareContinueOnError.test.ts`, `ValOpsFS.jsonValues.test.ts` and
  // `cli/src/debug/snapshotRoundTrip.test.ts` all carry the same warning.
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-file-upload-"));
  const absSource = path.join(rootDir, MODULE);
  fs.mkdirSync(path.dirname(absSource), { recursive: true });
  fs.writeFileSync(absSource, source);
  // The module's initial image has to exist on disk, or validation reports a
  // missing file and drowns out what these tests are about.
  const initial = path.join(rootDir, "/public/val/initial.png");
  fs.mkdirSync(path.dirname(initial), { recursive: true });
  fs.writeFileSync(initial, smallPng.split(",")[1], "base64");

  const ops = new ValOpsFS(
    process.env.VAL_CONTENT_URL || "http://localhost:4000",
    rootDir,
    {
      config,
      modules: [{ def: async () => ({ default: evalModule(source) }) }],
    },
    {
      formatter: (code, filePath) =>
        synchronizedPrettier.format(code, { filepath: filePath }),
      config,
    },
  );
  return { ops, rootDir };
}

/** The `replace` + `file` pair every image edit is made of. */
function imagePatch(fileOpValue: string | null) {
  return [
    {
      op: "replace" as const,
      path: ["testImage"],
      value: {
        _ref: IMAGE_PATH,
        _type: "file" as const,
        metadata: { width: 8, height: 1, mimeType: "image/png" },
      },
    },
    {
      op: "file" as const,
      path: ["testImage"],
      filePath: IMAGE_PATH,
      value: fileOpValue,
      remote: false,
    },
  ];
}

describe("patch file ops go through direct upload", () => {
  it("serves the binary from the uploaded file, with only a hash in the patch", async () => {
    const { ops } = setup();
    await ops.getSchemas();
    const patchId = crypto.randomUUID() as PatchId;
    const parentRef = {
      type: "head" as const,
      headBaseSha: await ops.getBaseSha(),
    };

    // 1. Upload the bytes, as the client does before sending the patch.
    const uploaded = await ops.saveBase64EncodedBinaryFileFromPatch(
      IMAGE_PATH,
      parentRef,
      patchId,
      anotherSmallPng,
      "image",
      { width: 8, height: 1, mimeType: "image/png" },
    );
    expect(uploaded.error).toBeUndefined();

    // 2. Send the patch with a HASH where the data would have been.
    const created = await ops.createPatch(
      MODULE,
      imagePatch("a-hash-not-the-bytes"),
      patchId,
      parentRef,
      null,
      null,
    );
    if (result.isErr(created)) {
      throw new Error(`createPatch failed: ${JSON.stringify(created.error)}`);
    }

    // The bytes come back from the upload, not from the patch.
    const readBack = await ops.getBase64EncodedBinaryFileFromPatch(
      IMAGE_PATH,
      patchId,
    );
    expect(readBack).not.toBeNull();
    expect(readBack?.toString("base64")).toEqual(anotherSmallPng.split(",")[1]);
  });

  /**
   * The regression guard for "never store the file as base64 in the file op".
   *
   * Same patch, same everything — except the upload never happened and the bytes
   * were put in the op instead. The patch is accepted, so nothing tells the
   * client it went wrong; the file simply is not there.
   */
  it("produces NO file when the bytes are in the patch and never uploaded", async () => {
    const { ops } = setup();
    await ops.getSchemas();
    const patchId = crypto.randomUUID() as PatchId;
    const parentRef = {
      type: "head" as const,
      headBaseSha: await ops.getBaseSha(),
    };

    const created = await ops.createPatch(
      MODULE,
      imagePatch(anotherSmallPng),
      patchId,
      parentRef,
      null,
      null,
    );
    // Accepted — which is the point. The server does not reject it.
    expect(result.isOk(created)).toBe(true);

    const readBack = await ops.getBase64EncodedBinaryFileFromPatch(
      IMAGE_PATH,
      patchId,
    );
    // And yet there is no file. The base64 in the patch bought nothing.
    expect(readBack).toBeNull();
  });

  /**
   * Two pending edits to the SAME path, chained as the client chains them.
   *
   * The draft file is stored under the dir for the patch's PARENT, and read back
   * by resolving that parent from the patch id — so the second edit has to parent
   * on the first, not on head, for the two to be distinguishable. Which is also
   * what the real client does: `parentRef` advances as patches sync.
   */
  it("keeps each upload separate for two chained patches on one path", async () => {
    const { ops } = setup();
    await ops.getSchemas();
    const first = crypto.randomUUID() as PatchId;
    const second = crypto.randomUUID() as PatchId;

    const headRef = {
      type: "head" as const,
      headBaseSha: await ops.getBaseSha(),
    };
    await ops.saveBase64EncodedBinaryFileFromPatch(
      IMAGE_PATH,
      headRef,
      first,
      smallPng,
      "image",
      { width: 1, height: 1, mimeType: "image/png" },
    );
    const createdFirst = await ops.createPatch(
      MODULE,
      imagePatch("hash-of-the-first"),
      first,
      headRef,
      null,
      null,
    );
    if (result.isErr(createdFirst)) {
      throw new Error("could not create the first patch");
    }

    const afterFirst = { type: "patch" as const, patchId: first };
    await ops.saveBase64EncodedBinaryFileFromPatch(
      IMAGE_PATH,
      afterFirst,
      second,
      anotherSmallPng,
      "image",
      { width: 8, height: 1, mimeType: "image/png" },
    );
    const createdSecond = await ops.createPatch(
      MODULE,
      imagePatch("hash-of-the-second"),
      second,
      afterFirst,
      null,
      null,
    );
    if (result.isErr(createdSecond)) {
      throw new Error("could not create the second patch");
    }

    // Each patch serves its own bytes. This is why the draft image URL carries a
    // patch id: two pending edits to one path must not become one.
    const fromFirst = await ops.getBase64EncodedBinaryFileFromPatch(
      IMAGE_PATH,
      first,
    );
    const fromSecond = await ops.getBase64EncodedBinaryFileFromPatch(
      IMAGE_PATH,
      second,
    );
    expect(fromFirst?.toString("base64")).toEqual(smallPng.split(",")[1]);
    expect(fromSecond?.toString("base64")).toEqual(
      anotherSmallPng.split(",")[1],
    );
  });

  it("accepts a delete, which has no upload at all", async () => {
    const { ops } = setup();
    await ops.getSchemas();
    const patchId = crypto.randomUUID() as PatchId;
    const parentRef = {
      type: "head" as const,
      headBaseSha: await ops.getBaseSha(),
    };

    const created = await ops.createPatch(
      MODULE,
      [
        {
          op: "file" as const,
          path: ["testImage"],
          filePath: IMAGE_PATH,
          value: null,
          remote: false,
        },
      ],
      patchId,
      parentRef,
      null,
      null,
    );
    expect(result.isOk(created)).toBe(true);
  });
});
