import { SourcePath, Internal, ModuleFilePath } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { useState, useEffect } from "react";
import { emptyOf } from "./fields/emptyOf";
import { Button } from "./designSystem/button";
import { Input } from "./designSystem/input";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useValPortal,
} from "./ValProvider";
import { useNavigation } from "./ValRouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";

export function AddRecordPopover({
  path,
  size,
  variant,
  children,
}: {
  path: SourcePath | ModuleFilePath;
  size: "default" | "sm" | "lg" | "icon";
  variant: "default" | "outline" | "secondary" | "ghost" | "link";
  children: React.ReactNode;
}) {
  const shallowSourceAtPath = useShallowSourceAtPath(path, "record");
  const schemaAtPath = useSchemaAtPath(path);
  const portalContainer = useValPortal();
  const { addPatch } = useAddPatch(path);
  const [key, setKey] = useState("");
  const { navigate } = useNavigation();
  const [open, setOpen] = useState(false);
  if (
    !("data" in shallowSourceAtPath) ||
    shallowSourceAtPath.data === undefined ||
    shallowSourceAtPath.data === null
  ) {
    // An actual error message should be shown above
    console.error("Source not found", shallowSourceAtPath, { path });
    return null;
  }
  if (!("data" in schemaAtPath) || schemaAtPath.data === undefined) {
    // An actual error message should be shown above
    console.error("Schema not found", shallowSourceAtPath, { path });
    return null;
  }
  const schema = schemaAtPath.data;
  if (schema.type !== "record") {
    // An actual error message should be shown above
    console.error("Schema is not a record", schemaAtPath, { path });
    return null;
  }
  const disabled = key === "" || key in shallowSourceAtPath.data;
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Button asChild size={size} variant={variant}>
        <PopoverTrigger
          onClick={() => {
            setOpen(true);
          }}
          title="Add"
        >
          {children}
        </PopoverTrigger>
      </Button>
      <PopoverContent container={portalContainer}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            const newPatchPath =
              Internal.createPatchPath(modulePath).concat(key);
            addPatch(
              [
                {
                  op: "add",
                  path: newPatchPath,
                  value: emptyOf(schema.item) as JSONValue,
                },
              ],
              "record",
            );
            navigate(
              Internal.joinModuleFilePathAndModulePath(
                moduleFilePath,
                Internal.patchPathToModulePath(newPatchPath),
              ) as SourcePath,
            );
            setOpen(false);
          }}
        >
          <Input
            autoFocus
            value={key}
            onChange={(ev) => {
              setKey(ev.target.value);
            }}
          />
          <div>
            <Button type="submit" disabled={disabled} variant={"outline"}>
              Add
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
