import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "./designSystem/cn";
import {
  SearchInputRow,
  commandItemClassName,
  searchInputClassName,
} from "./designSystem/command";
import { VIRTUALIZE_THRESHOLD } from "./fields/VirtualizedRecordList";

/** One option: what it is called in the list, and what a search matches. */
export type WindowedOption = {
  /** Unique within the list: what is selected, and React's key. */
  key: string;
  /** What a search is matched against, e.g. the key and its preview's title. */
  filterText: string;
};

/**
 * Something to do rather than to pick ("New entry"): below the options,
 * shown whatever the search, and reached with the arrow keys after the last
 * option.
 */
export type WindowedOptionAction = {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onSelect: () => void;
};

/** The list's height before it scrolls: the `cmdk` list's, which this replaced. */
const MAX_HEIGHT = 300;

/**
 * A searchable list of options that renders only the ones on screen: the
 * reference dropdowns' (`KeySelector`, `RouteSelector`).
 *
 * They were `cmdk` menus, and `cmdk` filters and navigates the items it has
 * MOUNTED, so every option was an element: 10,001 posts behind a `keyOf`
 * froze the tab for 2.4 s on open, and at 100,000 it did not open. This
 * filters the options itself and draws them through the virtualizer the
 * record list and the media picker use, past {@link VIRTUALIZE_THRESHOLD};
 * a short list renders plainly, exactly as a long one does on screen.
 *
 * The input keeps the focus, as `cmdk`'s did: the arrow keys, Home and End
 * move the active option (scrolled to, so it is mounted), Enter picks it, and
 * the active option is the input's `aria-activedescendant`. A search matches
 * every word it has, anywhere in an option's `filterText`, ignoring case, and
 * keeps the options in their order.
 */
