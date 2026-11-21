import { cn } from "../designSystem/cn";
import type { ChangedFile, FileChange } from "../../proposals/changedFiles";
import type { DiffLine } from "../../proposals/lineDiff";

/*
 * What a proposal changes of the site's code, file by file: code mode's
 * Code changes (`CodeChanges`).
 */

const CHANGE_MARK: Record<FileChange, { letter: string; tone: string }> = {
  added: { letter: "A", tone: "text-fg-brand-primary" },
  modified: { letter: "M", tone: "text-fg-warning-primary" },
  deleted: { letter: "D", tone: "text-fg-error-on-surface" },
};

export function ChangeMark({ change }: { change: FileChange }) {
  const mark = CHANGE_MARK[change];
  return (
    <span
      title={change}
      className={cn(
        "w-3 shrink-0 font-mono text-[10px] font-semibold",
        mark.tone,
      )}
    >
      {mark.letter}
    </span>
  );
}

/**
 * A file against the site's copy. Which files changed is this view's own
 * list, on its left, rather than a panel beside the preview.
 */
export function DiffArea({
  files,
  file,
  onSelect,
  lines,
  narrow = false,
}: {
  files: ChangedFile[];
  file: ChangedFile;
  onSelect: (path: string) => void;
  lines: DiffLine[];
  /** A phone: the files above the diff, rather than beside it. */
  narrow?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 gap-3",
        narrow ? "flex-col p-2" : "p-4",
      )}
    >
      <ul
        className={cn(
          "shrink-0 overflow-y-auto text-xs",
          narrow ? "max-h-32" : "w-56",
        )}
      >
        {files.map((item) => {
          const slash = item.path.lastIndexOf("/");
          return (
            <li key={item.path}>
              <button
                type="button"
                onClick={() => onSelect(item.path)}
                title={item.path}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-bg-secondary",
                  item.path === file.path && "bg-bg-secondary font-medium",
                )}
              >
                <ChangeMark change={item.change} />
                <span
                  className={cn(
                    "min-w-0 truncate",
                    item.change === "deleted" && "line-through",
                  )}
                >
                  {item.path.slice(slash + 1)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-primary">
        <div className="flex items-center gap-2 border-b border-border-primary px-4 py-2 font-mono text-xs">
          <ChangeMark change={file.change} />
          {file.path}
          {!file.staged && (
            <span
              className="font-sans text-fg-tertiary"
              title="Changed by a save of its content, not staged as code"
            >
              · content
            </span>
          )}
          <span className="ml-auto font-sans text-fg-tertiary">
            Compared with the site
          </span>
        </div>
        <DiffLines lines={lines} className="flex-1 overflow-auto py-2" />
      </div>
    </div>
  );
}

/**
 * The lines of one file's diff, on their own: what {@link DiffArea} draws, and
 * what Review draws under a file it has opened.
 */
export function DiffLines({
  lines,
  className,
}: {
  lines: DiffLine[];
  className?: string;
}) {
  return (
    <pre className={cn("font-mono text-xs leading-5", className)}>
      {lines.map((line, index) =>
        line.kind === "skip" ? (
          <div key={index} className="select-none px-4 text-fg-tertiary italic">
            ⋯ {line.count} unchanged {line.count === 1 ? "line" : "lines"}
          </div>
        ) : (
          <div
            key={index}
            className={cn(
              "flex px-4",
              line.kind === "added" &&
                "bg-bg-brand-secondary text-fg-brand-secondary",
              line.kind === "removed" &&
                "bg-bg-error-primary text-fg-error-primary",
            )}
          >
            <span className="w-5 shrink-0 select-none opacity-60">
              {line.kind === "added"
                ? "+"
                : line.kind === "removed"
                  ? "-"
                  : " "}
            </span>
            <span className="whitespace-pre">{line.text}</span>
          </div>
        ),
      )}
    </pre>
  );
}
