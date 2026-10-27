import { Check, ChevronDown } from "lucide-react";
import { AIModel, AIModelInfo } from "../hooks/useAIWebSocket";
import { Button } from "./designSystem/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./designSystem/dropdown-menu";
import { cn } from "./designSystem/cn";

/** What the picker button says: the chosen model's label, or a prompt. */
export const MODEL_UNSET = "Model";

export function selectedModelLabel(
  models: AIModelInfo[],
  selected: AIModel | null | undefined,
): string {
  const match = selected
    ? models.find(
        (info) =>
          info.ref.provider === selected.provider &&
          info.ref.model === selected.model,
      )
    : undefined;
  return match?.label ?? MODEL_UNSET;
}

/**
 * Which model answers the next message.
 *
 * Two things here are the fix for a picker that looked broken:
 *
 * It renders for a SINGLE model too. It used to hide itself below two entries,
 * on the reasoning that a picker with nothing to pick is noise — but which
 * model is answering is worth knowing even when it cannot be changed, and a
 * control that appears only once a second model shows up reads as a missing
 * feature rather than as an honest UI. Nothing renders when the list is empty,
 * which is "AI is off" and not "one choice".
 *
 * And the menu is PORTALLED INTO THE STUDIO's container. The Studio renders in
 * a shadow root, and a Radix portal with no `container` lands in
 * `document.body`, outside it — where none of Val's styles reach it and nothing
 * gives it a stacking context above the overlay. The menu did open; it was just
 * invisible behind the Studio, which is what made the button look dead. Every
 * other Studio popup passes this; this one did not. See `ValPortalProvider`.
 */
export function AIChatModelPicker({
  models,
  selectedModel,
  onSelectModel,
  disabled,
  portalContainer,
}: {
  models: AIModelInfo[];
  selectedModel: AIModel | null | undefined;
  onSelectModel: (model: AIModel) => void;
  disabled?: boolean;
  portalContainer: HTMLElement | null;
}) {
  if (models.length === 0) {
    return null;
  }
  const label = selectedModelLabel(models, selectedModel);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-7 px-2 text-xs text-fg-secondary gap-1"
          aria-label={
            // Not "Model: <label>": with nothing selected the label is itself
            // "Model", and a screen reader would read "Model: Model".
            label === MODEL_UNSET
              ? "Choose a model"
              : `Change model, currently ${label}`
          }
        >
          {label}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        container={portalContainer}
        className="max-h-72 overflow-y-auto"
      >
        {models.map((info) => {
          const isSelected =
            selectedModel?.provider === info.ref.provider &&
            selectedModel?.model === info.ref.model;
          return (
            <DropdownMenuItem
              key={`${info.ref.provider}:${info.ref.model}`}
              onSelect={() => onSelectModel(info.ref)}
              className="text-xs"
            >
              <Check
                className={cn(
                  "h-3 w-3 mr-2",
                  isSelected ? "opacity-100" : "opacity-0",
                )}
              />
              {info.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