export function WindowedOptionList<T extends WindowedOption>({
  options,
  renderOption,
  onSelect,
  selectedKey,
  search,
  onSearchChange,
  placeholder,
  emptyText,
  isLoading = false,
  actions = [],
  estimateSize = 36,
  label,
}: {
  options: readonly T[];
  renderOption: (option: T, state: { selected: boolean }) => React.ReactNode;
  onSelect: (option: T) => void;
  /** The option that is the field's value now: active when the list opens. */
  selectedKey: string | null;
  search: string;
  onSearchChange: (search: string) => void;
  placeholder: string;
  emptyText: string;
  isLoading?: boolean;
  actions?: readonly WindowedOptionAction[];
  /** A row's height before it is measured, in px. */
  estimateSize?: number;
  /** What the list is, for a screen reader. */
  label?: string;
}) {
  const id = React.useId();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  /**
   * The search has the focus when the list opens, so it can be typed into
   * and arrowed through at once. After Radix's own: inside the Studio's
   * shadow root, a popover cannot tell that focusing its first field worked
   * (it compares `document.activeElement`, which is the shadow host either
   * way) and moves the focus to itself.
   */
  React.useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);
  const shown = React.useMemo(
    () => filterOptions(options, search),
    [options, search],
  );
  const virtualize = shown.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: virtualize ? shown.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan: 8,
  });
  /** Options, then actions: what the arrow keys walk. */
  const total = isLoading ? 0 : shown.length + actions.length;
  const [active, setActive] = React.useState(() => {
    const selected =
      selectedKey === null
        ? -1
        : shown.findIndex((option) => option.key === selectedKey);
    return selected >= 0 ? selected : 0;
  });
  /**
   * Whether the list has been put at the value yet: once, when the value is
   * among the options -- on open, or when it arrives, for a list opened
   * while they were loading -- and never after the editor has searched or
   * moved, which is theirs to decide.
   */
  const placed = React.useRef(false);
  // A new search starts from its first match, as `cmdk` did: the option the
  // editor most likely typed towards. Not on the first render, which starts
  // from the value.
  const searched = React.useRef(search);
  React.useEffect(() => {
    if (searched.current === search) return;
    searched.current = search;
    placed.current = true;
    setActive(0);
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [search]);
  // The value is where the list opens, even 9,000 options down.
  React.useLayoutEffect(() => {
    if (placed.current || isLoading || shown.length === 0) return;
    const selected =
      selectedKey === null
        ? -1
        : shown.findIndex((option) => option.key === selectedKey);
    // Not among them yet: it may be among the next to arrive.
    if (selected < 0 && selectedKey !== null) return;
    placed.current = true;
    if (selected < 0) return;
    if (selected !== active) setActive(selected);
    if (selected > 0) scrollTo(selected, "center");
  });

  const scrollTo = (index: number, align: "auto" | "center") => {
    if (index >= shown.length) return; // an action: never scrolled away
    if (virtualize) {
      virtualizer.scrollToIndex(index, { align });
      return;
    }
    // Looked up under the list, not by id: inside the Studio's shadow root
    // `document` cannot find it.
    scrollRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  };
  const moveTo = (index: number) => {
    if (total === 0) return;
    placed.current = true;
    const next = Math.max(0, Math.min(total - 1, index));
    setActive(next);
    scrollTo(next, "auto");
  };
  const choose = (index: number) => {
    if (index < shown.length) {
      onSelect(shown[index]);
      return;
    }
    actions[index - shown.length]?.onSelect();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTo(active + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveTo(active - 1);
        return;
      case "Home":
        event.preventDefault();
        moveTo(0);
        return;
      case "End":
        event.preventDefault();
        moveTo(total - 1);
        return;
      case "Enter":
        // The Enter that ends an IME composition (Japanese, Chinese,
        // Korean...) commits the text, not an option: `cmdk` ignored it too.
        // Safari reports it only as key code 229.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (active < total) {
          event.preventDefault();
          choose(active);
        }
        return;
    }
  };

  const activeId = active < total ? optionId(id, active) : undefined;
  const option = (index: number, style?: React.CSSProperties) => {
    const item = shown[index];
    return (
      <div
        key={item.key}
        id={optionId(id, index)}
        role="option"
        aria-selected={index === active}
        aria-setsize={shown.length}
        aria-posinset={index + 1}
        data-index={index}
        ref={virtualize ? virtualizer.measureElement : undefined}
        className={cn(
          commandItemClassName,
          "flex items-center gap-2",
          virtualize && "absolute left-0 top-0 w-full",
        )}
        style={style}
        onPointerMove={() => {
          if (index !== active) setActive(index);
        }}
        // The input keeps the focus, as it would in `cmdk`.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(index)}
      >
        {renderOption(item, { selected: item.key === selectedKey })}
      </div>
    );
  };

  return (
    // The keys are taken here rather than on the input, so they work wherever
    // in the list the focus is -- as they did in `cmdk`, which took them on
    // its root.
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-md bg-bg-primary text-fg-primary"
      onKeyDown={onKeyDown}
    >
      <SearchInputRow>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={true}
          aria-controls={listboxId(id)}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          className={searchInputClassName}
          placeholder={placeholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </SearchInputRow>
      <div id={listboxId(id)} role="listbox" aria-label={label}>
        {isLoading ? (
          <div className="py-6 text-center text-sm">Loading...</div>
        ) : shown.length === 0 ? (
          <div className="py-6 text-center text-sm">{emptyText}</div>
        ) : (
          <div
            ref={scrollRef}
            className="overflow-y-auto overflow-x-hidden p-1"
            style={{ maxHeight: MAX_HEIGHT }}
          >
            {virtualize ? (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: "relative",
                }}
              >
                {virtualizer.getVirtualItems().map((row) =>
                  option(row.index, {
                    transform: `translateY(${row.start}px)`,
                  }),
                )}
              </div>
            ) : (
              shown.map((_, index) => option(index))
            )}
          </div>
        )}
        {!isLoading && actions.length > 0 && (
          <>
            <div className="h-px bg-border-primary opacity-50" />
            <div role="group" className="p-1">
              {actions.map((action, i) => {
                const index = shown.length + i;
                return (
                  <div
                    key={action.id}
                    id={optionId(id, index)}
                    role="option"
                    aria-selected={index === active}
                    className={cn(commandItemClassName, "flex gap-2")}
                    onPointerMove={() => {
                      if (index !== active) setActive(index);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(index)}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The options a search keeps: those whose `filterText` has every word of it,
 * ignoring case, in their own order.
 */
export function filterOptions<T extends WindowedOption>(
  options: readonly T[],
  search: string,
): readonly T[] {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((option) => {
    const text = option.filterText.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

function listboxId(id: string): string {
  return `${id}-listbox`;
}

function optionId(id: string, index: number): string {
  return `${id}-option-${index}`;
}
