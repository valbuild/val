import type {
  CompareGroup,
  CompareModel,
  CompareUndo,
  ComparePane,
} from "./types";

/**
 * Which rows a selection actually takes with it.
 *
 * The rule is the prefix invariant, stated in `utils/patchGroups.ts`: inside a
 * patch set, a later patch's array indices were computed against a state in
 * which its predecessors applied, so discarding one out of the middle "either
 * errors or silently writes to the wrong index". `requires` names what must
 * follow; this closes over it.
 *
 * Pulled in rather than refused, and shown rather than done quietly — a click
 * that silently discards a colleague's later edit is the worst outcome
 * available here, and the count and the warning in the bar exist to make that
 * impossible to do by accident.
 *
 * Transitive to a fixed point, because `requires` chains: discarding the first
 * of three dependent changes has to reach the third. Cycles cannot arise from a
 * patch chain, but the `seen` set means a malformed adapter produces a wrong
 * answer rather than a hung tab.
 */
export function closeOverRequired(
  picked: ReadonlySet<string>,
  requiresById: ReadonlyMap<string, readonly string[]>,
): { selected: Set<string>; pulledIn: Set<string> } {
  const selected = new Set(picked);
  const pulledIn = new Set<string>();
  const queue = [...picked];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) continue;
    for (const next of requiresById.get(id) ?? []) {
      if (selected.has(next)) continue;
      selected.add(next);
      pulledIn.add(next);
      queue.push(next);
    }
  }
  return { selected, pulledIn };
}

/** Every undoable row in a pane, flattened, with its id and descriptor. */
export function undoableRows(
  pane: ComparePane,
): { id: string; undo: CompareUndo; authors: readonly string[] }[] {
  const out: { id: string; undo: CompareUndo; authors: readonly string[] }[] =
    [];
  const push = (
    id: string,
    undo: CompareUndo | undefined,
    authors: Record<string, unknown> | undefined,
  ): void => {
    if (undo === undefined) return;
    out.push({ id, undo, authors: Object.keys(authors ?? {}) });
  };
  const walk = (group: CompareGroup): void => {
    if (group.kind === "fields") {
      for (const row of group.rows) {
        push(row.id, row.undo, row.authors);
      }
      return;
    }
    for (const item of group.rows) {
      push(item.id, item.undo, item.authors);
      for (const field of item.fields ?? []) {
        push(field.id, field.undo, field.authors);
      }
    }
  };
  for (const group of pane.groups) {
    walk(group);
  }
  return out;
}

/**
 * The `requires` map for one pane.
 *
 * Per pane rather than per model: a selection is cleared when the selected nav
 * row changes — undoing is about the thing you are looking at, and carrying a
 * selection across a navigation would mean a bar reporting a count whose rows
 * are no longer on screen.
 */
export function requiresMapOf(
  pane: ComparePane,
): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const row of undoableRows(pane)) {
    if (row.undo.kind === "discard" && row.undo.requires !== undefined) {
      map.set(row.id, row.undo.requires);
    }
  }
  return map;
}

export type UndoSummary = {
  /** Everything that will be undone, picks and their dependents. */
  selected: Set<string>;
  /** Only the ones the closure added. */
  pulledIn: Set<string>;
  /**
   * People other than the current user whose work the closure dragged in.
   *
   * Called out separately because it is the consequence nobody expects:
   * discarding your own change can be legal only if a colleague's later change
   * goes with it, and that has to be said before the click, not after.
   */
  othersAffected: string[];
};

export function summarizeUndo(
  picked: ReadonlySet<string>,
  pane: ComparePane,
  currentAuthorId: string | null,
): UndoSummary {
  const { selected, pulledIn } = closeOverRequired(picked, requiresMapOf(pane));
  const others: string[] = [];
  for (const row of undoableRows(pane)) {
    if (!pulledIn.has(row.id)) continue;
    for (const authorId of row.authors) {
      if (authorId !== currentAuthorId && !others.includes(authorId)) {
        others.push(authorId);
      }
    }
  }
  return { selected, pulledIn, othersAffected: others };
}

/** Whether a row can be picked at all, given what undoing means here. */
export function isSelectable(undo: CompareUndo | undefined): boolean {
  if (undo === undefined) return false;
  // A revert the schema refuses is shown with its reason rather than offered:
  // there is nothing a click could do, and a disabled control that never
  // explains itself is worse than no control.
  return undo.kind !== "revert" || undo.compatibility !== "no";
}

/** The undo kind this model offers, or null when the dialog is read-only. */
export function undoKindOf(model: CompareModel): "discard" | "revert" | null {
  return model.undo?.kind ?? null;
}
