import type { ModuleFilePath, PatchId, SourcePath } from "@valbuild/core";
import { Internal } from "@valbuild/core";
import type { Profile } from "../components/ValProvider";
import type { RowStagingState } from "../components/PatchStagingProvider";
import type { SerializedPatchSet, PatchSetMetadata } from "../utils/PatchSets";
import type { CompareAuthorship } from "../compare/types";
import type { Description } from "../utils/describePath";
import { prettyModuleLocation } from "../utils/prettyModulePath";
import type { ReviewModel, ReviewModuleGroup, ReviewRow } from "./types";

/**
 * Patch sets, as the review page's model.
 *
 * Pure, and split from the hook that feeds it for the reason `shellDataMapping`
 * gives: importing the hook pulls in `ValProvider`, which pulls in the
 * validation worker, which jest cannot load. This is also the half that can be
 * wrong in a way the types will not catch — the grouping, the summaries, whose
 * work a stage would drag in — so it is the half worth testing.
 *
 * Everything that needs a store is passed in as a function. `describe` is the
 * one that costs something: a `Description` needs a schema, a source and a
 * preview, and resolving it per row is what `useReviewDescriptions` exists to
 * do once for the whole list.
 */
export type ReviewModelInput = {
  patchSets: SerializedPatchSet;
  profiles: Record<string, Profile>;
  mode: "fs" | "http" | "unknown";
  currentAuthorId: string | null;
  stagingEnabled: boolean;
  /** What half of the publish this patch set is in. */
  stateOf: (patchIds: readonly PatchId[]) => RowStagingState;
  /** What staging these would additionally pull in — the prefix invariant. */
  stagePreview: (patchIds: readonly PatchId[]) => PatchId[];
  authorOf: (patchId: PatchId) => string | null;
  /** What a path is CALLED. See `describePath`. */
  describe: (path: SourcePath) => Description;
  now: Date;
};

export function toReviewModel(input: ReviewModelInput): ReviewModel {
  const groups = new Map<ModuleFilePath, ReviewModuleGroup>();
  for (const patchSet of input.patchSets) {
    const group = groups.get(patchSet.moduleFilePath);
    const row = toRow(patchSet, input);
    if (group === undefined) {
      groups.set(patchSet.moduleFilePath, {
        moduleFilePath: patchSet.moduleFilePath,
        description: input.describe(
          patchSet.moduleFilePath as unknown as SourcePath,
        ),
        location: prettyModuleLocation(patchSet.moduleFilePath),
        rows: [row],
      });
    } else {
      group.rows.push(row);
    }
  }
  return {
    modules: [...groups.values()],
    stagingEnabled: input.stagingEnabled,
    profiles: input.profiles,
    mode: input.mode,
    currentAuthorId: input.currentAuthorId,
    now: input.now,
  };
}

/**
 * The id a selection carries, and the one a patch set is looked back up by.
 *
 * The patch set's own path — module plus the path inside it — because that is
 * what makes it unique and what survives a re-group. A patch id would not: a
 * set coalesces as more patches land on the same path, so the id of "its first
 * patch" names a different set an edit later, and a tick would silently move.
 */
export function reviewRowId(patchSet: {
  moduleFilePath: ModuleFilePath;
  patchPath: string[];
}): string {
  return `${patchSet.moduleFilePath}?${patchSet.patchPath.join("/")}`;
}

function toRow(patchSet: PatchSetMetadata, input: ReviewModelInput): ReviewRow {
  const patchIds = patchSet.patches.map((patch) => patch.patchId);
  const staging = input.stagingEnabled ? input.stateOf(patchIds) : "staged";
  return {
    id: reviewRowId(patchSet),
    description: input.describe(reviewSourcePath(patchSet)),
    trail: trailOf(patchSet),
    summary: summaryOf(patchSet),
    authors: authorshipOf(patchSet),
    lastUpdated: patchSet.lastUpdated,
    patchCount: patchSet.patches.length,
    staging,
    ...(staging === "unstaged"
      ? { alsoStages: alsoStagedBy(patchIds, input) }
      : {}),
  };
}

