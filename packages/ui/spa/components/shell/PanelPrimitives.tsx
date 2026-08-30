import { ReactNode, useId } from "react";
import { AlertTriangle, ListFilter } from "lucide-react";
import { cn } from "../designSystem/cn";

/**
 * Filters the list already in the panel. This is deliberately not a search:
 * it narrows what is in front of you, and never reaches outside the panel.
 * Searching across the whole project is `GlobalSearch`.
 */
export function PanelFilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <ListFilter
        size={14}
        aria-hidden
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary-alt"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          "w-full h-8 pl-8 pr-2 rounded-md text-xs",
          "bg-bg-float-raised border border-transparent text-fg-primary",
          "placeholder:text-fg-secondary-alt",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        )}
      />
    </div>
  );
}

export type PanelRowProps = {
  /** Nesting depth. Each level indents by 12px. */
  depth?: number;
  selected?: boolean;
  onClick?: () => void;
  /**
   * Whether the row's own click discloses something below it.
   *
   * Set it and the row announces itself as a disclosure, which is what a row
   * that only expands is — and what a screen reader otherwise has no way to
   * know from a chevron drawn in `leading`.
   */
  expanded?: boolean;
  /** Rendered before the label: an icon, or a disclosure chevron. */
  leading?: ReactNode;
  label: ReactNode;
  /** Secondary text after the label, e.g. a URL path or item count. */
  meta?: ReactNode;
  errorCount?: number;
  hasDraft?: boolean;
  trailing?: ReactNode;
  /**
   * A control of its own, beside the row rather than inside it.
   *
   * `trailing` lives inside the row's own button, so anything interactive there
   * would be a button inside a button. This is where a second action goes —
   * "open this in the editor" on a row whose click expands it.
   */
  action?: ReactNode;
  title?: string;
};

/**
 * One row in a panel list. Kept flat and 28px tall: panels have to show
 * dozens of pages without turning into a wall of padding.
 *
 * The badges are `aria-hidden`, with what they mean moved to a description the
 * row points at. They used to sit in the row's own button carrying only a
 * `title`, which made them part of its ACCESSIBLE NAME: the home page announced
 * itself as "/ Unpublished changes", and as "/1" once it had a validation error.
 * A name that changes with the row's state is wrong twice over — a screen reader
 * reads the state as part of the page's name, and every `getByRole("button",
 * { name, exact: true })` in the suite silently stops matching the moment
 * someone edits that page. The name is the label; the state is a description.
 */
export function PanelRow({
  depth = 0,
  selected,
  onClick,
  leading,
  label,
  meta,
  errorCount,
  hasDraft,
  trailing,
  action,
  expanded,
  title,
}: PanelRowProps) {
  const hasErrors = errorCount !== undefined && errorCount > 0;
  const notes = [
    hasDraft ? "Unpublished changes" : null,
    hasErrors
      ? `${errorCount} validation error${errorCount === 1 ? "" : "s"}`
      : null,
  ].filter((note): note is string => note !== null);
  /*
   * Referenced by the row rather than nested in it, so it describes the row
   * without naming it. A `display: none` description is still read out through
   * `aria-describedby`, which is why it can be `hidden`.
   */
  const notesId = useId();
  return (
    <div
      // `group/row` so an action can reveal itself on hover over the whole row,
      // not only over itself.
      className="group/row flex items-center pr-2"
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-current={selected ? "true" : undefined}
        aria-expanded={expanded}
        aria-describedby={notes.length > 0 ? notesId : undefined}
        className={cn(
          "group flex items-center gap-1.5 min-w-0 flex-1 h-7 px-1.5 rounded-md text-xs text-left",
          selected
            ? "bg-bg-float-raised text-fg-primary font-medium"
            : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
        )}
      >
        {leading !== undefined && (
          <span className="shrink-0 grid place-items-center w-3.5 h-3.5">
            {leading}
          </span>
        )}
        <span className="truncate">{label}</span>
        {meta !== undefined && (
          <span className="truncate text-fg-secondary-alt font-normal">
            {meta}
          </span>
        )}
        {notes.length > 0 && (
          <span id={notesId} hidden>
            {notes.join(", ")}
          </span>
        )}
        <span
          aria-hidden
          className="ml-auto flex items-center gap-1.5 shrink-0"
        >
          {hasDraft && (
            <span
              title="Unpublished changes"
              className="w-1.5 h-1.5 rounded-full bg-fg-secondary"
            />
          )}
          {hasErrors && (
            <span
              title={`${errorCount} validation error${errorCount === 1 ? "" : "s"}`}
              className="min-w-[1rem] h-4 px-1 grid place-items-center rounded bg-bg-error-primary text-fg-error-primary text-[0.625rem] font-semibold tabular-nums"
            >
              {errorCount}
            </span>
          )}
          {trailing}
        </span>
      </button>
      {action}
    </div>
  );
}

/**
 * Placeholder rows while a panel's data loads.
 *
 * Rows rather than a spinner: the panel keeps its shape, so nothing jumps
 * when the real list arrives.
 */
export function PanelSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="py-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center h-7 px-3.5">
          <span
            className="h-2.5 rounded bg-bg-float-raised animate-pulse"
            // Varying widths so it reads as a list, not a progress bar.
            style={{ width: `${45 + ((i * 17) % 45)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A panel could not load. Distinct from an empty panel: something is wrong
 * and there is something to do about it.
 */
export function PanelErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex gap-2.5 px-4 py-4">
      <AlertTriangle
        size={14}
        className="mt-0.5 shrink-0 text-fg-error-on-surface"
      />
      <div className="min-w-0">
        <p className="text-xs text-fg-primary">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 h-7 px-2 rounded-md text-xs text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
