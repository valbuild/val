import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "./designSystem/button";
import { useSchemaAtPath, useShallowSourceAtPath } from "./ValFieldProvider";
import { useValPortal } from "./ValPortalProvider";
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
import { ReferencesResult } from "./useJsonValuesLoad";
import { useRenameRecordEntry } from "./useRenameRecordEntry";

export function ChangeRecordPopover({
  defaultValue,
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
  const isJsonValuesRecord =
    parentSchema.status === "success" &&
    parentSchema.data.type === "record" &&
    parentSchema.data.jsonValues === true;
  // The move, the referrer rewrites and the navigate that follows them are
  // `useRenameRecordEntry`'s - the same write the Pages panel goes through, so
  // the two entry points cannot come to disagree about what renaming means.
  // What is this component's own is the gate below: it is the one that KNOWS
  // whether the reference scan finished.
  const renameRecordEntry = useRenameRecordEntry();
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
      await renameRecordEntry({
        parentPath,
        fromKey: defaultValue,
        toKey: key,
        refs: references.refs,
        jsonValues: isJsonValuesRecord,
      });
      if (onComplete) {
        onComplete();
      }
    },
    [
      renameRecordEntry,
      parentPath,
      onComplete,
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
        {/*
         * The description is rendered by the branch that needs it, and NOT here.
         *
         * It used to be in both places: this one on `keyDescription` (the prop)
         * and the rename branch below on `description` (the prop, falling back to
         * the schema). For every caller that passes the prop — which is what the
         * rename control does — the two were the same string and it appeared
         * twice. The form branches own it now, because they are the ones where it
         * is guidance for an input; the loading and error branches are not asking
         * for a key at all.
         */}
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
