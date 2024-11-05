import { Internal, ModulePath, SourcePath } from "@valbuild/core";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useValPortal,
} from "../ValProvider";
import { FieldSchemaError } from "./FieldSchemaError";
import { FieldLoading } from "./FieldLoading";
import { FieldNotFound } from "./FieldNotFound";
import { AnyField } from "./AnyField";
import { prettifyFilename } from "../../utils/prettifyFilename";
import { Fragment, useEffect, useState } from "react";
import { ChevronRight, Edit, Plus } from "lucide-react";
import { useNavigation } from "../../components/ValRouter";
import { array } from "@valbuild/core/fp";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent } from "../../components/ui/popover";
import { PopoverTrigger } from "@radix-ui/react-popover";
import { emptyOf } from "../../components/fields/emptyOf";
import { JSONValue } from "@valbuild/core/patch";

export function Module({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const maybeParentPath = Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.splitModulePath(modulePath).slice(0, -1).join(".") as ModulePath,
  );
  const parentSchemaAtPath = useSchemaAtPath(maybeParentPath);
  const { navigate } = useNavigation();
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type="module" />;
  }
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type="module" />
    );
  }
  if (schemaAtPath.status === "not-found") {
    return <FieldNotFound path={path} type="module" />;
  }
  if (parentSchemaAtPath.status === "loading") {
    return <FieldLoading path={maybeParentPath} type="module" />;
  }
  if (parentSchemaAtPath.status === "error") {
    return (
      <FieldSchemaError
        path={maybeParentPath}
        error={parentSchemaAtPath.error}
        type="module"
      />
    );
  }
  if (parentSchemaAtPath.status === "not-found") {
    return <FieldNotFound path={maybeParentPath} type="module" />;
  }

  const schema = schemaAtPath.data;
  const isParentRecord =
    maybeParentPath !== path && parentSchemaAtPath.data.type === "record";
  const isRecord = schema.type === "record";

  const parts = splitIntoInitAndLastParts(path);
  const init = parts.slice(0, -1);
  const last = parts[parts.length - 1];
  return (
    <div className="flex flex-col gap-6 py-10">
      <div className="flex flex-col gap-2 text-left">
        {parts.length > 1 && (
          <div className="inline-flex items-center text-sm text-text-quartenary">
            {init.map((part, i) => {
              if (i < init.length - 1) {
                return (
                  <Fragment key={i}>
                    <button
                      onClick={() => {
                        navigate(part.sourcePath);
                      }}
                    >
                      {part.text}
                    </button>
                    <span>
                      <ChevronRight size={16} />
                    </span>
                  </Fragment>
                );
              }
              return (
                <button
                  onClick={() => {
                    navigate(part.sourcePath);
                  }}
                  key={i}
                >
                  {part.text}
                </button>
              );
            })}
          </div>
        )}
        <div>
          <div className="flex items-center justify-between h-12 gap-4 text-xl">
            <span>{last.text}</span>
            <span className="inline-flex items-center gap-2">
              {isParentRecord && (
                <ChangeRecordPopover
                  defaultValue={last.text}
                  path={path}
                  parentPath={maybeParentPath}
                />
              )}
              {isRecord && <AddRecordPopover path={path} />}
            </span>
          </div>
        </div>
      </div>
      <AnyField key={path} path={path} schema={schema} />
    </div>
  );
}

function ChangeRecordPopover({
  defaultValue,
  path,
  parentPath,
}: {
  defaultValue: string;
  path: SourcePath;
  parentPath: SourcePath;
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
      <Button asChild>
        <PopoverTrigger
          onClick={() => {
            setOpen(true);
          }}
        >
          <Edit />
        </PopoverTrigger>
      </Button>
      <PopoverContent container={portalContainer} className="text-text-primary">
        <form
          className="flex flex-col gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            console.log(ev);
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

function AddRecordPopover({ path }: { path: SourcePath }) {
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
      <Button asChild>
        <PopoverTrigger
          onClick={() => {
            setOpen(true);
          }}
        >
          <Plus />
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
              { replace: true },
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

function splitIntoInitAndLastParts(
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
