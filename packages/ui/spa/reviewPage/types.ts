import type { CompareNavSection, CompareSide } from "../compare/types";
import type { CompareChangeKind } from "../compare/types";
import type { Profile } from "../components/ValProvider";
import type { FieldDiff } from "../diff/types";
import type { FileChange } from "../proposals/changedFiles";
import type { DiffLine } from "../proposals/lineDiff";

/**
 * Review, as a page: what is about to be published, drawn as what changed.
 *
 * The page renders this and nothing else, so a story writes it by hand. It is
 * the same on the site (pending changes against what is published) and in a
 * proposal (the proposal against the site); a proposal adds `code` and
 * `affected`.
 */
export type ReviewPageModel = {
  left: CompareSide;
  right: CompareSide;
  /** Changed fields, across every pane. */
  changeCount: number;
  /** Pages and data whose CONTENT changed. */
  sections: CompareNavSection[];
  /** Keyed by nav node id. */
  panes: Record<string, ReviewPane>;
  /** A proposal's code changes. Absent on the site, and where there are none. */
  code?: ReviewCode;
  /** Pages whose content did not change, and may look different anyway. */
  affected?: ReviewAffectedPages;
  profiles: Record<string, Profile>;
};

/** A conversation with the assistant that made changes. */
export type ReviewSession = {
  id: string;
  /** What the conversation is called. */
  title: string;
};

export type ReviewRow = FieldDiff & {
  /** Who changed it, by profile id. */
  authorIds: string[];
  /** Set when the assistant made the change, in this conversation. */
  session?: ReviewSession;
};

export type ReviewPane = {
  title: string;
  /** A page's URL, or a data module's folders. Never a file path. */
  location?: string;
  /** What happened to the thing as a whole, when that is the story. */
  change?: CompareChangeKind;
  /** What it used to be called, for a page that changed address. */
  renamedFrom?: string;
  /** The route, for a pane that is a page: it can be looked at as a page. */
  pageUrl?: string;
  rows: ReviewRow[];
};

export type ReviewCodeFile = {
  path: string;
  change: FileChange;
  added: number;
  removed: number;
  lines: DiffLine[];
};

/** The files one conversation changed, or the ones no conversation did. */
export type ReviewCodeGroup = {
  session: (ReviewSession & { by: string; when: string }) | null;
  files: ReviewCodeFile[];
};

export type ReviewCode = {
  groups: ReviewCodeGroup[];
  /** Whether the proposal's address serves this code: `Build is up to date`. */
  build: string;
};

export type ReviewAffectedPage = {
  url: string;
  /** What links it to a change: `Authors`, `Button.tsx`. */
  because: string;
};

/**
 * Two kinds of evidence, kept apart because they are not equally sure.
 *
 * `byContent` is certain: the page reads a module that changed. `byCode` is a
 * best effort from the imports of the changed files, and can list a page that
 * looks the same.
 */
export type ReviewAffectedPages = {
  byContent: ReviewAffectedPage[];
  byCode: ReviewAffectedPage[];
  /** A changed file every page loads, when there is one: `app.css`. */
  everyPageBecause?: string;
};

/** What the page is showing: a pane, the code changes, or one page. */
export const REVIEW_CODE_ID = "code";

export function reviewPageId(url: string): string {
  return `page:${url}`;
}
