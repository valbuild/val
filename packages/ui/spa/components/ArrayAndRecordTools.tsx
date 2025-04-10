import {
  SourcePath,
  Internal,
  ModulePath,
  ModuleFilePath,
  Json,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { JSONValue, Patch } from "@valbuild/core/patch";
import { Plus, Trash, Edit, Workflow } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { emptyOf } from "./fields/emptyOf";
import { Button } from "./designSystem/button";
import { Input } from "./designSystem/input";
import { prettifyFilename } from "../utils/prettifyFilename";
import {
  useAddPatch,
  useAllSources,
  useLoadingStatus,
  useSchemaAtPath,
  useSchemas,
  useShallowSourceAtPath,
  useSourceAtPath,
  useValPortal,
} from "./ValProvider";
import { useNavigation } from "./ValRouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import {
  isArray,
  isParentRecord,
  isRecord,
  useParent,
} from "../hooks/useParent";
import { getKeysOf } from "./getKeysOf";
import { CompressedPath } from "./CompressedPath";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "./designSystem/hover-card";

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
  const refs = useKeysOf(
    maybeParentPath as unknown as ModuleFilePath,
    isParentRecord(path, maybeParentPath, parentSchemaAtPath)
      ? last?.part
      : undefined,
  );
  return (
    <span className="inline-flex items-center gap-2">
      {isParentRecord(path, maybeParentPath, parentSchemaAtPath) && (
        <>
          <ReferencesPopover refs={refs} variant={variant} />
          <ChangeRecordPopover
            defaultValue={last.text}
            path={path}
            parentPath={maybeParentPath}
            variant={variant}
            refs={refs}
          />
          <DeleteRecordButton
            path={path}
            parentPath={maybeParentPath}
            variant={variant}
            refs={refs}
          />
        </>
      )}
      {isArray("data" in schemaAtPath ? schemaAtPath.data : undefined) && (
        <AddArrayButton path={path} variant={variant} />
      )}
      {isRecord("data" in schemaAtPath ? schemaAtPath.data : undefined) && (
        <>
          <ReferencesPopover refs={refs} variant={variant} />
          <AddRecordPopover path={path} variant={variant} />
        </>
      )}
    </span>
  );
}

function ReferencesPopover({
  refs,
  variant,
}: {
  refs: SourcePath[];
  variant: Variant;
}) {
  const portalContainer = useValPortal();
  if (refs.length === 0) {
    return null;
  }
  return (
    <Popover>
      <HoverCard>
        <HoverCardTrigger>
          <Button
            asChild
            size={getButtonSize(variant)}
            variant={getButtonVariant(variant)}
          >
            <PopoverTrigger>
              <Workflow size={getIconSize(variant)} />
            </PopoverTrigger>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent side="top">
          References to this record
        </HoverCardContent>
      </HoverCard>
      <PopoverContent container={portalContainer}>
        <div className="text-sm">
          <ul>
            {refs.map((ref) => (
              <li key={ref}>
                <CompressedPath path={ref} />
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
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
  const schemaAtPath = useSchemaAtPath(path);
  const shallowSourceAtPath = useShallowSourceAtPath(path, "array");
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (!("data" in shallowSourceAtPath) || !shallowSourceAtPath.data) {
    return null;
  }
  if (!("data" in schemaAtPath)) {
    return null;
  }
  const schema = schemaAtPath.data;
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
        addPatch(
          [
            {
              op: "add",
              path: newPatchPath,
              value: emptyOf(schema.item) as JSONValue,
            },
          ],
          schema.type,
        );
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
  refs,
}: {
  path: SourcePath;
  parentPath: SourcePath;
  variant: Variant;
  refs: SourcePath[];
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
          size={getButtonSize(variant)}
          variant={getButtonVariant(variant)}
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
          <Trash size={getIconSize(variant)} />
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

function ChangeRecordPopover({
  defaultValue,
  path,
  parentPath,
  variant,
  refs,
}: {
  defaultValue: string;
  path: SourcePath;
  parentPath: SourcePath;
  variant: Variant;
  refs: SourcePath[];
}) {
  const [moduleFilePath, parentModulePath] =
    Internal.splitModuleFilePathAndModulePath(parentPath);
  const { navigate } = useNavigation();
  const { addPatch, addModuleFilePatch } = useAddPatch(path);
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
      <HoverCard>
        <HoverCardTrigger>
          <Button
            asChild
            size={getButtonSize(variant)}
            variant={getButtonVariant(variant)}
          >
            <PopoverTrigger
              onClick={() => {
                setOpen(true);
              }}
            >
              <Edit size={16} />
            </PopoverTrigger>
          </Button>
        </HoverCardTrigger>
        <HoverCardContent side="top">Change name</HoverCardContent>
      </HoverCard>
      <PopoverContent container={portalContainer} className="text-text-primary">
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            const patchOps: Patch = [
              {
                op: "move",
                from: parentPatchPath.concat(
                  defaultValue,
                ) as array.NonEmptyArray<string>,
                path: parentPatchPath.concat(
                  key,
                ) as array.NonEmptyArray<string>,
              },
            ];
            addPatch(patchOps, "record");
            for (const ref of refs) {
              const [refModuleFilePath, refModulePath] =
                Internal.splitModuleFilePathAndModulePath(ref);
              const refPatchPath = Internal.createPatchPath(refModulePath);
              addModuleFilePatch(
                refModuleFilePath,
                [
                  {
                    op: "replace",
                    path: refPatchPath,
                    value: key,
                  },
                ],
                "record",
              );
            }
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

function useKeysOf(parentPath: ModuleFilePath, keyValue?: string) {
  const schemas = useSchemas();
  const loadingStatus = useLoadingStatus();
  const allSources = useAllSources();
  const referencingModuleFilePaths = useMemo(() => {
    if (
      "data" in schemas &&
      schemas.data !== undefined &&
      schemas.data[parentPath] !== undefined
    ) {
      return getKeysOf(schemas.data, allSources, parentPath, keyValue);
    }
    return [];
  }, [
    loadingStatus,
    allSources,
    "data" in schemas && schemas.data,
    parentPath,
    keyValue,
  ]);
  return referencingModuleFilePaths;
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
          title="Add"
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

export function splitIntoInitAndLastParts(path: SourcePath) {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const moduleFilePathParts = Internal.splitModuleFilePath(moduleFilePath).map(
    (part) => {
      return {
        text: prettifyFilename(part),
        part,
        sourcePath: moduleFilePath as unknown as SourcePath,
      };
    },
  );
  if (!modulePath) {
    return moduleFilePathParts;
  }
  const splittedModulePath = Internal.splitModulePath(modulePath);
  const modulePathParts: {
    text: string;
    part: string;
    sourcePath: SourcePath;
  }[] = [];
  let lastPart = "";
  for (let i = 0; i < splittedModulePath.length; i++) {
    let modulePathPart =
      (lastPart ? lastPart + "." : "") + JSON.stringify(splittedModulePath[i]);
    if (!modulePath.startsWith(modulePathPart)) {
      // This happens if the current element is a number
      // It is a sneaky / clever (but not smart?) way to build the sourcePath without actually figuring out the schema types
      modulePathPart = (lastPart ? lastPart + "." : "") + splittedModulePath[i];
    }
    lastPart = modulePathPart;
    modulePathParts.push({
      text: splittedModulePath[i],
      part: splittedModulePath[i],
      sourcePath: Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        modulePathPart as ModulePath,
      ),
    });
  }
  return moduleFilePathParts.concat(modulePathParts);
}
