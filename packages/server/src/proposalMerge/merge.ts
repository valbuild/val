import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { JSONValue, Operation } from "@valbuild/core/patch";
import type { Files, LoadedProject } from "./project";

/**
 * Publishing a proposal as a pull request is merged: valbuild/home
 * `docs/hosted-publishing.md`, step 8.2.
 *
 * Val's half: the two answers that need a schema. Content gets them as files
 * and change ids and carries them out, never looking at a field, a list or a
 * patch set.
 *
 * - {@link mergeFromSite} -- Update from the site: the merge commit `M`.
 * - {@link changesToMove} -- which of the site's pending changes leave the
 *   site when a proposal is merged.
 *
 * Neither is built yet: `mergeScenarios.test.ts` is their specification.
 */

/** A project at one commit: its files, and what Val's loader made of them. */
export type Project = { files: Files; loaded: LoadedProject };

/** A field both sides changed since the proposal started. */
export type FieldConflict = {
  kind: "field";
  moduleFilePath: ModuleFilePath;
  path: string[];
  base: JSONValue | undefined;
  site: JSONValue | undefined;
  proposal: JSONValue | undefined;
};

/**
 * Code both sides changed: a component, `val.modules.ts`, or the schema of a
 * `.val.ts` (its code -- everything but `c.define`'s content argument, whose
 * fields merge on their own).
 */
export type CodeConflict = {
  kind: "code";
  file: string;
  base: string | null;
  site: string | null;
  proposal: string | null;
};

/**
 * The schema check: content that merged cleanly and is not valid under the
 * schema the merge ends with -- an entry the site added, say, under a field
 * whose type the proposal changed.
 */
export type InvalidConflict = {
  kind: "invalid";
  moduleFilePath: ModuleFilePath;
  path: string[];
  value: JSONValue | undefined;
  message: string;
};

export type Conflict = FieldConflict | CodeConflict | InvalidConflict;

/** How a conflict is resolved: keep one side, or write it -- as AI or a developer does. */
export type Resolution =
  | ({ moduleFilePath: ModuleFilePath; path: string[] } & (
      | { keep: "site" | "proposal" }
      | { value: JSONValue }
    ))
  | ({ file: string } & ({ keep: "site" | "proposal" } | { text: string }));

export type MergeResult =
  | {
      status: "merged";
      /** `M`'s tree: every file, merged. */
      files: Files;
      /** Code files `M` changed from the site's, which the proposal stages. */
      code: string[];
    }
  | { status: "conflicts"; conflicts: Conflict[] };

/**
 * Update from the site: a three-way merge of where the proposal started
 * (`base`), the site's head and the proposal's last save, written whole.
 * Every conflict needs a resolution, or nothing is merged.
 */
export async function mergeFromSite(input: {
  base: Project;
  site: Project;
  proposal: Project;
  resolutions: Resolution[];
}): Promise<MergeResult> {
  void input;
  throw new Error("mergeFromSite is not built yet");
}

/** A change pending on the site, in chain order. */
export type PendingChange = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  patch: Operation[];
};

/**
 * The site's pending changes that conflict with going from `site` to
 * `merged`, as whole patch sets: each inner list moves together, into a
 * proposal of its own. Everything else stays pending.
 */
export async function changesToMove(input: {
  site: Project;
  merged: Project;
  pending: PendingChange[];
}): Promise<PatchId[][]> {
  void input;
  throw new Error("changesToMove is not built yet");
}
