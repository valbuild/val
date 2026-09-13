import { ArrowRightLeft, Minus, Pencil, Plus } from "lucide-react";
import { cn } from "../components/designSystem/cn";
import type { CompareChangeKind } from "./types";

/**
 * The four marks, and the words that go with them.
 *
 * One table rather than a switch at each call site, because these appear in the
 * nav, on list entries and in the pane header, and a fourth kind added in one
 * place and missed in another is a row that silently reads as unchanged.
 *
 * `label` is the accessible name and the tooltip. It is phrased against the
 * comparison rather than the clock — "Added" not "New" — so the same word works
 * whether the right column is a publish or a commit.
 */
const MARKS: Record<
  Exclude<CompareChangeKind, "unchanged">,
  {
    Icon: typeof Plus;
    label: string;
    /** Foreground for the glyph. */
    className: string;
  }
> = {
  added: {
    Icon: Plus,
    label: "Added",
    /*
     * There is no `--fg-success` token in the theme, and this is the one place
     * that needs a green: every other affirmative surface in the Studio uses
     * the brand colour, which here would collide with selection. Named with the
     * palette's own scale so a token, when there is one, is a find-and-replace.
     */
    className: "text-emerald-600 dark:text-emerald-400",
  },
  removed: {
    Icon: Minus,
    label: "Removed",
    className: "text-fg-error-primary",
  },
  changed: {
    Icon: Pencil,
    label: "Changed",
    className: "text-fg-brand-primary",
  },
  moved: {
    Icon: ArrowRightLeft,
    label: "Moved",
    className: "text-fg-secondary",
  },
};

export function changeKindLabel(kind: CompareChangeKind): string {
  return kind === "unchanged" ? "Unchanged" : MARKS[kind].label;
}

/**
 * The rail colour for one side of a diff.
 *
 * A rail is the only colour on a value: the left column is what is being left
 * behind and the right is what replaces it, so before is always the `removed`
 * red and after always the `added` green, regardless of what the ROW's change
 * kind is. A changed field therefore gets a red rail beside its old value and a
 * green one beside its new one, which is what makes a stacked mobile layout
 * legible without reading the captions.
 */
export function sideRailClass(side: "before" | "after"): string {
  return side === "before"
    ? "border-l-2 border-l-fg-error-primary"
    : "border-l-2 border-l-emerald-600 dark:border-l-emerald-400";
}

export function ChangeKindIcon({
  kind,
  size = 14,
  className,
  /** Omit the label when an adjacent element already names the change. */
  hideLabel = false,
}: {
  kind: CompareChangeKind;
  size?: number;
  className?: string;
  hideLabel?: boolean;
}) {
  if (kind === "unchanged") {
    /*
     * Space, not a glyph. Unchanged rows only appear once "Show all fields" is
     * on, and marking them would put a fourth symbol in a column whose job is
     * to make the three real ones scannable — but dropping the element would
     * unalign every label in the list.
     */
    return (
      <span
        className={cn("inline-block shrink-0", className)}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }
  const { Icon, label, className: markClass } = MARKS[kind];
  return (
    <Icon
      size={size}
      className={cn("shrink-0", markClass, className)}
      aria-hidden={hideLabel}
      aria-label={hideLabel ? undefined : label}
    />
  );
}
