import * as React from "react";
import { Check, ExternalLink, Link, Trash2 } from "lucide-react";
import { Internal, ModuleFilePath } from "@valbuild/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../designSystem/dialog";
import { cn } from "../designSystem/cn";
import { Input } from "../designSystem/input";
import { FilePreview } from "./FilePreview";
import { FilenameInput } from "./FilenameInput";
import type { GalleryFile } from "./types";
import { FieldValidationError } from "../FieldValidationError";
import { useReferencedFiles } from "../useReferencedFiles";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../designSystem/tooltip";
import { useNavigation } from "../ValRouter";
import { ValPath } from "../ValPath";
import { prettifyFilename } from "../../utils/prettifyFilename";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../designSystem/command";

interface FilePropertiesModalProps {
  file: GalleryFile | null;
  fileIndex: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileRename?: (index: number, newFilename: string) => void;
  onAltTextChange?: (index: number, newAltText: string) => void;
  onFileDelete?: (index: number) => void;
  parentPath?: string;
  imageMode?: boolean;
  loading?: boolean;
  disabled?: boolean;
  container?: HTMLElement | null;
  onClose?: () => void;
}

export function FilePropertiesModal({
  file,
  fileIndex,
  open,
  onOpenChange,
  onFileRename,
  onAltTextChange,
  onFileDelete,
  parentPath,
  imageMode,
  loading,
  disabled,
  container,
}: FilePropertiesModalProps) {
  const refs = useReferencedFiles(
    parentPath as ModuleFilePath | undefined,
    file?.ref,
  );
  const { navigate, currentSourcePath } = useNavigation();
  const [refsOpen, setRefsOpen] = React.useState(false);

  if (!file || fileIndex === null) return null;

  const handleFilenameChange = (newFilename: string) => {
    onFileRename?.(fileIndex, newFilename);
  };

  const handleOpenInNewTab = () => {
    window.open(file.url, "_blank", "noopener,noreferrer");
  };

  const isImage = file.metadata.mimeType.startsWith("image/");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" container={container}>
        <DialogHeader>
          <DialogTitle>File Properties</DialogTitle>
        </DialogHeader>

        <div className="flex gap-6">
          {/* Preview */}
          <div className="shrink-0">
            <div className="h-32 w-32 overflow-hidden rounded-lg border border-border-secondary bg-bg-secondary">
              <FilePreview file={file} />
            </div>
          </div>

          {/* Properties */}
          <div className="flex-1 space-y-4">
            {/* Filename */}
            {onFileRename && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-secondary">
                  Filename
                </label>
                <FilenameInput
                  filename={file.filename}
                  onSave={handleFilenameChange}
                  disabled={disabled || loading}
                />
              </div>
            )}

            {/* Alt Text (only for images in imageMode) */}
            {imageMode && isImage && onAltTextChange && (
              <div
                className={cn("flex flex-col gap-1", {
                  "border-[red] border p-2 rounded":
                    file.fieldSpecificErrors?.alt &&
                    file.fieldSpecificErrors.alt.length > 0,
                })}
              >
                <label className="text-xs font-medium text-fg-secondary">
                  Description
                </label>

                <div>
                  <Input
                    value={file.metadata.alt ?? ""}
                    onChange={(e) => {
                      onAltTextChange?.(fileIndex, e.target.value);
                    }}
                    autoFocus
                    placeholder="Describe this image..."
                  />
                  {file.fieldSpecificErrors?.alt &&
                    file.fieldSpecificErrors.alt.length > 0 && (
                      <ul className="list-none p-0 text-sm">
                        {file.fieldSpecificErrors.alt.map((error, i) => (
                          <li key={i}>
                            <FieldValidationError
                              validationErrors={[{ message: error }]}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              </div>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-fg-secondary">
                  Folder
                </span>
                <span
                  className="truncate text-sm text-fg-primary"
                  title={file.folder}
                >
                  {file.folder}
                </span>
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-fg-secondary">
                  Type
                </span>
                <span className="text-sm text-fg-primary">
                  {file.metadata.mimeType}
                </span>
              </div>

              {(file.metadata.width > 0 || file.metadata.height > 0) && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-fg-secondary">
                    Dimensions
                  </span>
                  <span className="text-sm text-fg-primary">
                    {file.metadata.width} × {file.metadata.height} px
                  </span>
                </div>
              )}
            </div>

            {/* Validation errors */}
            {file.validationErrors && file.validationErrors.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-destructive">
                  Validation Errors
                </span>
                <ul className="list-inside list-disc text-sm text-destructive">
                  {file.validationErrors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-2 border-t border-border-secondary pt-4">
          <button
            type="button"
            onClick={handleOpenInNewTab}
            className="inline-flex items-center gap-2 rounded-md bg-bg-secondary px-3 py-2 text-sm font-medium text-fg-primary transition-colors hover:bg-bg-tertiary"
          >
            <ExternalLink className="h-4 w-4" />
            Open in New Tab
          </button>
          {onFileDelete && fileIndex !== null && (
            <div className="ml-auto flex items-center gap-2">
              {refs.length > 0 && (
                <Popover open={refsOpen} onOpenChange={setRefsOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-md bg-bg-secondary px-3 py-2 text-sm font-medium text-fg-primary transition-colors hover:bg-bg-tertiary"
                    >
                      <Link className="h-4 w-4" />
                      {refs.length} reference{refs.length !== 1 ? "s" : ""}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[clamp(300px,40vw,400px)] p-0 z-[8999]"
                    container={container}
                  >
                    <Command>
                      <CommandInput placeholder="Filter" />
                      <CommandList>
                        <CommandEmpty>No references found.</CommandEmpty>
                        <CommandGroup>
                          {refs.map((ref) => {
                            const [refModuleFilePath, modulePath] =
                              Internal.splitModuleFilePathAndModulePath(ref);
                            const patchPath =
                              Internal.createPatchPath(modulePath);
                            const label = `${prettifyFilename(Internal.splitModuleFilePath(refModuleFilePath).pop() || "")}${modulePath ? ` → ${Internal.splitModulePath(modulePath).join(" → ")}` : ""}`;
                            const isCurrent = currentSourcePath === ref;
                            return (
                              <CommandItem
                                key={ref}
                                value={label}
                                onSelect={() => {
                                  navigate(ref);
                                  setRefsOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    isCurrent ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                <ValPath
                                  moduleFilePath={refModuleFilePath}
                                  patchPath={patchPath}
                                />
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <button
                        type="button"
                        onClick={() => {
                          onFileDelete(fileIndex);
                          onOpenChange(false);
                        }}
                        disabled={disabled || loading || refs.length > 0}
                        className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-bg-error-primary disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </span>
                  </TooltipTrigger>
                  {refs.length > 0 && (
                    <TooltipContent>
                      Cannot delete: referenced in {refs.length}{" "}
                      {refs.length === 1 ? "place" : "places"}
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
