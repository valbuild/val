/**
 * What a proposal changes of the site's files, for the design tab
 * (valbuild/home `docs/design-tab.md`): every file its saves and stagings
 * wrote (`GET /proposals/:name/files`) that differs from the site's source.
 *
 * A file written with the site's own text again is no change, and is left
 * out: a save rewrites a `.val.ts` whole, whatever it changed.
 */
export type FileChange = "added" | "modified" | "deleted";

export type ChangedFile = {
  path: string;
  change: FileChange;
  /** Staged as code -- what a build is for -- rather than written by a save. */
  staged: boolean;
};

export function changedFiles(
  site: Record<string, string>,
  proposal: Record<string, string | null>,
  staged: readonly string[],
): ChangedFile[] {
  const isStaged = new Set(staged);
  const out: ChangedFile[] = [];
  for (const [path, text] of Object.entries(proposal)) {
    const before = site[path];
    const change: FileChange | null =
      text === null
        ? before === undefined
          ? null
          : "deleted"
        : before === undefined
          ? "added"
          : before === text
            ? null
            : "modified";
    if (change !== null) out.push({ path, change, staged: isStaged.has(path) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
