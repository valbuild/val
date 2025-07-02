import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { useState, useEffect, useCallback } from "react";
import { Button } from "./designSystem/button";
import { useAddPatch, useValPortal } from "./ValProvider";
import { useNavigation } from "./ValRouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { RenameRecordKeyForm } from "./RenameRecordKeyForm";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import { RoutePattern } from "../utils/parseRoutePattern";
import { RouteForm } from "./RouteForm";
import { Patch } from "@valbuild/core/patch";
import { array } from "@valbuild/core/fp";

export function ChangeRecordPopover({
  defaultValue,
  path,
  parentPath,
  variant,
  existingKeys,
  routePattern,
  size,
  children,
  onComplete,
}: {
  defaultValue: string;
  path: SourcePath;
  parentPath: SourcePath | ModuleFilePath;
  variant: "ghost" | "outline" | "default" | "secondary";
  size: "icon" | "sm" | "lg" | "default";
  existingKeys: SourcePath[];
  children: React.ReactNode;
  routePattern?: RoutePattern[] | null;
  onComplete?: () => void;
}) {
  const { navigate } = useNavigation();
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
  const { addPatch, addModuleFilePatch } = useAddPatch(path);
  const [moduleFilePath, parentModulePath] =
    Internal.splitModuleFilePathAndModulePath(parentPath);
  const parentPatchPath = Internal.createPatchPath(parentModulePath);
  const onSubmit = useCallback(
    (key: string) => {
      const patchOps: Patch = [
        {
          op: "move",
          from: parentPatchPath.concat(
            defaultValue,
          ) as array.NonEmptyArray<string>,
          path: parentPatchPath.concat(key) as array.NonEmptyArray<string>,
        },
      ];
      addPatch(patchOps, "record");
      for (const ref of existingKeys) {
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
      const newSourcePath = Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        Internal.patchPathToModulePath(parentPatchPath.concat(key)),
      );
      navigate(newSourcePath, {
        replace: true,
      });
      if (onComplete) {
        onComplete();
      }
    },
    [
      addPatch,
      addModuleFilePatch,
      moduleFilePath,
      parentPatchPath,
      navigate,
      onComplete,
    ],
  );

  return (
    <Popover open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild size={size} variant={variant}>
            <PopoverTrigger
              onClick={() => {
                setOpen(true);
              }}
            >
              {children}
            </PopoverTrigger>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Rename record</TooltipContent>
      </Tooltip>
      <PopoverContent container={portalContainer} className="text-fg-primary">
        {routePattern ? (
          <RouteForm
            routePattern={routePattern}
            existingKeys={existingKeys}
            defaultValue={defaultValue}
            onSubmit={onSubmit}
            onCancel={() => {
              setOpen(false);
            }}
            submitText="Update"
          ></RouteForm>
        ) : (
          <RenameRecordKeyForm
            parentPath={parentPath}
            defaultValue={defaultValue}
            existingKeys={existingKeys}
            onSubmit={onSubmit}
            onCancel={() => {
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
