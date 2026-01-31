import DiffMatchPatch from "diff-match-patch";

/**
 * InlineTextDiff component shows character-level differences between two text strings
 * Uses Google's diff-match-patch algorithm for precision
 */
export function InlineTextDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(before, after);
  dmp.diff_cleanupSemantic(diffs); // Clean up for better readability

  return (
    <div className="font-mono text-sm p-3 bg-bg-tertiary rounded-lg border border-border-secondary whitespace-pre-wrap leading-relaxed">
      {diffs.map(([operation, text], i) => {
        if (operation === 0) {
          // No change
          return (
            <span key={i} className="text-fg-primary">
              {text}
            </span>
          );
        }
        if (operation === 1) {
          // Addition
          return (
            <ins
              key={i}
              className="bg-brand-secondary text-fg-brand-secondary no-underline px-0.5 rounded"
            >
              {text}
            </ins>
          );
        }
        if (operation === -1) {
          // Deletion
          return (
            <del
              key={i}
              className="bg-error-secondary text-fg-error-secondary line-through px-0.5 rounded"
            >
              {text}
            </del>
          );
        }
        return null;
      })}
    </div>
  );
}
