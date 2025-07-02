import { SourcePath, Internal, ModuleFilePath } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { useState, useEffect, useCallback } from "react";
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
import { RoutePattern } from "../utils/parseRoutePattern";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import { RouteForm } from "./RouteForm";

export function AddRecordPopover({
  path,
  size,
  variant,
  children,
  open: openProp,
  setOpen: setOpenProp,
  defaultOpen,
  routePattern,
}: {
  path: SourcePath | ModuleFilePath;
  size: "default" | "sm" | "lg" | "icon";
  variant: "default" | "outline" | "secondary" | "ghost" | "link";
  children: React.ReactNode;
  open?: boolean;
  setOpen?: (open: boolean) => void;
  defaultOpen?: boolean;
  routePattern?: RoutePattern[] | null;
}) {
  const shallowSourceAtPath = useShallowSourceAtPath(path, "record");
  const schemaAtPath = useSchemaAtPath(path);
  const portalContainer = useValPortal();
  const { addPatch } = useAddPatch(path);
  const { navigate } = useNavigation();
  const [open, setOpen] = useState(defaultOpen ?? false);
  useEffect(() => {
    if (openProp !== undefined) {
      setOpen(openProp);
    }
  }, [openProp]);
  useEffect(() => {
    if (setOpenProp !== undefined) {
      setOpenProp(open);
    }
  }, [open, setOpenProp]);
  useEffect(() => {
    if (defaultOpen !== undefined) {
      setOpen(defaultOpen);
    }
  }, [defaultOpen]);
  const onSubmit = useCallback(
    (key: string) => {
      const schema = "data" in schemaAtPath ? schemaAtPath.data : null;
      if (schema === null) {
        return;
      }
      if (schema.type !== "record") {
        return;
      }
      const newPatchPath = Internal.createPatchPath(modulePath).concat(key);
      console.log("newPatchPath", newPatchPath);
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
    },
    [addPatch, navigate, schemaAtPath, path],
  );

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
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger
            onClick={() => {
              setOpen(true);
            }}
            asChild
          >
            <Button size={size} variant={variant}>
              {children}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>Add</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent container={portalContainer}>
        {routePattern ? (
          <RouteForm
            routePattern={routePattern}
            existingKeys={Object.keys(shallowSourceAtPath.data)}
            onSubmit={onSubmit}
            onCancel={() => {
              setOpen(false);
            }}
            submitText="Create"
          ></RouteForm>
        ) : (
          <BasicAddForm
            existingKeys={Object.keys(shallowSourceAtPath.data)}
            onSubmit={onSubmit}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function BasicAddForm({
  existingKeys,
  onSubmit,
}: {
  existingKeys: string[];
  onSubmit: (key: string) => void;
}) {
  const [key, setKey] = useState("");
  const disabled = key === "" || key in existingKeys;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit(key);
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
  );
}
