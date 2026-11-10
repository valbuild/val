/**
 * A file against the site's copy of it, line by line, for the design tab's
 * Changes view (valbuild/home `docs/design-tab.md`).
 *
 * The longest common subsequence of the lines, after the lines the two share
 * at the start and the end are set aside -- which is most of a file an
 * assistant changed in a few places, and what keeps the table small. A middle
 * too big for the table is shown as removed and added whole: correct, only
 * less precise, and a file that size is not read in a diff anyway.
 *
 * Long runs of unchanged lines are folded to `skip`, keeping
 * {@link CONTEXT} lines either side of every change.
 */
export type DiffLine =
  | { kind: "context" | "added" | "removed"; text: string }
  | { kind: "skip"; count: number };

/** Unchanged lines kept around each change. */
export const CONTEXT = 3;

/** The largest middle (old lines times new lines) worth a table. */
const MAX_CELLS = 4_000_000;

/**
 * `before` is the site's text, `after` the proposal's; `null` is a file that
 * is not there (added, or deleted).
 */
export function lineDiff(
  before: string | null,
  after: string | null,
): DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const lines: Exclude<DiffLine, { kind: "skip" }>[] = [];
  for (let i = 0; i < start; i++) lines.push({ kind: "context", text: a[i] });
  lines.push(...middle(a.slice(start, endA), b.slice(start, endB)));
  for (let i = endA; i < a.length; i++) {
    lines.push({ kind: "context", text: a[i] });
  }
  return folded(lines);
}

function linesOf(text: string | null): string[] {
  if (text === null || text === "") return [];
  const lines = text.split("\n");
  // A final newline ends the last line; it does not start another.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function middle(
  a: string[],
  b: string[],
): Exclude<DiffLine, { kind: "skip" }>[] {
  const removed = a.map((text) => ({ kind: "removed" as const, text }));
  const added = b.map((text) => ({ kind: "added" as const, text }));
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_CELLS) {
    return [...removed, ...added];
  }
  // lengths[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lengths: Uint32Array[] = [];
  for (let i = 0; i <= a.length; i++) {
    lengths.push(new Uint32Array(b.length + 1));
  }
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const out: Exclude<DiffLine, { kind: "skip" }>[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i] });
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ kind: "removed", text: a[i] });
      i++;
    } else {
      out.push({ kind: "added", text: b[j] });
      j++;
    }
  }
  for (; i < a.length; i++) out.push({ kind: "removed", text: a[i] });
  for (; j < b.length; j++) out.push({ kind: "added", text: b[j] });
  return out;
}

function folded(lines: Exclude<DiffLine, { kind: "skip" }>[]): DiffLine[] {
  const near = new Uint8Array(lines.length);
  lines.forEach((line, index) => {
    if (line.kind === "context") return;
    const from = Math.max(0, index - CONTEXT);
    const to = Math.min(lines.length - 1, index + CONTEXT);
    for (let k = from; k <= to; k++) near[k] = 1;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (near[index]) {
      if (skipped > 0) out.push({ kind: "skip", count: skipped });
      skipped = 0;
      out.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped > 0) out.push({ kind: "skip", count: skipped });
  return out;
}
