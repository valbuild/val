import { PatchId, ModuleFilePath, initVal } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import { OrderedPatches, OrderedPatchesMetadata } from "./ValOps";

const { config } = initVal();

const patchOf = (n: number): OrderedPatches["patches"][number] => ({
  path: "/content/page.val.ts" as ModuleFilePath,
  patchId: `patch-${n}` as PatchId,
  patch: [{ op: "replace", path: ["title"], value: `v${n}` }],
  createdAt: new Date(2026, 0, 1, 0, 0, n).toISOString(),
  authorId: null,
  baseSha: "base" as OrderedPatches["patches"][number]["baseSha"],
  appliedAt: null,
});

/**
 * The content api's /applicable/patches returns every applicable patch per
 * request and ignores the patch_id filter. fetchPatches chunks the ids purely
 * to keep the query string short, so concatenating the chunk responses used to
 * repeat the whole chain once per chunk - and prepare() then applied every
 * patch that many times, corrupting arrays and failing the commit.
 *
 * Invisible below the chunk size, which is why it only showed up on a project
 * with a few hundred pending patches.
 */
describe("ValOpsHttp.fetchPatches chunking", () => {
  const opsWithApi = (
    everyApplicablePatch: OrderedPatches["patches"],
    onRequest: (requested: PatchId[] | undefined) => void,
  ) => {
    const ops = new ValOpsHttp(
      "https://content.example",
      "org/project",
      "commit",
      "main",
      { apiKey: "test" },
      { config, modules: [] },
      { config },
    );
    ops.fetchPatchesInternal = async <
      ExcludePatchOps extends boolean,
    >(filters: {
      patchIds?: PatchId[];
      excludePatchOps: ExcludePatchOps;
    }) => {
      onRequest(filters.patchIds);
      // The api ignores patchIds and hands back the whole applicable set.
      // Cast for the same reason the real implementation does: the return type
      // is conditional on a generic TS cannot narrow from the value.
      return { patches: everyApplicablePatch } as ExcludePatchOps extends true
        ? OrderedPatchesMetadata
        : OrderedPatches;
    };
    return ops;
  };

  test("returns each requested patch exactly once, in api order", async () => {
    const allPatches = Array.from({ length: 217 }, (_, i) => patchOf(i));
    const requests: (PatchId[] | undefined)[] = [];
    const ops = opsWithApi(allPatches, (requested) => requests.push(requested));

    const res = await ops.fetchPatches({
      patchIds: allPatches.map((patch) => patch.patchId),
      excludePatchOps: false,
    });

    // 217 ids is 3 chunks of 100/100/17, so the raw concatenation would be 651.
    expect(requests).toHaveLength(3);
    expect(res.patches).toHaveLength(217);
    expect(res.patches.map((patch) => patch.patchId)).toEqual(
      allPatches.map((patch) => patch.patchId),
    );
  });

  test("returns only the patches that were asked for", async () => {
    const allPatches = Array.from({ length: 150 }, (_, i) => patchOf(i));
    const ops = opsWithApi(allPatches, () => {});

    const res = await ops.fetchPatches({
      patchIds: [patchOf(3).patchId, patchOf(120).patchId],
      excludePatchOps: false,
    });

    expect(res.patches.map((patch) => patch.patchId)).toEqual([
      "patch-3",
      "patch-120",
    ]);
  });

  test("a single chunk is unaffected", async () => {
    const allPatches = Array.from({ length: 42 }, (_, i) => patchOf(i));
    const requests: (PatchId[] | undefined)[] = [];
    const ops = opsWithApi(allPatches, (requested) => requests.push(requested));

    const res = await ops.fetchPatches({
      patchIds: allPatches.map((patch) => patch.patchId),
      excludePatchOps: false,
    });

    expect(requests).toHaveLength(1);
    expect(res.patches).toHaveLength(42);
  });

  test("no patchIds still asks the api for everything applicable", async () => {
    const allPatches = Array.from({ length: 5 }, (_, i) => patchOf(i));
    const requests: (PatchId[] | undefined)[] = [];
    const ops = opsWithApi(allPatches, (requested) => requests.push(requested));

    const res = await ops.fetchPatches({
      patchIds: undefined,
      excludePatchOps: false,
    });

    // One request with no patch_id params at all, so the api decides what is
    // applicable.
    expect(requests).toEqual([[]]);
    expect(res.patches).toHaveLength(5);
  });
});
