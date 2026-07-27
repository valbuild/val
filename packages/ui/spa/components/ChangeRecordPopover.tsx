import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "./designSystem/button";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSyncEngine,
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
  keyDescription,
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
  keyDescription?: string;
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
  const syncEngine = useSyncEngine();
  const parentSchema = useSchemaAtPath(parentPath);
  // A `.jsonValues()` entry's content is lazily loaded. If we move an entry that
  // is still an opaque marker, the marker (not the content) lands on the new key
  // and opening it would fetch `/json?key=<newKey>` — which 404s, since the base
  // source still only has the old key. Load it first.
  const isJsonValuesRecord =
    parentSchema.status === "success" &&
    parentSchema.data.type === "record" &&
    parentSchema.data.jsonValues === true;
  const onSubmit = useCallback(
    async (key: string) => {
      if (isJsonValuesRecord) {
        await syncEngine.ensureJsonEntry(moduleFilePath, defaultValue);
      }
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
      syncEngine,
      isJsonValuesRecord,
      defaultValue,
      existingKeys,
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
        <TooltipContent side="top">
          {keyDescription ? `Rename ${keyDescription}` : "Rename record"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent container={portalContainer} className="text-fg-primary">
        {keyDescription && (
          <div className="pb-2 text-sm text-fg-tertiary">{keyDescription}</div>
        )}
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
