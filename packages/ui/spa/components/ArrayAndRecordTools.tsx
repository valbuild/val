import { SourcePath, Internal, ModulePath } from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { JSONValue } from "@valbuild/core/patch";
import { Plus, Trash, Edit } from "lucide-react";
import { useState, useEffect } from "react";
import { emptyOf } from "./fields/emptyOf";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { prettifyFilename } from "../utils/prettifyFilename";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useValPortal,
} from "./ValProvider";
import { useNavigation } from "./ValRouter";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  isArray,
  isParentRecord,
  isRecord,
  useParent,
} from "./hooks/useParent";

type Variant = "module" | "field";
export function ArrayAndRecordTools({
  path,
  variant,
}: {
  path: SourcePath;
  variant: Variant;
}) {
  const schemaAtPath = useSchemaAtPath(path);
  const { path: maybeParentPath, schema: parentSchemaAtPath } = useParent(path);
  const parts = splitIntoInitAndLastParts(path);
  const last = parts[parts.length - 1];
  return (
    <span className="inline-flex items-center gap-2">
      {isParentRecord(path, maybeParentPath, parentSchemaAtPath) && (
        <>
          <ChangeRecordPopover
            defaultValue={last.text}
            path={path}
            parentPath={maybeParentPath}
            variant={variant}
          />
          <DeleteRecordButton
            path={path}
            parentPath={maybeParentPath}
            variant={variant}
          />
        </>
      )}
      {isArray("data" in schemaAtPath ? schemaAtPath.data : undefined) && (
        <AddArrayButton path={path} variant={variant} />
      )}
      {isRecord("data" in schemaAtPath ? schemaAtPath.data : undefined) && (
        <AddRecordPopover path={path} variant={variant} />
      )}
    </span>
  );
}

function getIconSize(variant: Variant) {
  return variant === "module" ? 16 : 12;
}

function getButtonSize(variant: Variant): "icon" | "sm" | "lg" | "default" {
  return variant === "module" ? "icon" : "icon";
}

function getButtonVariant(
  variant: Variant,
): "ghost" | "outline" | "default" | "secondary" {
  return variant === "module" ? "outline" : "ghost";
}

function AddArrayButton({
  path,
  variant,
}: {
  path: SourcePath;
  variant: Variant;
}) {
  const { navigate } = useNavigation();
  const { addPatch, patchPath } = useAddPatch(path);
  const schmeaAtPath = useSchemaAtPath(path);
  const shallowSourceAtPath = useShallowSourceAtPath(path, "array");
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (!("data" in shallowSourceAtPath) || !shallowSourceAtPath.data) {
    return null;
  }
  if (!("data" in schmeaAtPath)) {
    return null;
  }
  const schema = schmeaAtPath.data;
  if (schema.type !== "array") {
    console.error("Cannot add to non-array", shallowSourceAtPath, {
      parentPath: path,
    });
    return null;
  }
  const highestIndex = shallowSourceAtPath.data.length;
  return (
    <Button
      title="Add"
      size={getButtonSize(variant)}
      variant={getButtonVariant(variant)}
      onClick={() => {
        const newPatchPath = patchPath.concat(highestIndex.toString());
        addPatch([
          {
            op: "add",
            path: newPatchPath,
            value: emptyOf(schema.item) as JSONValue,
          },
        ]);
        if (schema.item.type !== "string") {
          navigate(
            Internal.joinModuleFilePathAndModulePath(
              moduleFilePath,
              Internal.patchPathToModulePath(newPatchPath),
            ),
          );
        }
      }}
    >
      <Plus size={getIconSize(variant)} />
    </Button>
  );
}

function DeleteRecordButton({
  path,
  parentPath,
  variant,
}: {
  path: SourcePath;
  parentPath: SourcePath;
  variant: Variant;
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
      size={getButtonSize(variant)}
      variant={getButtonVariant(variant)}
      title="Delete"
      onClick={() => {
        addPatch([
          {
            op: "remove",
            path: patchPath as array.NonEmptyArray<string>,
          },
        ]);
        navigate(parentPath);
      }}
    >
      <Trash size={getIconSize(variant)} />
    </Button>
  );
}

