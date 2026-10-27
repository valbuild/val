import type { Profile } from "../components/ValProvider";
import type { Description } from "../utils/describePath";
import type { CompareAuthorship } from "../compare/types";

/**
 * The review page's data, as a story writes it.
 *
 * Separate from `SerializedPatchSet` for the same reason `CompareModel` is
 * separate from `ChangeTreeNode`: the adapter that turns patch sets into this
 * is where the awkward parts live — resolving a `Description` per row,
 * grouping by page or module — and none of it should have to exist before the
 * layout can be looked at.
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
   * Who is looking, so the author filter can lead with them and say "(you)".
   *
   * Null when the profile has not loaded or there is no session, and then it
   * is simply one more name in the list.
   *
   * NOT a one-click "Mine" preset, which this said for a while and the page
   * never had. Narrowing to yourself and then pressing "Select showing" is two
   * gestures and reaches the same set, so the preset is a convenience rather
   * than a capability — worth adding, but it has to be added before it is
   * described, because a comment promising a control is where the next person
   * goes looking for it.
   */
  currentAuthorId: string | null;
  /** Fixed clock, so relative dates are screenshottable. */
  now: Date;
};

export type ReviewModuleGroup = {
  /**
   * What makes the group unique: the PAGE's path, or the module's.
   *
   * Not {@link moduleFilePath}, and the difference is the whole point of
   * grouping by page: a router module is one module holding many pages, so
   * several groups on this screen share one module file path. Keying a list on
   * it gave React duplicate keys — and with them a row's checkbox state
   * following the wrong page as the list reorders.
   *
   * An id, not a label. It is never printed: an editor has no checkout, so
   * `/app/blogs/[blog]/page.val.ts` names a file they cannot open. What they
   * see is {@link description} and {@link location}.
   */
  id: string;
  /**
   * The module the changes are in.
   *
   * Still here because the rows are patch sets OF a module and an action has
   * to find its way back to one. Never unique on this screen, and never
   * printed.
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
 * A patch set is the unit a selection picks and a discard removes, so it is the
 * unit this page lists. Splitting it finer would offer a control that cannot be
 * honoured — a patch out of the middle of a set cannot go alone, because the
 * later ones were written against it — and coarser would be the module, which
 * routinely holds two unrelated edits by two people.
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
  /** Who made it, and when — the same shape the compare rows carry. */
  authors: CompareAuthorship;
  lastUpdated: string;
  /** How many patches coalesced into this set. */
  patchCount: number;
};
