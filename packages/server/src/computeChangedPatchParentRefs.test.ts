import { ModuleFilePath, PatchId } from "@valbuild/core";
import { BaseSha, OrderedPatches } from "./ValOps";
import { computeChangedPatchParentRefs } from "./computeChangedPatchParentRefs";
import { Patch } from "@valbuild/core/patch";
import { ParentRef } from "@valbuild/shared/internal";

describe("compute changed patch parent refs", () => {
  test("deleted patch1", () => {
    const currentPatches: OrderedPatches["patches"] = [
      {
        patchId: "patch1" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch2" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch3" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch4" as PatchId,
        ...irrelevantProps,
      },
    ];
    const deletePatchIds: PatchId[] = ["patch1"] as PatchId[];
    const expectedChangedPatches: Record<string, ParentRef> = {
      patch2: {
        type: "head",
        headBaseSha: "sha1",
      },
    };
    const result = computeChangedPatchParentRefs(
      currentPatches,
      deletePatchIds,
    );
    expect(result.changedPatches).toEqual(expectedChangedPatches);
  });

  test("deleted patch3", () => {
    const currentPatches: OrderedPatches["patches"] = [
      {
        patchId: "patch1" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch2" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch3" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch4" as PatchId,
        ...irrelevantProps,
      },
    ];
    const deletePatchIds: PatchId[] = ["patch3"] as PatchId[];
    const expectedChangedPatches = {
      patch4: {
        type: "patch",
        patchId: "patch2",
      },
    };
    const result = computeChangedPatchParentRefs(
      currentPatches,
      deletePatchIds,
    );
    expect(result.changedPatches).toEqual(expectedChangedPatches);
  });

  test("deleted patch2, patch3", () => {
    const currentPatches: OrderedPatches["patches"] = [
      {
        patchId: "patch1" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch2" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch3" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch4" as PatchId,
        ...irrelevantProps,
      },
    ];
    const deletePatchIds: PatchId[] = ["patch2", "patch3"] as PatchId[];
    const expectedChangedPatches = {
      patch4: {
        type: "patch",
        patchId: "patch1",
      },
    };
    const result = computeChangedPatchParentRefs(
      currentPatches,
      deletePatchIds,
    );
    expect(result.changedPatches).toEqual(expectedChangedPatches);
  });

  test("deleted patch1, patch2", () => {
    const currentPatches: OrderedPatches["patches"] = [
      {
        patchId: "patch1" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch2" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch3" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch4" as PatchId,
        ...irrelevantProps,
      },
    ];
    const deletePatchIds: PatchId[] = ["patch1", "patch2"] as PatchId[];
    const expectedChangedPatches: Record<string, ParentRef> = {
      patch3: {
        type: "head",
        headBaseSha: "sha1",
      },
    };
    const result = computeChangedPatchParentRefs(
      currentPatches,
      deletePatchIds,
    );
    expect(result.changedPatches).toEqual(expectedChangedPatches);
  });

  test("no changes if last patch id is deleted", () => {
    const currentPatches: OrderedPatches["patches"] = [
      {
        patchId: "patch1" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch2" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch3" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch4" as PatchId,
        ...irrelevantProps,
      },
    ];
    const deletePatchIds: PatchId[] = ["patch4"] as PatchId[];
    const expectedChangedPatches = {};
    const result = computeChangedPatchParentRefs(
      currentPatches,
      deletePatchIds,
    );
    expect(result.changedPatches).toEqual(expectedChangedPatches);
  });

  test("no changes if several last patch id are deleted", () => {
    const currentPatches: OrderedPatches["patches"] = [
      {
        patchId: "patch1" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch2" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch3" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch4" as PatchId,
        ...irrelevantProps,
      },
    ];
    const deletePatchIds: PatchId[] = ["patch3", "patch4"] as PatchId[];
    const expectedChangedPatches = {};
    const result = computeChangedPatchParentRefs(
      currentPatches,
      deletePatchIds,
    );
    expect(result.changedPatches).toEqual(expectedChangedPatches);
  });

  test("no changes if last but one is deleted", () => {
    const currentPatches: OrderedPatches["patches"] = [
      {
        patchId: "patch1" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch2" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch3" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch4" as PatchId,
        ...irrelevantProps,
      },
    ];
    const deletePatchIds: PatchId[] = [
      "patch2",
      "patch3",
      "patch4",
    ] as PatchId[];
    const expectedChangedPatches = {};
    const result = computeChangedPatchParentRefs(
      currentPatches,
      deletePatchIds,
    );
    expect(result.changedPatches).toEqual(expectedChangedPatches);
  });

  test("no changes if all ids are deleted", () => {
    const currentPatches: OrderedPatches["patches"] = [
      {
        patchId: "patch1" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch2" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch3" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch4" as PatchId,
        ...irrelevantProps,
      },
    ];
    const deletePatchIds: PatchId[] = [
      "patch1",
      "patch2",
      "patch3",
      "patch4",
    ] as PatchId[];
    const expectedChangedPatches = {};
    const result = computeChangedPatchParentRefs(
      currentPatches,
      deletePatchIds,
    );
    expect(result.changedPatches).toEqual(expectedChangedPatches);
  });

  test("delete more than 1 before and more than 1 after", () => {
    const currentPatches: OrderedPatches["patches"] = [
      {
        patchId: "patch1" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch2" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch3" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch4" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch5" as PatchId,
        ...irrelevantProps,
      },
      {
        patchId: "patch6" as PatchId,
        ...irrelevantProps,
      },
    ];
    const deletePatchIds: PatchId[] = [
      "patch1",
      "patch2",
      "patch5",
      "patch6",
    ] as PatchId[];
    const expectedChangedPatches = {
      patch3: {
        type: "head",
        headBaseSha: "sha1",
      },
    };
    const result = computeChangedPatchParentRefs(
      currentPatches,
      deletePatchIds,
    );
    expect(result.changedPatches).toEqual(expectedChangedPatches);
  });
});

const patch: Patch = []; // irrelevant
const path = "/test.val.ts" as ModuleFilePath; // irrelevant
const createdAt = new Date().toISOString(); // irrelevant
const baseSha = "sha1" as BaseSha; // irrelevant
const appliedAt = null; // irrelevant
const authorId = null; // irrelevant
const irrelevantProps = {
  patch,
  path,
  createdAt,
  authorId,
  baseSha,
  appliedAt,
};
