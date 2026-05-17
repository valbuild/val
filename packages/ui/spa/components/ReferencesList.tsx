import { Check } from "lucide-react";
import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./designSystem/command";
import { cn } from "./designSystem/cn";
import { DropdownPreviewRow, DropdownPreviewImage } from "./DropdownPreviewRow";
import { useRefPreview } from "./useRefPreview";
import { prettifyFilename } from "../utils/prettifyFilename";

export type ReferencesListItem = {
  path: SourcePath;
  moduleFilePath: ModuleFilePath;
  /** Module-internal path segments (record key / field path) following the module file path. */
  patchPath: string[];
  /** Render-derived preview for this reference, if available. */
  preview?: {
    title: string;
    subtitle?: string | null;
    image?: DropdownPreviewImage;
  } | null;
  /** Fallback label shown when no `preview` is available. Used as the search/filter value too. */
  fallbackLabel: string;
};

export interface ReferencesListProps {
  items: ReferencesListItem[];
  currentPath?: SourcePath | null;
  onSelect: (item: ReferencesListItem) => void;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
}

export function ReferencesList({
  items,
  currentPath,
  onSelect,
  searchPlaceholder = "Filter",
}: ReferencesListProps) {
  return (
    <Command>
      <CommandInput placeholder={searchPlaceholder} />
      <CommandList>
        {items.length === 0 ? (
          <CommandEmpty>No references found.</CommandEmpty>
        ) : (
          <CommandGroup>
            {items.map((item) => {
              const isCurrent = currentPath === item.path;
              const title = item.preview?.title ?? item.fallbackLabel;
              const subtitle = item.preview
                ? item.preview.subtitle
                : buildSubtitle(item);
              const image = item.preview?.image ?? null;
              const filterValue = `${title} ${item.fallbackLabel}`;
              return (
                <CommandItem
                  key={item.path}
                  value={filterValue}
                  onSelect={() => onSelect(item)}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isCurrent ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <DropdownPreviewRow
                    title={title}
                    subtitle={subtitle}
                    image={image}
                  />
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

function buildSubtitle(item: ReferencesListItem): string | null {
  if (item.patchPath.length === 0) {
    return null;
  }
  return item.patchPath.join(" → ");
}

export interface ConnectedReferencesListProps {
  refs: SourcePath[];
  currentPath?: SourcePath | null;
  onSelect: (path: SourcePath) => void;
  searchPlaceholder?: string;
}

/**
 * Connected variant of {@link ReferencesList} that hydrates each row with
 * render-derived preview data (title/subtitle/image) from {@link useRefPreview}.
 * The pure component is preferred for stories and tests.
 */
export function ConnectedReferencesList({
  refs,
  currentPath,
  onSelect,
  searchPlaceholder = "Filter",
}: ConnectedReferencesListProps) {
  const items = refs.map(buildBaseItem);
  return (
    <Command>
      <CommandInput placeholder={searchPlaceholder} />
      <CommandList>
        {items.length === 0 ? (
          <CommandEmpty>No references found.</CommandEmpty>
        ) : (
          <CommandGroup>
            {items.map((item) => (
              <ConnectedReferenceRow
                key={item.path}
                item={item}
                isCurrent={currentPath === item.path}
                onSelect={onSelect}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

function ConnectedReferenceRow({
  item,
  isCurrent,
  onSelect,
}: {
  item: ReferencesListItem;
  isCurrent: boolean;
  onSelect: (path: SourcePath) => void;
}) {
  const preview = useRefPreview(item.path);
  const title = preview?.title ?? item.fallbackLabel;
  const subtitle = preview ? preview.subtitle : buildSubtitle(item);
  const filterValue = `${title} ${item.fallbackLabel}`;
  return (
    <CommandItem
      value={filterValue}
      onSelect={() => onSelect(item.path)}
      className="flex items-center gap-2"
    >
      <Check
        className={cn(
          "h-4 w-4 shrink-0",
          isCurrent ? "opacity-100" : "opacity-0",
        )}
      />
      <DropdownPreviewRow
        title={title}
        subtitle={subtitle}
        image={preview?.image ?? null}
      />
    </CommandItem>
  );
}

export function buildBaseItem(path: SourcePath): ReferencesListItem {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const patchPath = Internal.createPatchPath(modulePath);
  const moduleLabel = prettifyFilename(
    Internal.splitModuleFilePath(moduleFilePath).pop() || "",
  );
  const fallbackLabel = patchPath.length
    ? `${moduleLabel} → ${patchPath.join(" → ")}`
    : moduleLabel;
  return {
    path,
    moduleFilePath,
    patchPath,
    fallbackLabel,
  };
}
