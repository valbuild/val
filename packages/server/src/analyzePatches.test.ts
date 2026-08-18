import { ModuleFilePath, PatchId, initVal, modules } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import { AuthorId, BaseSha, CommitSha, OrderedPatches } from "./ValOps";

const { s, c, config } = initVal();

function testOps() {
  return new ValOpsHttp(
    "https://content.example.com",
    "org/project",
    "commit1",
    "main",
    { apiKey: "test-api-key" },
    modules(config, [
      {
        def: () =>
          Promise.resolve({
            default: c.define(
              "/content/authors.val.ts",
              s.object({ name: s.string() }),
              { name: "Deployed" },
            ),
          }),
      },
    ]),
    { config },
  );
}

function patch(
  patchId: string,
  appliedAt: { commitSha: CommitSha } | null,
): OrderedPatches["patches"][number] {
  return {
    patchId: patchId as PatchId,
    path: "/content/authors.val.ts" as ModuleFilePath,
    patch: [{ op: "replace", path: ["name"], value: patchId }],
    baseSha: "base1" as BaseSha,
    createdAt: "2024-01-01T00:00:00.000Z",
    authorId: "author1" as AuthorId,
    appliedAt,
  };
}

describe("analyzePatches", () => {
  const uncommitted = patch("uncommitted", null);
  const committed = patch("committed", { commitSha: "commit2" as CommitSha });

  test("skips committed patches by default", () => {
    const analysis = testOps().analyzePatches([committed, uncommitted]);
    expect(
      analysis.patchesByModule["/content/authors.val.ts" as ModuleFilePath],
    ).toEqual([{ patchId: "uncommitted" }]);
  });

  test("includes committed patches with includeApplied", () => {
    const analysis = testOps().analyzePatches(
      [committed, uncommitted],
      undefined,
      undefined,
      { includeApplied: true },
    );
    // Order is preserved: the patches are applied in sequence.
    expect(
      analysis.patchesByModule["/content/authors.val.ts" as ModuleFilePath],
    ).toEqual([{ patchId: "committed" }, { patchId: "uncommitted" }]);
  });

  test("includeApplied: false is the same as the default", () => {
    const analysis = testOps().analyzePatches(
      [committed, uncommitted],
      undefined,
      undefined,
      { includeApplied: false },
    );
    expect(
      analysis.patchesByModule["/content/authors.val.ts" as ModuleFilePath],
    ).toEqual([{ patchId: "uncommitted" }]);
  });

  test("committed file ops are tracked too, so images resolve via patch_id", () => {
    const withFileOp: OrderedPatches["patches"][number] = {
      ...patch("filePatch", { commitSha: "commit2" as CommitSha }),
      patch: [
        {
          op: "file",
          path: ["image"],
          filePath: "/public/val/image.jpg",
          value: "data:image/jpeg;base64,...",
          remote: false,
        },
      ],
    };
    const analysis = testOps().analyzePatches(
      [withFileOp],
      undefined,
      undefined,
      {
        includeApplied: true,
      },
    );
    expect(analysis.fileLastUpdatedByPatchId["/public/val/image.jpg"]).toEqual({
      patchId: "filePatch",
      remote: false,
      isDelete: false,
    });
  });
});
