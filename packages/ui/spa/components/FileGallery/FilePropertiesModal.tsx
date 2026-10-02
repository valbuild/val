import * as React from "react";
import { ExternalLink, GitCompare, Link, Trash2 } from "lucide-react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
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
import type { FileGalleryProps, GalleryFile } from "./types";
import { FieldValidationError } from "../FieldValidationError";
import { FieldPatchAuthors } from "../FieldPatchAuthors";
import { useReferencedFiles } from "../useReferencedFiles";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../designSystem/tooltip";
import { useNavigation, VAL_REVIEW_ROUTE } from "../ValRouter";
import { useNavLink } from "../navLink";
import { useCommittedPatches, usePatchSets } from "../ValProvider";
import { pendingPatchSets } from "../../utils/computeChangedSourcePaths";
import { hasChangeAt } from "../../review/reviewCompareParam";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { ConnectedReferencesList } from "../ReferencesList";

interface FilePropertiesModalProps {
  file: GalleryFile | null;
  fileIndex: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileRename?: FileGalleryProps["onFileRename"];
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
  const references = useReferencedFiles(
    parentPath as ModuleFilePath | undefined,
    file?.ref,
  );
  const refs = references.refs;
  // Deleting a file whose references have not all been found leaves a dangling
  // ref behind, so the button waits for a COMPLETE scan — not just an empty one.
  const referencesChecked = references.status === "success";
  const { navigate, currentSourcePath } = useNavigation();
  const [refsOpen, setRefsOpen] = React.useState(false);

  if (!file || fileIndex === null) return null;

  const handleFilenameChange = (newFilename: string, newBase: string) => {
    const result = onFileRename?.(fileIndex, newFilename, newBase);
    if (result === undefined) {
      return;
    }
    return result.then((res) =>
      res.status === "error" || res.status === "partial" ? res.message : null,
    );
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
                  // A rename rewrites every field naming the file, so it waits
                  // for the same complete scan a delete does.
                  disabled={disabled || loading || !referencesChecked}
                />
                {refs.length > 0 && (
                  <p className="px-2 text-[0.6875rem] text-fg-secondary-alt">
                    Renaming updates the {refs.length}{" "}
                    {refs.length === 1 ? "place" : "places"} using it.
                  </p>
                )}
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
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-fg-secondary">
                    Description
                  </label>
                  {file.patchesByAuthorIds &&
                    file.profilesByAuthorIds &&
                    Object.keys(file.patchesByAuthorIds).length > 0 && (
                      <FieldPatchAuthors
                        patchesByAuthorIds={file.patchesByAuthorIds}
                        profilesByAuthorIds={file.profilesByAuthorIds}
                        sourcePath={file.sourcePath}
                      />
                    )}
                </div>

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
          {/*
           * An anchor, not a button calling `window.open`.
           *
           * Same behaviour on a click, and it also does what a link does: a
           * middle click, a modifier click, and — the reason this changed —
           * "Copy link address", so the file's URL can be pasted somewhere.
           * `window.open` gives none of that away.
           */}
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-bg-secondary px-3 py-2 text-sm font-medium text-fg-primary transition-colors hover:bg-bg-tertiary"
          >
            <ExternalLink className="h-4 w-4" />
            Open in New Tab
          </a>
          {file.sourcePath &&
            file.patchesByAuthorIds &&
            Object.keys(file.patchesByAuthorIds).length > 0 && (
              <CompareLink sourcePath={file.sourcePath} />
            )}
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
                    // Narrower than it was: the rows no longer repeat the
                    // module path, so there is less to fit and less reason to
                    // take 40% of the window for a menu.
                    className="w-[clamp(260px,32vw,360px)] p-0 z-[8999]"
                    container={container}
                  >
                    <ConnectedReferencesList
                      refs={refs}
                      currentPath={currentSourcePath}
                      onSelect={(navPath, { scrollToPath }) => {
                        navigate(navPath, { scrollToPath });
                        setRefsOpen(false);
                      }}
                    />
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
                        disabled={
                          disabled ||
                          loading ||
                          refs.length > 0 ||
                          !referencesChecked
                        }
                        className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-bg-error-primary disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </span>
                  </TooltipTrigger>
                  {refs.length > 0 ? (
                    <TooltipContent>
                      Cannot delete: referenced in {refs.length}{" "}
                      {refs.length === 1 ? "place" : "places"}
                    </TooltipContent>
                  ) : references.status === "loading" ? (
                    <TooltipContent>
                      Checking references
                      {references.percentage > 0
                        ? ` (${references.percentage}%)`
                        : ""}
                      …
                    </TooltipContent>
                  ) : references.status === "error" ? (
                    <TooltipContent>
                      Cannot delete: references could not be checked
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The review page's compare dialog, open on this file's change.
 *
 * Not the old `/val/compare` view: the dialog is the one that answers "what is
 * about to go out", and a link into it lands on the entry rather than on a
 * page you then have to scroll.
 *
 * Drawn only while the review page has the change to show, which is not the
 * same as the file having patches: in http mode a shipped patch stays in the
 * chain until the deploy moves the base, and the review page leaves those out
 * (`pendingPatchSets`). Tested with the review page's own predicate, so the
 * link and the page it opens cannot disagree. A component of its own so that
 * the patch sets are read only while a file with changes is open.
 */
function CompareLink({ sourcePath }: { sourcePath: SourcePath }) {
  const patchSets = usePatchSets();
  const committedPatchIds = useCommittedPatches();
  const link = useNavLink(VAL_REVIEW_ROUTE, { compare: sourcePath });
  const pending = React.useMemo(
    () =>
      patchSets.status === "success"
        ? pendingPatchSets(patchSets.data, committedPatchIds)
        : null,
    [patchSets, committedPatchIds],
  );
  if (pending === null || !hasChangeAt(pending, sourcePath)) return null;
  return (
    <a
      {...link}
      className="inline-flex items-center gap-2 rounded-md bg-bg-secondary px-3 py-2 text-sm font-medium text-fg-primary transition-colors hover:bg-bg-tertiary"
    >
      <GitCompare className="h-4 w-4" />
      View in Compare
    </a>
  );
}
