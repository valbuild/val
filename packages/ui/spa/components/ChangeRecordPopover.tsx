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
import { ReferencesResult } from "./useJsonValuesLoad";

export function ChangeRecordPopover({
  defaultValue,
  path,
  parentPath,
  variant,
  references,
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
  /**
   * The reference scan whose refs this rename rewrites. Renaming is offered only
   * when it reports `success`: an incomplete scan means some referrer was not
   * seen, and renaming anyway leaves it pointing at a key that no longer exists.
   */
  references: ReferencesResult;
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
  const parentSchema = useSchemaAtPath(parentPath);
  // Callers may pass the description explicitly, but fall back to the key schema
  // so that call sites which only know the path show it too
  const description =
    keyDescription ??
    ("data" in parentSchema && parentSchema.data.type === "record"
      ? parentSchema.data.key?.description
      : undefined);
  const recordKeys = useMemo(() => {
    if ("data" in parentSource && parentSource.data) {
      return Object.keys(parentSource.data);
    }
    return [];
  }, [parentSource]);
  const syncEngine = useSyncEngine();
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
      if (references.status !== "success") {
        // The form is not rendered in this state; belt and braces, because
        // renaming on an incomplete ref scan silently breaks the referrers it
        // did not see.
        console.error(
          "Val: refusing to rename: reference scan is not complete",
          references,
        );
        return;
      }
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
      for (const ref of references.refs) {
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
      references,
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
          <p>{routePattern ? "Change URL of this page" : "Rename record"}</p>
          {description && (
            <p className="max-w-[240px] text-pretty text-fg-tertiary">
              {description}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
      <PopoverContent container={portalContainer} className="text-fg-primary">
        {keyDescription && (
          <div className="pb-2 text-sm text-fg-tertiary">{keyDescription}</div>
        )}
        {references.status === "loading" ? (
          <div className="flex flex-col gap-2">
            <div className="font-bold">Checking references</div>
            <p>
              Loading content that could reference this key
              {references.percentage > 0 ? ` (${references.percentage}%)` : ""}.
            </p>
            <p className="text-sm text-fg-tertiary">
              Renaming is disabled until the check completes, so no referring
              field is left behind.
            </p>
          </div>
        ) : references.status === "error" ? (
          <div className="flex flex-col gap-2">
            <div className="font-bold">Cannot rename</div>
            <p>References to this key could not be checked.</p>
            <p className="text-sm text-fg-tertiary">{references.message}</p>
            {references.retry && (
              <Button variant="secondary" onClick={references.retry}>
                Try again
              </Button>
            )}
          </div>
        ) : routePattern ? (
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
            keyDescription={description}
          ></RouteForm>
        ) : (
          <>
            {description && (
              <div className="pb-2 text-sm text-fg-tertiary">{description}</div>
            )}
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
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
