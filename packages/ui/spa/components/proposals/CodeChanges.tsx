import { useState } from "react";
import { PencilLine } from "lucide-react";
import type { ChangedFile } from "../../proposals/changedFiles";
import type { DiffLine } from "../../proposals/lineDiff";
import { DiffArea } from "./DiffArea";
import { CodeModeStatus, type CodeModeBuild } from "./CodeModeStatus";

export type { CodeModeBuild } from "./CodeModeStatus";

/**
 * What the proposal changes of the site's code, in Review beside the
 * content changes.
 *
 * Beside the Studio's own preview, not with one of its own. Code mode used to
 * replace the editor AND the canvas with a workspace that had its own frame
 * of the site -- a bare `<iframe>`, so nothing on it could be picked, no
 * content edit reached it, and its buttons were not the canvas's. Now the
 * canvas is the same in every mode; only this column changes, and "Edit
 * content" (or picking a field on the page) puts the content editor back in
 * its place.
 *
 * Whether the preview is up to date is the status at the top, which keeps one
 * width in every state, so nothing moves when it changes.
 *
 * Presentational: the files, their diffs and the build come in as props.
 */
export function CodeChanges({
  build,
  onReload,
  files,
  diffOf,
  filesError = null,
  onEditContent,
}: {
  build: CodeModeBuild;
  /** Load the page in the preview again. */
  onReload: () => void;
  /** What the proposal changes of the site's files. */
  files: ChangedFile[];
  diffOf: (path: string) => DiffLine[];
  /** The changes could not be read: said here, with a way to try again. */
  filesError?: { message: string; onRetry: () => void } | null;
  /** Put the content editor in this column instead. */
  onEditContent: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(
    files[0]?.path ?? null,
  );
  const file = files.find((each) => each.path === selected) ?? files[0];
  return (
    <div className="flex min-h-[60svh] flex-col overflow-hidden rounded-lg border border-border-proposal bg-bg-float">
      {/* Wraps rather than clips: the editor's column can be 340px. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border-float px-3 py-2">
        <h2 className="whitespace-nowrap text-xs font-medium text-fg-primary">
          Code changes
        </h2>
        {files.length > 0 && (
          <span className="text-xs tabular-nums text-fg-secondary-alt">
            {files.length}
          </span>
        )}
        <div className="flex-1" />
        <CodeModeStatus build={build} onReload={onReload} />
        <button
          type="button"
          onClick={onEditContent}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-float px-2 text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <PencilLine size={13} aria-hidden />
          Edit content
        </button>
      </div>
      {filesError !== null ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8">
          <p className="max-w-sm text-center text-sm text-fg-secondary">
            The code changes could not be read.
          </p>
          <button
            type="button"
            onClick={filesError.onRetry}
            className="inline-flex h-8 items-center rounded-md border border-border-float px-3 text-xs font-medium text-fg-primary hover:bg-bg-float-raised"
          >
            Try again
          </button>
          <details className="max-w-sm text-xs text-fg-secondary-alt">
            <summary className="cursor-pointer">Details</summary>
            {filesError.message}
          </details>
        </div>
      ) : files.length === 0 || file === undefined ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <p className="max-w-sm text-center text-sm text-fg-secondary">
            No code is changed yet. Ask the assistant for a change, and it shows
            up here.
          </p>
        </div>
      ) : (
        <DiffArea
          files={files}
          file={file}
          onSelect={setSelected}
          lines={diffOf(file.path)}
          narrow
        />
      )}
    </div>
  );
}
