import { useState, type ReactNode } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "../components/designSystem/cn";
import type {
  ComparePageDevice,
  ComparePageView,
  CompareSide,
} from "../compare/types";

/**
 * One page, before and after: the two renders next to each other.
 *
 * For any route, not only the ones Review lists as changed. A code change can
 * reach a page nothing here could have predicted, so a reviewer who suspects
 * one can always look.
 *
 * What a side IS belongs to the caller, as in the compare dialog: a frame of
 * the site, a frame of the proposal, a picture in a story.
 */
export function ReviewPagePane({
  url,
  left,
  right,
  renderPage,
}: {
  url: string;
  left: CompareSide;
  right: CompareSide;
  renderPage: (page: ComparePageView) => ReactNode;
}) {
  const [device, setDevice] = useState<ComparePageDevice>("desktop");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <Segmented
          label="Width"
          value={device}
          onChange={setDevice}
          options={[
            { value: "desktop", label: "Desktop", icon: <Monitor size={13} /> },
            {
              value: "mobile",
              label: "Mobile",
              icon: <Smartphone size={13} />,
            },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
        <PageSide side={left}>
          {renderPage({ url, side: "left", device })}
        </PageSide>
        <PageSide side={right}>
          {renderPage({ url, side: "right", device })}
        </PageSide>
      </div>
    </div>
  );
}

function PageSide({
  side,
  children,
}: {
  side: CompareSide;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <SideHeading side={side} />
      <div className="flex min-h-0 flex-1 justify-center overflow-auto rounded-md bg-bg-secondary p-3">
        {children}
      </div>
    </div>
  );
}

/** A column's name and what it is, as the fields view heads its columns too. */
export function SideHeading({ side }: { side: CompareSide }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="truncate text-xs font-semibold uppercase tracking-wider text-fg-secondary">
        {side.label}
      </span>
      {side.caption !== undefined && (
        <span className="truncate text-xs text-fg-tertiary">
          {side.caption}
        </span>
      )}
    </div>
  );
}

/** Two or three choices of which exactly one is on. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  /** What is being chosen, for a screen reader. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 rounded-md border border-border-secondary p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium",
            option.value === value
              ? "bg-bg-secondary text-fg-primary"
              : "text-fg-tertiary hover:text-fg-secondary",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
