import type { ModuleFilePath, PatchId, SourcePath } from "@valbuild/core";
import { Internal } from "@valbuild/core";
import type { Profile } from "../components/ValProvider";
import type { RowStagingState } from "../components/PatchStagingProvider";
import type { SerializedPatchSet, PatchSetMetadata } from "../utils/PatchSets";
import type { CompareAuthorship } from "../compare/types";
import type { Description } from "../utils/describePath";
import { pagePathOf, pageRouteOf } from "../utils/pageRoutes";
import { prettyModuleLocation } from "../utils/prettyModulePath";
import { UNKNOWN_AUTHOR } from "../utils/computeChangedSourcePaths";
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
  /** What REVERTING these would push out of the publish — the same invariant. */
  unstagePreview: (patchIds: readonly PatchId[]) => PatchId[];
  authorOf: (patchId: PatchId) => string | null;
  /**
   * Whether this module's keys are URLs of the site.
   *
   * Passed in because the answer is in the SCHEMA and this is pure.
   * `isPageModule` is the one implementation.
   */
  isPageModule: (moduleFilePath: ModuleFilePath) => boolean;
  /** What a path is CALLED. See `describePath`. */
  describe: (path: SourcePath) => Description;
  now: Date;
};

/**
 * Patch sets, grouped by the thing that changed.
 *
 * A PAGE for a router module, a module for everything else — and that is the
 * whole difference between a list that reads and one that does not. A router
 * module is one module holding many pages, so grouping by module put three
 * unrelated edits under three headings all called `Pages`, told apart only by
 * `App / Blogs / Blog` underneath. The thing that changed is the page, and a
 * page is named by its URL.
 */
export function toReviewModel(input: ReviewModelInput): ReviewModel {
  const groups = new Map<string, ReviewModuleGroup>();
  for (const patchSet of input.patchSets) {
    const isPage = input.isPageModule(patchSet.moduleFilePath);
    const route = isPage ? pageRouteOf(reviewSourcePath(patchSet)) : null;
    /*
     * The group's own path: the page, or the module. Also its key, so two
     * pages in one router module are two groups and two modules with the same
     * name are still two.
     */
    const groupPath =
      route === null
        ? (patchSet.moduleFilePath as unknown as SourcePath)
        : pagePathOf(reviewSourcePath(patchSet), route);
    const row = toRow(patchSet, input, route === null ? 0 : 1);
    const group = groups.get(groupPath);
    if (group === undefined) {
      groups.set(groupPath, {
        id: groupPath,
        moduleFilePath: patchSet.moduleFilePath,
        description: input.describe(groupPath),
        /*
         * A page's URL is its location AND its identity; a module's is its
         * folders, spelled the way the left nav spells them. Never the file
         * path — an editor has no checkout to open it in.
         */
        location: route ?? prettyModuleLocation(patchSet.moduleFilePath),
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

function toRow(
  patchSet: PatchSetMetadata,
  input: ReviewModelInput,
  /** Leading segments the group heading already says. See `trailOf`. */
  skip: number,
): ReviewRow {
  /*
   * DISTINCT patch ids, because `PatchSets` inserts one entry per OP.
   *
   * A patch carrying two ops at the same path lands in `patches` twice, so a
   * plain map gives the same id twice — which reads out as "2 edits" for one
   * edit, and hands every id twice to `stateOf`, `stagePreview` and the
   * discard. The set is the unit staging moves; the op is not.
   */
  const patchIds = [...new Set(patchSet.patches.map((patch) => patch.patchId))];
  const staging = input.stagingEnabled ? input.stateOf(patchIds) : "staged";
  return {
    id: reviewRowId(patchSet),
    description: input.describe(reviewSourcePath(patchSet)),
    trail: trailOf(patchSet, skip),
    summary: summaryOf(patchSet),
    authors: authorshipOf(patchSet),
    lastUpdated: patchSet.lastUpdated,
    patchCount: patchIds.length,
    staging,
    ...(staging === "unstaged"
      ? { alsoStages: namesOf(input.stagePreview(patchIds), input) }
      : { alsoUnstages: namesOf(input.unstagePreview(patchIds), input) }),
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
function trailOf(patchSet: PatchSetMetadata, skip: number): string[] {
  return (
    patchSet.patchPath
      /*
       * Drop what the heading already said. A page's group is titled with its
       * route, so repeating `/blogs/blog2` on every row under it spends the
       * width that says WHICH field changed on saying the same URL twice.
       */
      .slice(skip)
      .map((segment) =>
        segment.startsWith("/public/")
          ? (segment.split("/").pop() ?? segment)
          : segment,
      )
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
  /*
   * One entry per PATCH, not per op. `PatchSets` inserts an entry per
   * operation, so a two-op patch would otherwise be listed as two edits by the
   * same person — which is what `buildPatchesByAuthorIds` dedupes for on the
   * compare side.
   */
  const seen = new Set<string>();
  for (const patch of patchSet.patches) {
    if (seen.has(patch.patchId)) continue;
    seen.add(patch.patchId);
    /*
     * An author-less patch is a real state, not a gap: in fs mode there are no
     * profiles at all, and over http an api-key write has none. It gets one
     * bucket, and `ProfileAvatar` names it per mode.
     */
    const key = patch.author ?? UNKNOWN_AUTHOR;
    (authorship[key] ??= []).push({
      opType: patch.opType,
      createdAt: patch.createdAt,
    });
  }
  return authorship;
}

/**
 * Whose work a staging move would carry with it, by name.
 *
 * One function for both directions, because the argument is the same one: the
 * prefix invariant says a later patch set cannot publish without its
 * predecessors, so ticking a row can drag somebody else's work INTO the
 * publish and reverting one can push somebody else's OUT. Named rather than
 * counted, because "also moves 2 changes" does not tell you whose — and it is
 * the names that make it a decision rather than a surprise.
 *
 * This person's own work is left out of both. It is already theirs to publish
 * or to drop, and listing it reads as a warning about nothing.
 */
function namesOf(
  movedPatchIds: readonly PatchId[],
  input: ReviewModelInput,
): string[] | undefined {
  const names: string[] = [];
  for (const patchId of movedPatchIds) {
    const authorId = input.authorOf(patchId);
    if (authorId === null || authorId === input.currentAuthorId) continue;
    const name = input.profiles[authorId]?.fullName ?? authorId;
    if (!names.includes(name)) names.push(name);
  }
  return names.length > 0 ? names : undefined;
}
