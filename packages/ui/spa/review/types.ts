import type { Profile } from "../components/ValProvider";
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
  /**
   * `Profile`, not a shape of this page's own, so `ProfileAvatar` draws a
   * person here exactly as it draws them everywhere else.
   *
   * This started as `{ fullName, avatar?: string | null }` and was bridged to
   * `Profile` with an assertion at the one place it was rendered. It
   * type-checked and it was wrong in a way nothing could catch: `Profile.avatar`
   * is `{ url } | null`, so `profile.avatar?.url` on a string is `undefined`
   * and the picture could never load — every author on this page was initials
   * forever, while the same author had a face in the shell.
   */
  profiles: Record<string, Profile>;
  /**
   * Which server this is, for `ProfileAvatar`'s no-author fallback.
   *
   * Part of drawing a person correctly, not a detail of the page: in `fs` mode
   * there are no profiles at all and an author-less change is "Local changes",
   * while over http it is an author Val failed to look up. Same distinction the
   * compare rows and the shell draw, from the same component.
   */
  mode: "fs" | "http" | "unknown";
  /**
   * Who is looking, so "Mine" can be one click.
   *
   * Null when the profile has not loaded or there is no session — and then the
   * "Mine" preset is absent rather than present and selecting nothing, which is
   * the same rule the staging checkboxes follow in fs mode.
   */
  currentAuthorId: string | null;
  /** Fixed clock, so relative dates are screenshottable. */
  now: Date;
};

export type ReviewModuleGroup = {
  /**
   * The module's path, which is what makes the group unique.
   *
   * An id, not a label. It is never printed: an editor has no checkout, so
   * `/app/blogs/[blog]/page.val.ts` names a file they cannot open. What they
   * see is {@link description} and {@link location}.
   */
  moduleFilePath: string;
  /** What the module is CALLED — a heading is a title surface. */
  description: Description;
  /**
   * WHERE it is, spelled for a reader: `Content`, `App / Blogs / Blog`.
   *
   * A location, so it is still path segments and still holds still while
   * someone types — `prettyModuleLocation` only changes how they are spelled.
   * It is what tells two modules called `Page` apart, which is the one job the
   * raw path was doing here. Null when there is no folder to name.
   */
  location: string | null;
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
  /**
   * WHERE in the module this is, spelled for a reader. Empty at the root.
   *
   * Not the patch path verbatim, and that is the whole reason it has its own
   * field: a gallery's keys ARE file paths, so a patch path rendered as-is puts
   * `/public/val/images/hero-a1b2c.jpg` in front of an editor who has no
   * checkout — the same leak the module path was.
   *
   * A router record's key is the one that stays whole. `/blogs/getting-started`
   * is the page's IDENTITY, not a path to a file, and shortening it to
   * `getting-started` takes away the only thing that tells two drafts called
   * "Launch" apart. The adapter decides which of the two a segment is; the page
   * renders what it is given.
   */
  trail: string[];
  /** What kinds of edit are in here, for the one-line summary. */
  summary: string;
  /** Who staged it, and when — the same shape the compare rows carry. */
  authors: CompareAuthorship;
  lastUpdated: string;
  /** How many patches coalesced into this set. */
  patchCount: number;
  /**
   * Which half of the page this row is in.
   *
   * It is no longer what the checkbox shows. The checkbox is a SELECTION —
   * what you are about to act on — and staged-ness is the section the row sits
   * in, because one control cannot answer both "is this going out" and "am I
   * about to change that" without the answer to one being mistaken for the
   * other. `partial` sits with the staged rows and says so on the row.
   */
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
