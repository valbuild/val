import type { ModuleFilePath, PatchId, SerializedSchema } from "@valbuild/core";
import type { JSONValue, Operation } from "@valbuild/core/patch";

/**
 * Publishing a proposal as a pull request is merged: valbuild/home
 * `docs/hosted-publishing.md`, step 8.2.
 *
 * Val's half of it, because it is the half that needs the schema: the
 * three-way merge of the pages the proposal changed, the conflicts, and which
 * of the site's pending changes have to leave the site with it. Content gets
 * the answer as change ids and carries it out; it never sees a field, a list
 * or a patch set.
 */

/** One page the proposal changed, as it was, as the site has it, and as the proposal has it. */
export type MergedPage = {
  schema: SerializedSchema;
  /** Where the proposal started: the site's commit when it was opened. */
  base: JSONValue;
  /** The site's last commit. */
  site: JSONValue;
  /** The proposal's last save. */
  proposal: JSONValue;
};

/** A change pending on the site, in chain order. */
export type PendingChange = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  patch: Operation[];
};

export type MergeInput = {
  pages: Record<ModuleFilePath, MergedPage>;
  /** Every change pending on the site, oldest first. */
  sitePending: PendingChange[];
};

/** A field both sides changed since the proposal started. */
export type MergeConflict = {
  moduleFilePath: ModuleFilePath;
  path: string[];
  base: JSONValue | undefined;
  site: JSONValue | undefined;
  proposal: JSONValue | undefined;
};

export type MergePlan = {
  /** Each page as the merge leaves it, when there is no conflict. */
  merged: Record<ModuleFilePath, JSONValue>;
  /** Fields to resolve before the proposal can be published. */
  conflicts: MergeConflict[];
  /**
   * The site's pending changes that conflict with the merge, as whole patch
   * sets: each inner list moves together. Content moves them into a new
   * proposal at the seal; everything else stays pending on the site.
   */
  move: PatchId[][];
};

export function mergePlan(input: MergeInput): MergePlan {
  void input;
  throw new Error("mergePlan is not built yet");
}
