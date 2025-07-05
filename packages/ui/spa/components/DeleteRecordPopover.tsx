import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { Trash2, Workflow } from "lucide-react";
import { Button } from "./designSystem/button";
import {
  useAddPatch,
  useShallowSourceAtPath,
  useValPortal,
} from "./ValProvider";
import { useNavigation } from "./ValRouter";
import { CompressedPath } from "./CompressedPath";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { PopoverClose } from "@radix-ui/react-popover";

export function DeleteRecordPopover({
  path,
  parentPath,
  variant,
  refs,
  children,
  size,
  onComplete,
  confirmationMessage,
  className,
}: {
  path: SourcePath;
  parentPath: SourcePath | ModuleFilePath;
  refs: SourcePath[];
  children: React.ReactNode;
  size?: "icon" | "sm" | "lg" | "default";
  variant?: "ghost" | "outline" | "default" | "secondary" | "destructive";
  onComplete?: () => void;
  confirmationMessage: string;
  className?: string;
}) {
  const portalContainer = useValPortal();
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
        <div className="text-lg font-bold">Are you sure?</div>
        <div>{confirmationMessage}</div>
        <PopoverClose asChild>
          <DeleteRecordButton
            path={path}
            parentPath={parentPath}
            refs={refs}
            variant={"destructive"}
            onComplete={onComplete}
          >
            <div className="flex gap-2 items-center">
              <Trash2 size={12} />
              <span>Delete</span>
            </div>
          </DeleteRecordButton>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

function DeleteRecordButton({
  path,
  parentPath,
  variant,
  refs,
  children,
  size,
  onComplete,
}: {
  path: SourcePath;
  parentPath: SourcePath | ModuleFilePath;
  refs: SourcePath[];
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size={size}
          variant={variant}
          disabled={refs.length > 0}
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
      </TooltipTrigger>
      <TooltipContent side="top">
        {refs.length > 0 ? (
          <div>
            <p>Cannot delete record.</p>
            <p>
              You must change the following references{" "}
              <Workflow size={10} className="inline" /> to be able to delete:
            </p>
            <ul>
              {refs.map((ref) => (
                <li key={ref}>
                  <CompressedPath path={ref} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p>Delete record</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
