import type { ReactNode } from "react";
import type { AuthorPatchInfo } from "../components/FieldPatchAuthors";
import type { Profile } from "../components/ValProvider";

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

/**
 * Who wrote the patches behind one change, keyed by author id.
 *
 * Exactly `FieldPatchAuthorsPure`'s `patchesByAuthorIds`, and deliberately the
 * same shape rather than a summary: that component already renders this as an
 * avatar stack opening a per-patch history, it is what the current review
 * screen uses, and a second attribution component would drift from it.
 *
 * It is a MAP rather than a list of names because one change routinely has
 * several patches by several people — `PatchSets` groups by path, not by
 * author — and "who touched this, and when" needs the patches, not just the
 * set of ids.
 */
export type CompareAuthorship = Record<string, AuthorPatchInfo[]>;

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
  /**
   * What this used to be called, when `change` is `moved`.
   *
   * A renamed page is ONE row, not an add beside a remove, and `label` is its
   * new name. Without the old one the row cannot say the thing that matters —
   * for a router record the key is the URL, so this is the old address, and an
   * editor scanning a publish for "did any link break" is looking for exactly
   * this line.
   */
  renamedFrom?: string;
  /**
   * Everyone with a staged change at or under this row.
   *
   * Ids only: the nav shows no avatars — attribution lives in the right column
   * — but filtering the dialog to one person has to be able to drop a nav row
   * without walking into its pane to find out whether it would be empty.
   */
  authorIds?: string[];
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
  /**
   * Who made this side, when one person did — a commit's committer.
   *
   * Only ever set on the left, and only on a commit basis: a commit has one
   * author, whereas "Published" is the accumulation of many and "After
   * publish" is attributed per row instead. So this is the header-level
   * counterpart of the per-row avatars, not a duplicate of them.
   */
  byline?: string;
};

/** An entry in the "comparing against" dropdown. */
export type CompareBasisOption = {
  id: string;
  label: string;
  /** Author, date, or anything else that tells two commits apart. */
  caption?: string;
};

/**
 * Whether a row can be undone, and what undoing it would mean.
 *
 * Two kinds, because discard and revert are NOT the same operation and fail
 * for different reasons:
 *
 * - **`discard`** removes the staged patches. The result is a state that
 *   already existed and already validated, so there is no schema question at
 *   all. What there IS, is the prefix invariant from `utils/patchGroups.ts`:
 *   inside a patch set, a later patch's array indices were computed against a
 *   state in which its predecessors applied, so dropping one out of the middle
 *   "either errors or silently writes to the wrong index". `requires` is what
 *   that forces along; `unstageClosure` is the real implementation.
 * - **`revert`** writes an old value forward as a new `replace`, so it is
 *   entirely a schema question — and the one #563 already answered.
 *   `compatibility` is `checkCompatibility`'s three-way answer, `unknown`
 *   included, because "we are not sure" is a real state (rich text, and a
 *   union value carrying no discriminator) and must not be reported as a
 *   confident yes or no.
 *
 * Which one a row offers follows from the BASIS, not from taste. Against
 * Published, the change you want gone is a staged patch, and removing it is
 * cleaner than writing a second patch to cancel the first. Against a commit,
 * those changes already shipped — there is no patch left to remove — so the
 * only way back is to write the old value forward.
 */
export type CompareUndo =
  | {
      kind: "discard";
      /**
       * Other rows, by id, that must be discarded along with this one.
       *
       * Transitive: the dialog follows these to a fixed point, so a chain of
       * three resolves in one click. Stated by the adapter rather than derived
       * here, because deriving it needs the patch chain and the patch sets.
       */
      requires?: string[];
    }
  | {
      kind: "revert";
      /**
       * `checkCompatibility`'s answer, schema against schema.
       *
       * `unknown` is OFFERED rather than refused, exactly as `RestoreChrome`
       * does: this gate cannot see the value, so refusing on it would block
       * restores that are fine. The value-level check happens at confirm, and
       * the rule there is "refuse type-incompatible, allow validation errors" —
       * a value that breaks a `minLength` is staged and held at publish, since
       * putting an old value back must not be stricter than typing it.
       */
      compatibility: "yes" | "no" | "unknown";
      /** Why not, when `compatibility` is `no`. Shown instead of the control. */
      reason?: string;
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
  /**
   * Who staged this, shown on the RIGHT column only.
   *
   * The left column is published content that nobody is currently editing, so
   * there is no editor to name there; every staged change belongs to the side
   * it is being staged into. Putting it on both would also mean drawing the
   * same person twice for one change, once per column.
   */
  authors?: CompareAuthorship;
  /** Whether this row can be undone. Absent means it cannot be selected. */
  undo?: CompareUndo;
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
  /** Where it went, for `moved`. Required to say anything useful about one. */
  move?: CompareMove;
  /** Who staged it. Right column only — see `CompareFieldRow.authors`. */
  authors?: CompareAuthorship;
  /** Whether this entry can be undone as a whole. */
  undo?: CompareUndo;
};

/**
 * The two things a `move` op can mean, which are not the same statement.
 *
 * Both come from a real `{op: "move"}` in the patch — a record key rename
 * (`ChangeRecordPopover`) and an array reorder (`ArrayFields`) — so neither is
 * inferred from comparing two snapshots. That distinction is load-bearing:
 * inferring moves by diffing states is what `computeRestorePatches` did before
 * #563 deleted it, and array items splice, so the inference could attribute a
 * move to the wrong row and look like it had worked.
 *
 * They are separate members because a reader needs different things from them:
 *
 * - A **rename** is about identity. The key IS the thing — and in a router
 *   record the key is the URL, so a rename is a page changing address, which is
 *   usually the most consequential line in a publish. Position is irrelevant.
 * - A **reorder** is about position, and the value is untouched. Showing it as
 *   a before/after value pair would claim an edit that did not happen.
 */
export type CompareMove =
  | { kind: "rename"; from: string; to: string }
  | { kind: "reorder"; from: number; to: number };

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
  /**
   * Everyone who appears in `authors`, by id.
   *
   * Passed with the model rather than read from a store so a story can render
   * attribution without mounting one — the same reason `ComparePatchSets`
   * takes `profilesByAuthorIds` as a prop.
   */
  profiles: Record<string, Profile>;
  /**
   * What undoing means against the current basis, and what it can reach.
   *
   * Absent means the dialog is read-only — which is what a basis with nothing
   * to undo should produce, rather than an Undo button that opens a mode with
   * no selectable rows in it.
   */
  undo?: {
    kind: "discard" | "revert";
    /**
     * The whole-commit escape hatch, when the basis has one.
     *
     * `revertAll` exists because "a publish went wrong and they want it
     * undone, all of it, now" is the case people actually have, and picking
     * twenty fields one at a time "is not a workflow, it is a punishment".
     * Absent against Published, where the equivalent is discarding everything.
     */
    all?: { label: string; blockedCount?: number };
  };
};
