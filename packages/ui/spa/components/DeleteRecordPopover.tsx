import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { Trash2, Workflow } from "lucide-react";
import { Button } from "./designSystem/button";
import { useAddPatch, useShallowSourceAtPath } from "./ValFieldProvider";
import { useValPortal } from "./ValPortalProvider";
import { useNavigation } from "./ValRouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { PopoverClose } from "@radix-ui/react-popover";
import { ReferencesResult } from "./useReferenceScanStatus";

export function DeleteRecordPopover({
  path,
  parentPath,
  variant,
  references,
  children,
  size,
  onComplete,
  confirmationMessage,
  className,
}: {
  path: SourcePath;
  parentPath: SourcePath | ModuleFilePath;
  /**
   * The reference scan this delete is gated on. Deleting is offered only when it
   * reports `success` AND found nothing: while the scan is incomplete "no
   * references" is not an answer, and acting on it is how a dangling ref gets
   * left behind.
   */
  references: ReferencesResult;
  children: React.ReactNode;
  size?: "icon" | "sm" | "lg" | "default";
  variant?: "ghost" | "outline" | "default" | "secondary" | "destructive";
  onComplete?: () => void;
  confirmationMessage: string;
  className?: string;
}) {
  const portalContainer = useValPortal();
  const refs = references.refs;
  const hasReferences = refs.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size={size} variant={variant} className={className}>
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        className="flex flex-col gap-2 p-4"
      >
        {hasReferences ? (
          <>
            <div className="text-lg font-bold">Cannot delete</div>
            <p>
              This record has {refs.length} reference
              {refs.length > 1 ? "s" : ""} that must be updated first.
            </p>
            <p className="text-sm text-muted-foreground">
              Click the <Workflow size={12} className="inline align-middle" />{" "}
              icon to see and update the references.
            </p>
          </>
        ) : references.status === "loading" ? (
          <>
            <div className="text-lg font-bold">Checking references</div>
            <p>
              Loading content that could reference this record
              {references.percentage > 0 ? ` (${references.percentage}%)` : ""}.
            </p>
            <p className="text-sm text-muted-foreground">
              Deleting is disabled until the check completes.
            </p>
          </>
        ) : references.status === "error" ? (
          <>
            <div className="text-lg font-bold">Cannot delete</div>
            <p>References to this record could not be checked.</p>
            <p className="text-sm text-muted-foreground">
              {references.message}
            </p>
            <Button variant="secondary" onClick={references.retry}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <div className="text-lg font-bold">Are you sure?</div>
            <div>{confirmationMessage}</div>
            <PopoverClose asChild>
              <DeleteRecordButton
                path={path}
                parentPath={parentPath}
                variant={"destructive"}
                onComplete={onComplete}
              >
                <div className="flex gap-2 items-center">
                  <Trash2 size={12} />
                  <span>Delete</span>
                </div>
              </DeleteRecordButton>
            </PopoverClose>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DeleteRecordButton({
  path,
  parentPath,
  variant,
  children,
  size,
  onComplete,
}: {
  path: SourcePath;
  parentPath: SourcePath | ModuleFilePath;
  children: React.ReactNode;
  size?: "icon" | "sm" | "lg" | "default";
  variant?: "ghost" | "outline" | "default" | "secondary" | "destructive";
  onComplete?: () => void;
}) {
  const { navigate } = useNavigation();
  const { addPatch, patchPath } = useAddPatch(path);
  const shallowParentSource = useShallowSourceAtPath(parentPath, "record");
  if (
    !("data" in shallowParentSource) ||
    shallowParentSource.data === undefined ||
    shallowParentSource.data === null
  ) {
    // An actual error message should be shown above
    console.error("Parent source not found", shallowParentSource, { path });
    return null;
  }
  return (
    <Button
      size={size}
      variant={variant}
      onClick={() => {
        addPatch(
          [
            {
              op: "remove",
              path: patchPath as array.NonEmptyArray<string>,
            },
          ],
          "record",
        );
        navigate(parentPath);
        if (onComplete) {
          onComplete();
        }
      }}
    >
      {children}
    </Button>
  );
}
