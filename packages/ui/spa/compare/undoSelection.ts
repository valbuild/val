import type {
  CompareGroup,
  CompareModel,
  CompareUndoKind,
  CompareUndo,
  ComparePane,
} from "./types";

/**
 * Which rows an undo actually takes with it.
 *
 * The rule is the prefix invariant, stated in `utils/patchGroups.ts`: inside a
 * patch set, a later patch's array indices were computed against a state in
 * which its predecessors applied, so discarding one out of the middle "either
 * errors or silently writes to the wrong index". `requires` names what must
 * follow; this closes over it.
 *
 * Pulled in rather than refused, and shown rather than done quietly — a click
 * that silently discards a colleague's later edit is the worst outcome
 * available here, and the sentence in the confirmation exists to make that
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
 * The `requires` map for a whole model.
 *
 * Model-wide rather than per pane. A patch set is scoped to a module and one
 * module is one pane, so `requires` edges stay within a pane in practice —
 * but building the map across the model costs nothing and removes the
 * assumption, which matters because nothing else in this file would notice if
 * it stopped holding.
 */
export function requiresMapOfModel(
  model: CompareModel,
): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const pane of Object.values(model.panes)) {
    for (const row of undoableRows(pane)) {
      if (row.undo.kind === "discard" && row.undo.requires !== undefined) {
        map.set(row.id, row.undo.requires);
      }
    }
  }
  return map;
}

/** Every undoable row in the model, across every pane. */
export function undoableRowsOfModel(
  model: CompareModel,
): { id: string; undo: CompareUndo; authors: readonly string[] }[] {
  return Object.values(model.panes).flatMap(undoableRows);
}

/**
 * What undoing ONE row actually takes with it.
 *
 * A single row rather than a set, because there is no set: each change carries
 * its own action and is confirmed on its own. The selection model this replaced
 * needed a running total over arbitrary picks; this needs the truth about one
 * click, computed at the moment it is about to happen.
 */
export type UndoConsequence = {
  /**
   * Everything that goes: this row and whatever it compels.
   *
   * The ids rather than a count, because the same value answers both questions
   * the click has — what to say before it ("and 2 later ones") and what to
   * actually undo. Two functions returning a count and a set separately is how
   * those two drift apart.
   */
  ids: string[];
  /** How many of those were compelled rather than chosen. */
  pulledIn: number;
  /**
   * People other than the current user whose work the closure dragged in.
   *
   * The consequence nobody expects, and the reason this is computed before the
   * click rather than reported after it: undoing your own change can be legal
   * only if a colleague's later change goes with it.
   */
  others: string[];
};

export function consequenceOfUndoing(
  rowId: string,
  model: CompareModel,
  currentAuthorId: string | null,
): UndoConsequence {
  const { selected, pulledIn } = closeOverRequired(
    new Set([rowId]),
    requiresMapOfModel(model),
  );
  const others: string[] = [];
  for (const row of undoableRowsOfModel(model)) {
    if (!pulledIn.has(row.id)) continue;
    for (const authorId of row.authors) {
      if (authorId !== currentAuthorId && !others.includes(authorId)) {
        others.push(authorId);
      }
    }
  }
  return { ids: [...selected], pulledIn: pulledIn.size, others };
}

/** Whether a row can be undone at all, given what undoing means here. */
export function canUndo(undo: CompareUndo | undefined): boolean {
  if (undo === undefined) return false;
  // A revert the schema refuses is shown with its reason rather than offered:
  // there is nothing a click could do, and a disabled control that never
  // explains itself is worse than no control.
  return undo.kind !== "revert" || undo.compatibility !== "no";
}

/** The undo kind this model offers, or null when the dialog is read-only. */
export function undoKindOf(model: CompareModel): CompareUndoKind | null {
  return model.undo?.kind ?? null;
}
