import type { PatchId } from "@valbuild/core";
import type { SerializedPatchSet } from "../utils/PatchSets";
import type { ChangeTreeNode } from "../utils/computeChangedSourcePaths";

export type PatchSetsWorkerRequest = {
  type: "compute";
  id: string;
  patchSets: SerializedPatchSet;
  /**
   * Patches that have already shipped in a commit.
   *
   * An array rather than the `ReadonlySet` the computation wants, because a Set
   * survives `postMessage` but says nothing about order and costs more to clone;
   * the worker rebuilds the set on arrival. Absent on a request from a client
   * that has not published anything.
   */
  committedPatchIds?: PatchId[];
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
