import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RoutePattern } from "@valbuild/shared/internal";
import { Button } from "./designSystem/button";
import { useSchemaAtPath, useShallowSourceAtPath } from "./ValFieldProvider";
import { useValPortal } from "./ValPortalProvider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import { RouteForm } from "./RouteForm";
import { RenameRecordKeyForm } from "./RenameRecordKeyForm";
import { useDuplicateRecordEntry } from "./useDuplicateRecordEntry";

/**
 * Duplicate this record entry under a key you choose.
 *
 * The same two forms `ChangeRecordPopover` uses, because the question is the
 * same one: which key. A route gets the segment inputs, prefilled from the
 * entry being copied so the usual answer is one segment away; anything else
 * gets a plain key input. Both refuse the key the entry already has, which is
 * what stops a duplicate from being a no-op.
 *
 * No reference scan, unlike renaming. A rename has to rewrite every field
 * pointing at the old key or leave it dangling; a duplicate leaves the
 * original exactly where it was, so nothing that referred to it is affected.
 */
export function DuplicateRecordPopover({
  parentPath,
  defaultValue,
  variant,
  size,
  children,
  routePattern,
  keyDescription,
  onComplete,
}: {
  parentPath: SourcePath | ModuleFilePath;
  /** The key of the entry being duplicated. */
  defaultValue: string;
  variant: "ghost" | "outline" | "default" | "secondary";
  size: "icon" | "sm" | "lg" | "default";
  children: React.ReactNode;
  routePattern?: RoutePattern[] | null;
  keyDescription?: string;
  onComplete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const portalContainer = useValPortal();
  const duplicate = useDuplicateRecordEntry();
  const parentSource = useShallowSourceAtPath(parentPath, "record");
  const parentSchema = useSchemaAtPath(parentPath);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const existingKeys = useMemo(() => {
    if ("data" in parentSource && parentSource.data) {
      return Object.keys(parentSource.data);
    }
    return [];
  }, [parentSource]);

  const record =
    parentSchema.status === "success" && parentSchema.data.type === "record"
      ? parentSchema.data
      : null;
  const description = keyDescription ?? record?.key?.description;

  const onSubmit = useCallback(
    (key: string) => {
      setOpen(false);
      void duplicate({
        parentPath,
        fromKey: defaultValue,
        toKey: key,
        jsonValues: record?.jsonValues === true,
      });
      onComplete?.();
    },
    [duplicate, parentPath, defaultValue, record, onComplete],
  );

  // No record, no keys to choose between and nothing to copy into. Every
  // rendered case has one; bailing out beats offering a button that cannot
  // work.
  if (record === null) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          <p>{routePattern ? "Duplicate this page" : "Duplicate record"}</p>
          <p className="max-w-[240px] text-pretty text-fg-tertiary">
            {routePattern
              ? "Copies everything on this page to a new URL."
              : "Copies everything in this record to a new key."}
          </p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent container={portalContainer} className="text-fg-primary">
        {routePattern ? (
          <RouteForm
            routePattern={routePattern}
            existingKeys={existingKeys}
            defaultValue={defaultValue}
            onSubmit={onSubmit}
            onCancel={() => setOpen(false)}
            submitText="Duplicate"
            keyDescription={description}
          />
        ) : (
          <>
            {description && (
              <div className="pb-2 text-sm text-fg-tertiary">{description}</div>
            )}
            <RenameRecordKeyForm
              parentPath={parentPath}
              defaultValue={defaultValue}
              existingKeys={existingKeys}
              onSubmit={onSubmit}
              onCancel={() => setOpen(false)}
              submitText="Duplicate"
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
