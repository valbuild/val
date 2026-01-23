import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "./designSystem/button";
import {
  useAddPatch,
  useShallowSourceAtPath,
} from "./ValFieldProvider";
import { useValPortal } from "./ValPortalProvider";
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
import { RoutePattern } from "@valbuild/shared/internal";
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

  // Get actual record keys from parent source for duplicate validation
  const parentSource = useShallowSourceAtPath(parentPath, "record");
  const recordKeys = useMemo(() => {
    if ("data" in parentSource && parentSource.data) {
      return Object.keys(parentSource.data);
    }
    return [];
  }, [parentSource]);
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
            existingKeys={recordKeys}
            defaultValue={defaultValue}
            onSubmit={(key) => {
              onSubmit(key);
              setOpen(false);
            }}
            onCancel={() => {
              setOpen(false);
            }}
            submitText="Update"
          ></RouteForm>
        ) : (
          <RenameRecordKeyForm
            parentPath={parentPath}
            defaultValue={defaultValue}
            existingKeys={recordKeys}
            onSubmit={(key) => {
              onSubmit(key);
              setOpen(false);
            }}
            onCancel={() => {
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
