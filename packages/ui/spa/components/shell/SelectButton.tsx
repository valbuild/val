import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CodeXml,
  MousePointerSquareDashed,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import type { CanvasSelectMode } from "../../hooks/selectModePreference";
import { useDismissOnOutsidePointer } from "./useDismissOnOutsidePointer";

/** Whose Select it is: what a pick on the page is for. */
export type SelectFor = "content" | "assistant";

/**
 * A pane's own Select: it picks on the preview, for that pane.
 *
 * There are two, one on each side of the preview, at the edge of their
 * pane's header nearest it:
 *
 * - **Content's** picks a field and opens it. It stays on until it is
 *   turned off, and the fields it can take are outlined solid. Where it is
 *   given a `mode`, it has two: **Select**, which opens the field in the
 *   column, and **Select & edit**, which puts the caret in a text where the
 *   page shows it. The button says which, and a menu beside it changes it.
 *   In either, a list rendered with `ValComponentEditor` shows the controls
 *   to arrange it on the page while this is on.
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
  mode,
  onModeChange,
  codeMode = false,
  label = true,
  unavailable,
  className,
}: {
  selectFor: SelectFor;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /**
   * Content's two modes: which one a pick is. With `onModeChange`, the
   * button grows a menu to choose between them; without, it is the one
   * Select it always was.
   */
  mode?: CanvasSelectMode;
  onModeChange?: (mode: CanvasSelectMode) => void;
  /** The Assistant's in code mode: any element, in the proposal's colour. */
  codeMode?: boolean;
  /** Whether there is room for the word beside the icon. */
  label?: boolean;
  /**
   * Nothing on the page can be picked yet: it has not said what is on it.
   * Shown, so the header does not shift when it does, and said why.
   */
  unavailable?: string;
  className?: string;
}) {
  const proposal = selectFor === "assistant" && codeMode;
  const editing = selectFor === "content" && mode === "edit";
  const Icon = editing ? TextCursorInput : MousePointerSquareDashed;
  const names = editing ? EDIT_NAME : ACCESSIBLE_NAME[selectFor];
  const tone = pressed
    ? selectFor === "content"
      ? "border-border-brand-secondary bg-bg-float-raised text-fg-primary"
      : proposal
        ? "border-dashed border-border-proposal bg-bg-proposal-soft text-fg-proposal"
        : "border-dashed border-border-brand-secondary bg-bg-float-raised text-fg-primary"
    : "border-border-float text-fg-secondary";
  const toggle = (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={unavailable !== undefined}
      aria-label={names[pressed ? "on" : "off"]}
      title={
        unavailable !== undefined
          ? unavailable
          : selectFor === "content"
            ? editing
              ? "Select a text on the page to type in it there"
              : "Select a field on the page to edit it"
            : codeMode
              ? "Select anything on the page, to ask the assistant about it"
              : "Select a field on the page, to ask the assistant about it"
      }
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 px-2 text-xs font-medium",
        !pressed && "hover:text-fg-primary",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-fg-secondary",
        // Alone, it is the whole button and carries the border itself.
        (selectFor !== "content" || onModeChange === undefined) &&
          cn("rounded-md border", tone, className),
      )}
    >
      <Icon size={14} />
      {label && (editing ? "Select & edit" : "Select")}
      {proposal && <CodeXml size={11} aria-hidden />}
    </button>
  );
  if (selectFor !== "content" || onModeChange === undefined) return toggle;
  return (
    <SelectModeMenu
      mode={mode ?? "select"}
      onModeChange={(next) => {
        onModeChange(next);
        // Choosing what selecting does is asking to select that way: a
        // mode picked and then not on is a second click for nothing.
        if (unavailable === undefined) onPressedChange(true);
      }}
      tone={tone}
      className={className}
    >
      {toggle}
    </SelectModeMenu>
  );
}

/**
 * Content's Select with its menu: the toggle, a divider, and a chevron that
 * opens the two modes. The same split button the top bar's Preview is, and
 * dismissed the same ways.
 */
function SelectModeMenu({
  mode,
  onModeChange,
  tone,
  className,
  children,
}: {
  mode: CanvasSelectMode;
  onModeChange: (mode: CanvasSelectMode) => void;
  tone: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Esc with the menu open closes the menu, and is not also the Esc
      // that turns Select off.
      event.stopPropagation();
      setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen]);
  return (
    <div ref={containerRef} className="relative shrink-0">
      <div
        className={cn(
          "inline-flex h-7 items-stretch overflow-hidden rounded-md border",
          tone,
          className,
        )}
      >
        {children}
        <span aria-hidden className="w-px self-stretch bg-border-float" />
        <button
          type="button"
          aria-label="Choose what selecting on the page does"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="grid w-5 place-items-center hover:text-fg-primary"
        >
          <ChevronDown size={12} />
        </button>
      </div>
      {isOpen && (
        <div
          role="menu"
          aria-label="What selecting on the page does"
          className="absolute right-0 top-full z-full mt-1 w-60 rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
        >
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === option.mode}
              onClick={() => {
                setIsOpen(false);
                onModeChange(option.mode);
              }}
              className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
            >
              <option.icon size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs">{option.label}</span>
                <span className="block text-[0.6875rem] text-fg-secondary-alt">
                  {option.detail}
                </span>
              </span>
              {mode === option.mode && (
                <Check size={13} className="mt-0.5 shrink-0" aria-hidden />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MODES: readonly {
  mode: CanvasSelectMode;
  icon: LucideIcon;
  label: string;
  detail: string;
}[] = [
  {
    mode: "edit",
    icon: TextCursorInput,
    label: "Select & edit",
    detail: "Type in a text where the page shows it",
  },
  {
    mode: "select",
    icon: MousePointerSquareDashed,
    label: "Select",
    detail: "Open the field here, in the column",
  },
];

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

/** Content's Select in its other mode: see `CanvasSelectMode`. */
const EDIT_NAME = {
  off: "Select and edit on the page",
  on: "Stop selecting and editing on the page",
};
