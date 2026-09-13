import type {
  CompareGroup,
  CompareModel,
  CompareNavNode,
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
 * The `requires` map for a whole model.
 *
 * Model-wide, not per pane. It was per pane while rows were the only thing you
 * could select and the selection was cleared on navigation — the reasoning
 * being that a bar counting rows you cannot see is a trap. Nav-level controls
 * change that: a nav row spans panes by construction, so the selection has to
 * as well, and the nav is now where a cross-pane selection is visible. The bar
 * counts what the nav shows.
 *
 * Dependencies can cross panes for a second reason: a patch set is scoped to a
 * module, but one module is one pane, so `requires` edges stay within a pane in
 * practice. Building the map across the model costs nothing and removes the
 * assumption.
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
 * The selectable rows one group heading stands for.
 *
 * Its own field rows, or — for a list — each entry plus the changed fields
 * inside it. A heading's checkbox is an aggregate over exactly this set, so
 * what it covers is defined here rather than at the checkbox.
 */
export function selectableRowIdsOfGroup(group: CompareGroup): string[] {
  const ids: string[] = [];
  const push = (id: string, undo: CompareUndo | undefined): void => {
    if (isSelectable(undo)) ids.push(id);
  };
  if (group.kind === "fields") {
    for (const row of group.rows) push(row.id, row.undo);
    return ids;
  }
  for (const item of group.rows) {
    push(item.id, item.undo);
    for (const field of item.fields ?? []) push(field.id, field.undo);
  }
  return ids;
}

/**
 * The selectable rows one nav node stands for: its own pane, and its children's.
 *
 * Recursive because a folder is structure with no pane of its own — ticking
 * `blogs` has to mean every changed page under it, which is the only reading
 * that makes a folder checkbox useful.
 */
export function selectableRowIdsOfNavNode(
  model: CompareModel,
  node: CompareNavNode,
): string[] {
  const own = model.panes[node.id];
  const ids =
    own === undefined ? [] : own.groups.flatMap(selectableRowIdsOfGroup);
  for (const child of node.children ?? []) {
    ids.push(...selectableRowIdsOfNavNode(model, child));
  }
  return ids;
}

/** Every nav node's row ids, by node id, computed once per model. */
export function navRowIdsOf(model: CompareModel): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const walk = (node: CompareNavNode): void => {
    map.set(node.id, selectableRowIdsOfNavNode(model, node));
    for (const child of node.children ?? []) walk(child);
  };
  for (const section of model.sections) {
    for (const node of section.nodes) walk(node);
  }
  return map;
}

/**
 * How a group of rows stands relative to the selection.
 *
 * Three states, because two would lie: a heading whose list is half selected
 * has to say so, or ticking it looks like it did nothing and unticking it
 * looks like it did too much.
 */
export type AggregateState = "none" | "some" | "all";

export function aggregateOf(
  ids: readonly string[],
  selected: ReadonlySet<string>,
): AggregateState {
  if (ids.length === 0) return "none";
  let hits = 0;
  for (const id of ids) {
    if (selected.has(id)) hits++;
  }
  return hits === 0 ? "none" : hits === ids.length ? "all" : "some";
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
  model: CompareModel,
  currentAuthorId: string | null,
): UndoSummary {
  const { selected, pulledIn } = closeOverRequired(
    picked,
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
  return { selected, pulledIn, othersAffected: others };
}

/**
 * Untick one row: drop it, and every pick that transitively compelled it.
 *
 * The blunt version cleared the whole selection, which was never *wrong* — a
 * dependent genuinely cannot stay behind once its predecessor goes — but it
 * threw away picks that had nothing to do with the row being unticked, and
 * left no way to say "not that one" without starting over.
 *
 * The rule is the contrapositive of the closure: if picking `a` forces `b`,
 * then refusing `b` refuses `a`. So this walks the `requires` graph BACKWARDS
 * from the unticked row and removes every pick that can reach it. Picks that
 * cannot reach it are untouched, which is the whole point.
 *
 * Unticking a row that was an explicit pick and is ALSO required by another
 * pick still drops that other pick — it has to, or the next render would put
 * the row straight back and the click would look ignored.
 */
export function dropRequiring(
  picked: ReadonlySet<string>,
  rowId: string,
  requiresById: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const next = new Set(picked);
  next.delete(rowId);
  for (const pick of picked) {
    if (pick === rowId) continue;
    if (reaches(pick, rowId, requiresById)) {
      next.delete(pick);
    }
  }
  return next;
}

/** Whether `from` compels `target`, following `requires` transitively. */
function reaches(
  from: string,
  target: string,
  requiresById: ReadonlyMap<string, readonly string[]>,
): boolean {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) continue;
    for (const next of requiresById.get(id) ?? []) {
      if (next === target) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Tick or untick a whole set of rows at once — a nav row or a group heading.
 *
 * Ticking adds every selectable id; the closure then pulls in whatever they
 * compel, exactly as a single pick does. Unticking goes through
 * {@link dropRequiring} PER ID rather than just subtracting the set, because
 * a row outside the set may have compelled one inside it, and leaving that pick
 * standing would put the row straight back on the next render.
 */
export function toggleMany(
  picked: ReadonlySet<string>,
  ids: readonly string[],
  next: boolean,
  requiresById: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  if (next) {
    const out = new Set(picked);
    for (const id of ids) out.add(id);
    return out;
  }
  let out = new Set(picked);
  for (const id of ids) {
    out = dropRequiring(out, id, requiresById);
  }
  return out;
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
