import { ReactNode } from "react";
import { ListFilter } from "lucide-react";
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
          "focus:outline-none focus:border-border-accent-primary",
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
  /** Rendered before the label: an icon, or a disclosure chevron. */
  leading?: ReactNode;
  label: ReactNode;
  /** Secondary text after the label, e.g. a URL path or item count. */
  meta?: ReactNode;
  errorCount?: number;
  hasDraft?: boolean;
  trailing?: ReactNode;
  title?: string;
};

/**
 * One row in a panel list. Kept flat and 28px tall: panels have to show
 * dozens of pages without turning into a wall of padding.
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
  title,
}: PanelRowProps) {
  return (
    <div
      className="flex items-center pr-2"
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "group flex items-center gap-1.5 min-w-0 flex-1 h-7 px-1.5 rounded-md text-xs text-left",
          selected
            ? "bg-bg-accent-subtle text-fg-accent-primary font-medium"
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
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {hasDraft && (
            <span
              title="Unpublished changes"
              className="w-1.5 h-1.5 rounded-full bg-bg-accent-primary"
            />
          )}
          {errorCount !== undefined && errorCount > 0 && (
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
    </div>
  );
}
