import type { ReactNode } from "react";

/**
 * The view model the compare dialog renders, and nothing else.
 *
 * Deliberately NOT `ChangeTreeNode` from `computeChangedSourcePaths`. That type
 * is the output of the patch-set worker — patch ids, authors, staging state,
 * commit membership — and a layout built directly on it can only be exercised
 * by standing up a store, a worker and a patch chain. This is a design that is
 * going to be iterated on, so the shape it renders is the shape a story can
 * write by hand.
 *
 * The adapter from `ChangeTreeNode` to these types is the integration step and
 * is deliberately not here yet. Keeping it separate is also what lets the same
 * dialog serve "staged vs published" and "published vs a commit" without either
 * side knowing about the other: both reduce to sections, nodes and rows.
 *
 * Values are `ReactNode` rather than `Json` for the same reason. A story can
 * pass a plain string; the real thing passes `AnyField` under a
 * `FieldSourceOverrideContext`, which is how `ComparePatchSets` already renders
 * a field at a source it is not currently at. The layout must not care which.
 */

/**
 * What happened to a thing, in the direction of the comparison.
 *
 * Read as "left → right": `added` exists only on the right, `removed` only on
 * the left. This is the one place the direction convention is defined, and
 * every icon, rail and caption downstream derives from it — so a decision to
 * flip the columns is a change here and in `CompareColumns`, not a sweep.
 *
 * `unchanged` is a real member rather than an absence: the "show all fields"
 * toggle needs unchanged rows to BE in the model so that revealing them is
 * presentation rather than a second fetch. Nav nodes never carry it — an
 * unchanged page is not in the nav at all.
 */
export type CompareChangeKind =
  | "added"
  | "removed"
  | "changed"
  | "moved"
  | "unchanged";

/** What kind of thing a nav row points at, which decides its icon and grouping. */
export type CompareNavKind =
  | "page"
  | "folder"
  | "module"
  | "media-dir"
  | "media-file";

/**
 * One row in the left nav.
 *
 * `change` is optional because a row can be pure structure — a folder on the
 * way down to a changed page has no change of its own. Such a row still shows
 * `changedCount`, which is what makes a collapsed folder readable.
 */
export type CompareNavNode = {
  /** Stable identity, and what selection is keyed by. */
  id: string;
  label: string;
  /** The URL path, directory or module path, shown under the label. */
  sublabel?: string;
  kind: CompareNavKind;
  change?: CompareChangeKind;
  /** How many changed things sit at or under this row. */
  changedCount?: number;
  children?: CompareNavNode[];
};

/** A titled group of nav rows: Pages, Content, Media. */
export type CompareNavSection = {
  id: string;
  title: string;
  nodes: CompareNavNode[];
};

/**
 * One column's identity.
 *
 * Both halves are required rather than derived, because the whole point of the
 * chosen direction treatment is that neither column is inferred from position:
 * `label` says what it is ("Published"), `caption` says when or how much
 * ("3 days ago", "4 staged changes"). See `CompareColumns`.
 */
export type CompareSide = {
  label: string;
  caption?: string;
};

/** An entry in the "comparing against" dropdown. */
export type CompareBasisOption = {
  id: string;
  label: string;
  /** Author, date, or anything else that tells two commits apart. */
  caption?: string;
};

/** One field, at one path, on both sides. */
export type CompareFieldRow = {
  id: string;
  /** The field's own name, as the editor shows it. */
  label: string;
  /** The path under the module, for fields that are nested. */
  path?: string;
  change: CompareChangeKind;
  /** Absent for `added` — there was nothing there. */
  before?: ReactNode;
  /** Absent for `removed`. */
  after?: ReactNode;
};

/**
 * One entry of a record or array.
 *
 * A changed item carries `fields`, which are the changed fields INSIDE it. That
 * is what makes a list readable at a glance: added and removed items are a
 * one-line statement, and only the ones that were edited in place open up.
 */
export type CompareListItemRow = {
  id: string;
  /** The record key, or the index for an array. */
  label: string;
  /** A preview of the item, for added and removed rows where there is no field diff. */
  preview?: ReactNode;
  change: CompareChangeKind;
  fields?: CompareFieldRow[];
  /** Where it moved from and to, for `moved`. */
  movedFrom?: number;
  movedTo?: number;
};

/**
 * A run of rows under one heading.
 *
 * Two shapes rather than one recursive node: a flat set of fields and a list of
 * entries read differently and are laid out differently, and collapsing them
 * into one type would mean every renderer branching on which it got anyway.
 */
export type CompareGroup =
  | {
      kind: "fields";
      id: string;
      title?: string;
      rows: CompareFieldRow[];
    }
  | {
      kind: "list";
      id: string;
      title: string;
      /** "3 items added, 1 removed" — computed by the adapter, not the view. */
      summary?: string;
      rows: CompareListItemRow[];
    };

/** Everything the right-hand side shows for one selected nav node. */
export type ComparePane = {
  /** The page name or module path, as the nav row showed it. */
  title: string;
  subtitle?: string;
  /** What happened to the thing as a whole, when that is the story. */
  change?: CompareChangeKind;
  groups: CompareGroup[];
};

/** The whole dialog, as a story writes it. */
export type CompareModel = {
  sections: CompareNavSection[];
  /** Keyed by `CompareNavNode.id`. */
  panes: Record<string, ComparePane>;
  left: CompareSide;
  right: CompareSide;
  basisOptions: CompareBasisOption[];
  selectedBasisId: string;
  /** Total changed things, shown under the dialog title. */
  changeCount: number;
};
