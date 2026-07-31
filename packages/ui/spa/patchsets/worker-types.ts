import type { SerializedPatchSet } from "../utils/PatchSets";
import type { ChangeTreeNode } from "../utils/computeChangedSourcePaths";

export type PatchSetsWorkerRequest = {
  type: "compute";
  id: string;
  patchSets: SerializedPatchSet;
};

export type PatchSetsWorkerResponse =
  | {
      type: "result";
      id: string;
      trees: ChangeTreeNode[];
    }
  | {
      type: "error";
      id: string;
      error: string;
    };
