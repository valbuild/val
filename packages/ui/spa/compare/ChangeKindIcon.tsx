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
    // Matches the "added" rail. See `segmentClass` for why blue and not green.
    className: "text-sky-600 dark:text-sky-400",
  },
  removed: {
    Icon: Minus,
    label: "Removed",
    className: "text-rose-600 dark:text-rose-400",
  },
  changed: {
    Icon: Pencil,
    label: "Changed",
    /*
     * Neutral, not the brand colour.
     *
     * A pencil in the accent read as an edit BUTTON rather than as a status —
     * it is the only accent-coloured thing on a row, and everything else in the
     * Studio that colour is clickable. The change it marks is already carried
     * by the highlighted words inside the value.
     */
    className: "text-fg-tertiary",
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
    ? "border-l-2 border-l-rose-600 dark:border-l-rose-400"
    : "border-l-2 border-l-sky-600 dark:border-l-sky-400";
}

/**
 * Added is BLUE, not green — Payload's choice, for two reasons that both apply
 * here.
 *
 * The first is that Val's accent is themable and this project's is a mint
 * green, so an emerald "added" rail sat a few degrees from the brand colour and
 * read as "this row is highlighted" rather than "this content is new". Red and
 * blue cannot collide with an accent the same way, because nothing else on this
 * screen is either.
 *
 * The second is red/green, which roughly one man in twelve cannot separate. Red
 * and blue differ in hue AND in lightness, so the distinction survives being
 * desaturated.
 *
 * Fixed palette steps rather than theme tokens, deliberately: these are
 * statements about the diff, not about the product, and a project that themed
 * its accent red would otherwise make "removed" mean two things. The `dark:`
 * pair is the existing convention in this file.
 */
export function segmentClass(kind: "same" | "removed" | "added"): string {
  if (kind === "same") return "";
  return kind === "removed"
    ? "bg-rose-500/20 text-rose-700 line-through decoration-rose-500/60 dark:text-rose-200"
    : "bg-sky-500/20 text-sky-800 dark:text-sky-100";
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
