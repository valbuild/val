import type {
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
} from "@valbuild/core";
import type { JSONValue, Operation } from "@valbuild/core/patch";
import { changesToMove } from "./merge";
import type { Project } from "./project";
import { validateWith } from "./validate";

/**
 * Which of the site's pending changes a merge of a proposal moves into
 * proposals of their own (valbuild/home `docs/hosted-publishing.md`, step 8.2,
 * decision 4), from what content hands over (`GET /proposals/:name/move-inputs`)
 * and this server's schemas.
 *
 * The schemas are the ones this server runs: the proposal's own build at its
 * address, which is the code the merge publishes. They stand in for the site's
 * too, to group the site's changes into patch sets -- the same unless the
 * proposal changed that module's schema, in which case a change written
 * against the old one is checked against the new one, which is what the
 * merge leaves it under anyway.
 *
 * A page this server has no schema for is moved whole: what cannot be checked
 * is not left on the site to break.
 */

/** Content's `move-inputs` answer. */
export type MoveInputs = {
  siteHead: string | null;
  pending: {
    patchId: string;
    moduleFilePath: string;
    patch: Operation[];
    author: string | null;
    authorName: string | null;
  }[];
  modules: Record<string, { site: JSONValue | null; merged: JSONValue | null }>;
};

/** What the Publish press carries (`MergeBody.moves` in content), and who moves. */
export type MergeMoves = {
  siteHead: string | null;
  considered: string[];
  groups: string[][];
};

export function movesAtMerge(
  inputs: MoveInputs,
  schemas: Record<ModuleFilePath, Schema<SelectorSource>>,
): MergeMoves & { authors: string[][] } {
  const site: Project = { files: {}, modules: {} };
  const merged: Project = { files: {}, modules: {} };
  for (const [path, { site: before, merged: after }] of Object.entries(
    inputs.modules,
  )) {
    const moduleFilePath = path as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (schema === undefined) continue;
    const serialized = schema["executeSerialize"]();
    const validate = (source: JSONValue | undefined) =>
      validateWith(schema, moduleFilePath, source);
    if (before !== null) {
      site.modules[moduleFilePath] = {
        source: before,
        schema: serialized,
        entries: null,
        validate,
      };
    }
    if (after !== null) {
      merged.modules[moduleFilePath] = {
        source: after,
        schema: serialized,
        entries: null,
        validate,
      };
    }
  }
  const groups = changesToMove({
    site,
    merged,
    pending: inputs.pending.map((change) => ({
      patchId: change.patchId as PatchId,
      moduleFilePath: change.moduleFilePath as ModuleFilePath,
      patch: change.patch,
    })),
  });
  const nameOf = new Map(
    inputs.pending.map((change) => [
      change.patchId,
      change.authorName ?? "Someone",
    ]),
  );
  return {
    siteHead: inputs.siteHead,
    considered: inputs.pending.map((change) => change.patchId),
    groups,
    authors: groups.map((group) => [
      ...new Set(group.map((id) => nameOf.get(id) ?? "Someone")),
    ]),
  };
}