function ChangeRecordPopover({
  defaultValue,
  path,
  parentPath,
  variant,
}: {
  defaultValue: string;
  path: SourcePath;
  parentPath: SourcePath;
  variant: Variant;
}) {
  const [moduleFilePath, parentModulePath] =
    Internal.splitModuleFilePathAndModulePath(parentPath);
  const { navigate } = useNavigation();
  const { addPatch } = useAddPatch(path);
  const shallowParentSource = useShallowSourceAtPath(parentPath, "record");
  const [key, setKey] = useState(defaultValue); // cannot change - right?
  const [open, setOpen] = useState(false);
  const portalContainer = useValPortal();
  useEffect(() => {
    const keyDownListener = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", keyDownListener);
    return () => {
      window.removeEventListener("keydown", keyDownListener);
    };
  }, []);

  const parentPatchPath = Internal.createPatchPath(parentModulePath);
  if (
    !("data" in shallowParentSource) ||
    shallowParentSource.data === undefined ||
    shallowParentSource.data === null
  ) {
    // An actual error message should be shown above
    console.error("Parent source not found", shallowParentSource, { path });
    return null;
  }
  const disabled =
    key === defaultValue || key === "" || key in shallowParentSource.data;
  return (
    <Popover open={open}>
      <Button
        asChild
        size={getButtonSize(variant)}
        variant={getButtonVariant(variant)}
      >
        <PopoverTrigger
          onClick={() => {
            setOpen(true);
          }}
          title="Change name"
        >
          <Edit size={16} />
        </PopoverTrigger>
      </Button>
      <PopoverContent container={portalContainer} className="text-text-primary">
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            addPatch([
              {
                op: "move",
                from: parentPatchPath.concat(
                  defaultValue,
                ) as array.NonEmptyArray<string>,
                path: parentPatchPath.concat(
                  key,
                ) as array.NonEmptyArray<string>,
              },
            ]);
            navigate(
              Internal.joinModuleFilePathAndModulePath(
                moduleFilePath,
                Internal.patchPathToModulePath(parentPatchPath.concat(key)),
              ),
              {
                replace: true,
              },
            );
            setOpen(false);
          }}
        >
          <Input
            type="text"
            value={key}
            onChange={(ev) => {
              setKey(ev.target.value);
            }}
          />
          <div className="flex items-center gap-2">
            <Button disabled={disabled} variant="outline" type="submit">
              Update
            </Button>
            <Button
              variant={"ghost"}
              type="reset"
              onClick={() => {
                setOpen(false);
                setKey(defaultValue);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function AddRecordPopover({
  path,
  variant,
}: {
  path: SourcePath;
  variant: Variant;
}) {
  const shallowSourceAtPath = useShallowSourceAtPath(path, "record");
  const schemaAtPath = useSchemaAtPath(path);
  const portalContainer = useValPortal();
  const { addPatch } = useAddPatch(path);
  const [key, setKey] = useState("");
  const { navigate } = useNavigation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const keyDownListener = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", keyDownListener);
    return () => {
      window.removeEventListener("keydown", keyDownListener);
    };
  }, []);
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
    <Popover open={open}>
      <Button
        asChild
        size={getButtonSize(variant)}
        variant={getButtonVariant(variant)}
      >
        <PopoverTrigger
          onClick={() => {
            setOpen(true);
          }}
          title={"Add"}
        >
          <Plus size={getIconSize(variant)} />
        </PopoverTrigger>
      </Button>
      <PopoverContent container={portalContainer}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            const newPatchPath =
              Internal.createPatchPath(modulePath).concat(key);
            addPatch([
              {
                op: "add",
                path: newPatchPath,
                value: emptyOf(schema.item) as JSONValue,
              },
            ]);
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

export function splitIntoInitAndLastParts(
  path: SourcePath,
): { text: string; sourcePath: SourcePath }[] {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const moduleFilePathParts = Internal.splitModuleFilePath(moduleFilePath).map(
    (part) => {
      return {
        text: prettifyFilename(part),
        sourcePath: moduleFilePath as unknown as SourcePath,
      };
    },
  );
  if (!modulePath) {
    return moduleFilePathParts;
  }
  const splittedModulePath = Internal.splitModulePath(modulePath);
  const modulePathParts = splittedModulePath.map((part, i) => {
    return {
      text: part,
      sourcePath: Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        splittedModulePath.slice(0, i + 1).join(".") as ModulePath,
      ),
    };
  });
  return moduleFilePathParts.concat(modulePathParts);
}
