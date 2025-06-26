import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { Workflow } from "lucide-react";
import { Button } from "./designSystem/button";
import { useAddPatch, useShallowSourceAtPath } from "./ValProvider";
import { useNavigation } from "./ValRouter";
import { CompressedPath } from "./CompressedPath";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "./designSystem/hover-card";

export function DeleteRecordButton({
  path,
  parentPath,
  variant,
  refs,
  children,
  size,
}: {
  path: SourcePath;
  parentPath: SourcePath | ModuleFilePath;
  refs: SourcePath[];
  children: React.ReactNode;
  size?: "icon" | "sm" | "lg" | "default";
  variant?: "ghost" | "outline" | "default" | "secondary";
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
    <HoverCard>
      <HoverCardTrigger>
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
          }}
        >
          {children}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent side="top">
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
      </HoverCardContent>
    </HoverCard>
  );
}
