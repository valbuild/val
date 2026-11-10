import { CodeXml, MousePointerSquareDashed } from "lucide-react";
import { cn } from "../designSystem/cn";

/** Whose Select it is: what a pick on the page is for. */
export type SelectFor = "content" | "assistant";

/**
 * A pane's own Select: it picks on the preview, for that pane.
 *
 * There are two, one on each side of the preview, at the edge of their
 * pane's header nearest it:
 *
 * - **Content's** picks a field and opens it. It stays on until it is
 *   turned off, and the fields it can take are outlined solid.
 * - **The Assistant's** picks what the next message is about: a field, or in
 *   code mode any element. Once, then off. Outlined dashed, and in code mode
 *   in the proposal's colour, with a small `</>` on the button.
 *
 * Both look the same at rest. Pressed, each says which one is picking, the
 * way its outlines on the page do -- which is why the preview's toolbar has
 * no Select of its own: the pressed button is the one saying what a click on
 * the page will do.
 */
export function SelectButton({
  selectFor,
  pressed,
  onPressedChange,
  codeMode = false,
  label = true,
  className,
}: {
  selectFor: SelectFor;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** The Assistant's in code mode: any element, in the proposal's colour. */
  codeMode?: boolean;
  /** Whether there is room for the word beside the icon. */
  label?: boolean;
  className?: string;
}) {
  const proposal = selectFor === "assistant" && codeMode;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ACCESSIBLE_NAME[selectFor][pressed ? "on" : "off"]}
      title={
        selectFor === "content"
          ? "Select a field on the page to edit it"
          : codeMode
            ? "Select anything on the page, to ask the assistant about it"
            : "Select a field on the page, to ask the assistant about it"
      }
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium",
        pressed
          ? selectFor === "content"
            ? "border-border-brand-secondary bg-bg-float-raised text-fg-primary"
            : proposal
              ? "border-dashed border-border-proposal bg-bg-proposal-soft text-fg-proposal"
              : "border-dashed border-border-brand-secondary bg-bg-float-raised text-fg-primary"
          : "border-border-float text-fg-secondary hover:text-fg-primary",
        className,
      )}
    >
      <MousePointerSquareDashed size={14} />
      {label && "Select"}
      {proposal && <CodeXml size={11} aria-hidden />}
    </button>
  );
}

/**
 * Said as what pressing it does, and different for each: two buttons that
 * read "Select" to a screen reader are one button twice. Content's keeps the
 * names the preview toolbar's button had, which is the act it took over.
 */
const ACCESSIBLE_NAME: Record<SelectFor, { on: string; off: string }> = {
  content: {
    off: "Select on the page",
    on: "Stop selecting on the page",
  },
  assistant: {
    off: "Point the assistant at something on the page",
    on: "Stop pointing the assistant",
  },
};
