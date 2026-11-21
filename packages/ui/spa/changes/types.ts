import type { CompareChangeKind } from "../compare/types";
import type { Profile } from "../components/ValProvider";
import type { FieldDiff } from "../diff/types";
import type { ReviewSession } from "../reviewPage/types";

/**
 * The steps behind what Review shows, newest first, and what reverting them
 * would take.
 *
 * Review shows the NET change: a title edited three times is one row there.
 * This is the three edits, each with who made it and when, because a revert
 * takes back a step and not a net result.
 *
 * A step is a patch set: the unit that can be removed without leaving the
 * edits after it pointing at the wrong place.
 */
export type ChangeStep = {
  id: string;
  /** When it was made, as an ISO timestamp. */
  at: string;
  /** Who made it, by profile id. */
  authorId: string;
  /** Set when the assistant made it for them, in this chat. */
  session?: ReviewSession;
  /** What it changed, spelled for a reader: `/blogs/hello › title`. */
  target: string;
  /**
   * The Review row it is part of. Review links here with one, and the page
   * opens on the steps that share it.
   */
  rowId: string;
  change: CompareChangeKind;
  /** `Changed`, `Moved from 5 to 2`, `Added page`. */
  summary: string;
  /** What this step did on its own, against the step before it. */
  diff?: FieldDiff[];
  /**
   * Later steps, by id, that cannot stay if this one goes: they were made on
   * top of it. Followed to a fixed point when it is selected.
   */
  requires?: string[];
};

export type ChangesModel = {
  steps: ChangeStep[];
  profiles: Record<string, Profile>;
  /** Whose steps are selected on arrival. */
  currentAuthorId: string | null;
  /** What everything here is on top of. Absent in a local project. */
  published?: { when: string; by: string };
};