/**
 * The source path a patch set names — the ONE spelling of it.
 *
 * Exported because `useReviewModel` builds the list of paths to resolve
 * descriptions for, and this builds the key they are looked up by. Two
 * spellings of the same path is a lookup that misses every time and a page of
 * fallback names, which is the failure this page most wants to avoid and the
 * one that looks least like a bug.
 */
export function reviewSourcePath(patchSet: {
  moduleFilePath: ModuleFilePath;
  patchPath: string[];
}): SourcePath {
  if (patchSet.patchPath.length === 0) {
    return patchSet.moduleFilePath as unknown as SourcePath;
  }
  return Internal.joinModuleFilePathAndModulePath(
    patchSet.moduleFilePath,
    Internal.patchPathToModulePath(patchSet.patchPath),
  );
}

/**
 * WHERE in the module, spelled for a reader.
 *
 * A gallery's keys ARE file paths, so a segment that looks like one is shown
 * as its file name — `/public/val/images/hero-a1b2c.jpg` is a path an editor
 * has no checkout of. A ROUTE key is left whole: `/blogs/getting-started` is
 * the page's identity, and shortening it takes away the only thing that tells
 * two drafts called "Launch" apart. The two are told apart by where the bytes
 * live, which is the one thing that is true of every media path and no route.
 */
function trailOf(patchSet: PatchSetMetadata): string[] {
  return patchSet.patchPath.map((segment) =>
    segment.startsWith("/public/")
      ? (segment.split("/").pop() ?? segment)
      : segment,
  );
}

/**
 * What kind of edit this is, in one line.
 *
 * Coarse on purpose: this page answers "what is going out", and a row that
 * tried to say what the value became would be a diff — which is the other
 * screen, one button away. The op is what an editor recognises their own work
 * by ("I removed that entry"), so it leads.
 */
function summaryOf(patchSet: PatchSetMetadata): string {
  const ops = new Set(patchSet.opTypes);
  const isFile = patchSet.schemaTypes.some(
    (type) => type === "image" || type === "file",
  );
  if (ops.size > 1) {
    return "Edited";
  }
  const [op] = [...ops];
  if (op === "file" || (isFile && op === "add")) return "Image added";
  if (op === "add") return "Added";
  if (op === "remove") return "Removed";
  if (op === "move") return "Moved";
  if (op === "replace") return isFile ? "Image replaced" : "Changed";
  return "Edited";
}

/** The shape `FieldPatchAuthorsPure` draws: every patch, under its author. */
function authorshipOf(patchSet: PatchSetMetadata): CompareAuthorship {
  const authorship: CompareAuthorship = {};
  for (const patch of patchSet.patches) {
    /*
     * An author-less patch is a real state, not a gap: in fs mode there are no
     * profiles at all, and over http an api-key write has none. It gets one
     * bucket, and `ProfileAvatar` names it per mode.
     */
    const key = patch.author ?? "";
    (authorship[key] ??= []).push({
      opType: patch.opType,
      createdAt: patch.createdAt,
    });
  }
  return authorship;
}

/**
 * Whose work staging this row would additionally publish, by name.
 *
 * The prefix invariant: a patch set later in the chain cannot publish without
 * its predecessors, so ticking one row can drag another person's work into the
 * publish. Named rather than counted, because "also publishes 2 changes" does
 * not tell you whose — and it is the names that make it a decision rather than
 * a surprise. This person's own earlier work is left out: it is already theirs
 * to publish, and listing it reads as a warning about nothing.
 */
function alsoStagedBy(
  patchIds: readonly PatchId[],
  input: ReviewModelInput,
): string[] | undefined {
  const names: string[] = [];
  for (const patchId of input.stagePreview(patchIds)) {
    const authorId = input.authorOf(patchId);
    if (authorId === null || authorId === input.currentAuthorId) continue;
    const name = input.profiles[authorId]?.fullName ?? authorId;
    if (!names.includes(name)) names.push(name);
  }
  return names.length > 0 ? names : undefined;
}
