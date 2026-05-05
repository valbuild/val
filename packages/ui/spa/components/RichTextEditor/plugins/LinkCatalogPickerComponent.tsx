import { useCallback } from "react";
import { Check } from "lucide-react";
import type { EditorLinkCatalogItem } from "../types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../designSystem/command";
import { cn } from "../../designSystem/cn";

export interface LinkCatalogPickerProps {
  catalog: EditorLinkCatalogItem[];
  currentHref: string | null;
  onApplyLink: (item: EditorLinkCatalogItem) => void;
  onRemoveLink: (() => void) | null;
  onClose: () => void;
}

export function LinkCatalogPicker({
  catalog,
  currentHref,
  onApplyLink,
  onRemoveLink,
  onClose,
}: LinkCatalogPickerProps) {
  const catalogByHref = new Map(
    catalog.map((item) => [item.href.trim(), item]),
  );

  const handleSelect = useCallback(
    (href: string) => {
      const item = catalogByHref.get(href);
      if (item) onApplyLink(item);
    },
    [catalogByHref, onApplyLink],
  );

  return (
    <Command
      filter={(value, search) => {
        const item = catalogByHref.get(value);
        if (!item) return 0;
        const q = search.toLowerCase();
        if (
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.href.trim().toLowerCase().includes(q)
        ) {
          return 1;
        }
        return 0;
      }}
    >
      <CommandInput
        placeholder="Filter..."
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
          }
        }}
      />
      <CommandList>
        <CommandEmpty>No matches</CommandEmpty>
        <CommandGroup>
          {catalog.map((item) => {
            const href = item.href.trim();
            const isCurrent = currentHref !== null && href === currentHref;
            return (
              <CommandItem
                key={href}
                value={href}
                onSelect={handleSelect}
                className="flex items-center gap-2"
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isCurrent ? "opacity-100" : "opacity-0",
                  )}
                />
                {item.image && (
                  <img
                    src={item.image}
                    alt={item.title}
                    className="h-8 w-8 rounded object-cover shrink-0"
                  />
                )}
                <div className="flex flex-col min-w-0">
                  <span
                    className={cn(
                      "font-medium truncate",
                      isCurrent ? "text-fg-brand-primary" : "text-fg-primary",
                    )}
                  >
                    {item.title}
                  </span>
                  <span className="text-xs text-fg-secondary truncate">
                    {item.subtitle}
                  </span>
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>

      {onRemoveLink && (
        <div className="border-t border-border-primary p-1">
          <button
            type="button"
            className={cn(
              "w-full rounded px-2 py-1.5 text-left text-sm text-fg-secondary",
              "transition-colors hover:bg-bg-secondary-hover",
            )}
            onMouseDown={onRemoveLink}
          >
            Remove link
          </button>
        </div>
      )}
    </Command>
  );
}
