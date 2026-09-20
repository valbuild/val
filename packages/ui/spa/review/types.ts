import type { Description } from "../utils/describePath";
import type { CompareAuthorship } from "../compare/types";
import type { RowStagingState } from "../components/PatchStagingProvider";

/**
 * The review page's data, as a story writes it.
 *
 * Separate from `SerializedPatchSet` for the same reason `CompareModel` is
 * separate from `ChangeTreeNode`: the adapter that turns patch sets into this
 * is where the awkward parts live — resolving a `Description` per row, reading
 * the staging state out of `PatchStagingProvider`, counting what a publish
 * would hold back — and none of it should have to exist before the layout can
 * be looked at.
 *
 * It is also narrower than a patch set on purpose. A row here does not carry
 * before/after values, because this page is deliberately NOT a diff: the diff
 * is one button away, in the compare dialog, and the whole reason for a second
 * screen is that the existing one answers "what changed" when the question
 * before a publish is "what is going out".
 */
export type ReviewModel = {
  /** One entry per module, in the order the page lists them. */
  modules: ReviewModuleGroup[];
  /**
   * Whether the server can store patch groups at all.
   *
   * False in fs mode and against a content API that predates groups, and then
   * every checkbox is gone rather than present and inert — the same rule
   * `PatchStaging.enabled` already states, kept here so the page can be
   * rendered in that state without a provider.
   */
  stagingEnabled: boolean;
  profiles: Record<string, { fullName: string; avatar?: string | null }>;
  /** Fixed clock, so relative dates are screenshottable. */
  now: Date;
};

export type ReviewModuleGroup = {
  /** The module's path, which is what makes the group unique. */
  moduleFilePath: string;
  /** What the module is CALLED — a heading is a title surface. */
  description: Description;
  rows: ReviewRow[];
};

/**
 * One patch set: every patch at one path in one module, as one line.
 *
 * A patch set is the unit a publish stages and a discard removes, so it is the
 * unit this page lists. Splitting it finer would offer a control that cannot be
 * honoured — the prefix invariant means a patch out of the middle of a set
 * cannot go alone — and coarser would be the module, which routinely holds two
 * unrelated edits by two people.
 */
export type ReviewRow = {
  id: string;
  /**
   * What changed, named. `origin.title === "preview"` when a developer wrote
   * the name; a list row is a preview surface, so it is used when present.
   */
  description: Description;
  /** The path under the module, for a row that is not the module root. */
  patchPath: string[];
  /** What kinds of edit are in here, for the one-line summary. */
  summary: string;
  /** Who staged it, and when — the same shape the compare rows carry. */
  authors: CompareAuthorship;
  lastUpdated: string;
  /** How many patches coalesced into this set. */
  patchCount: number;
  staging: RowStagingState;
  /**
   * What staging this row would additionally pull in, by author name.
   *
   * The prefix invariant again: a patch set later in the chain cannot publish
   * without its predecessors, so ticking one row can drag another person's work
   * into the publish. Named rather than counted, because "also publishes 2
   * changes" does not tell you whose.
   */
  alsoStages?: string[];
};
