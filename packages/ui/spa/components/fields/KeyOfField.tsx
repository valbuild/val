import * as React from "react";
import { ImageSource, Internal, SourcePath } from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  usePreviewAtPath,
} from "../ValFieldProvider";
import { useValPortal } from "../ValPortalProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../designSystem/command";
import { Button, insetFocusRing } from "../designSystem/button";
import { cn } from "../designSystem/cn";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useNavigation } from "../../components/ValRouter";
import { Link, Check, ChevronsUpDown } from "lucide-react";
import { DropdownPreviewRow } from "../DropdownPreviewRow";
import { ReadonlyGuard } from "./ReadonlyGuard";
import { AnyField } from "../AnyField";

export type KeyPreview = {
  title: string;
  subtitle?: string | null;
  image?: ImageSource | string | null;
};

export interface KeySelectorProps {
  keys: string[];
  previews?: Record<string, KeyPreview | undefined>;
  value: string | null;
  onChange: (key: string) => void;
  placeholder?: string;
  className?: string;
  portalContainer?: HTMLElement | null;
  isLoading?: boolean;
}

export function KeySelector({
  keys,
  previews,
  value,
  onChange,
  placeholder = "Select key...",
  className,
  portalContainer,
  isLoading = false,
}: KeySelectorProps) {
  const [open, setOpen] = React.useState(false);
  const selectedPreview = value ? previews?.[value] : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-start text-left border border-border-primary bg-bg-primary hover:bg-bg-primary-hover h-auto py-1.5",
            insetFocusRing,
            className,
          )}
        >
          {value ? (
            selectedPreview ? (
              <DropdownPreviewRow
                title={selectedPreview.title}
                subtitle={selectedPreview.subtitle ?? null}
                image={selectedPreview.image ?? null}
              />
            ) : (
              <span className="truncate flex-1">{value}</span>
            )
          ) : (
            <span className="truncate flex-1">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        container={portalContainer}
      >
        <Command>
          <CommandInput placeholder="Search key..." />
          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-sm">Loading...</div>
            ) : keys.length === 0 ? (
              <CommandEmpty>No keys found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {keys.map((key) => {
                  const preview = previews?.[key];
                  const filterValue = preview ? `${key} ${preview.title}` : key;
                  return (
                    <CommandItem
                      key={key}
                      value={filterValue}
                      onSelect={() => {
                        onChange(key);
                        setOpen(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          value === key ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {preview ? (
                        <DropdownPreviewRow
                          title={preview.title}
                          subtitle={preview.subtitle ?? null}
                          image={preview.image ?? null}
                        />
                      ) : (
                        <span className="truncate">{key}</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function KeyOfField({
  path,
  readonly,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
}) {
  const type = "keyOf";
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const keyOf =
    "data" in schemaAtPath &&
    schemaAtPath.data &&
    schemaAtPath.data.type === "keyOf"
      ? {
          type: schemaAtPath.data.schema?.type,
          path: schemaAtPath.data.path,
        }
      : undefined;

  const referencedSource = useShallowSourceAtPath(
    keyOf?.path,
    keyOf?.type as "record" | "object",
  );
  const referencedPreview = usePreviewAtPath(
    (keyOf?.path ?? path) as SourcePath,
  );
  // For `.render({ as: "inline" })` the selected entry's CONTENT is rendered
  // below the selector, so the referenced module's schema is needed too.
  const inlineRender =
    "data" in schemaAtPath &&
    schemaAtPath.data?.type === "keyOf" &&
    schemaAtPath.data.render?.as === "inline";
  const referencedSchemaAtPath = useSchemaAtPath(keyOf?.path ?? path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const portalContainer = useValPortal();
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={schemaAtPath}
      />
    );
  }
  if (referencedSource.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={referencedSource.error}
        schema={schemaAtPath}
      />
    );
  }
  if (
    sourceAtPath.status == "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (
    keyOf !== undefined &&
    !(keyOf.type === "record" || keyOf.type === "object")
  ) {
    return (
      <FieldSchemaError
        path={keyOf.path}
        error={`Cannot refer to keyOf type: ${keyOf.type}. Must refer to be record or object`}
      />
    );
  }
  if (keyOf !== undefined && referencedSource.status === "not-found") {
    return (
      <FieldSchemaError
        path={keyOf.path}
        error="Referenced source not found"
        type={keyOf.type}
      />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <FieldLoading path={path} type={type} />;
  }
  if (
    "data" in schemaAtPath &&
    schemaAtPath.data &&
    schemaAtPath.data.type !== type
  ) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }
  if (!referencedSource) {
    return (
      <FieldSchemaError
        path={keyOf?.path}
        error="Referenced source not found"
        type={"keyOf"}
      />
    );
  }
  if ("data" in referencedSource && referencedSource.data === null) {
    return (
      <FieldSchemaError
        path={keyOf?.path}
        error="Referenced source is null"
        type={"keyOf"}
      />
    );
  }
  const keys =
    "data" in referencedSource && referencedSource.data
      ? Object.keys(referencedSource.data)
      : undefined;
  const source = sourceAtPath.data as string | null;
  const previews = buildKeyPreviews(referencedPreview);
  const isLoading =
    schemaAtPath.status === "loading" ||
    keyOf === undefined ||
    keys === undefined;

  // The schema of the entry the key points at: a record's item schema, or the
  // selected key's field schema when the reference is to an object.
  const referencedItemSchema =
    inlineRender && "data" in referencedSchemaAtPath
      ? referencedSchemaAtPath.data?.type === "record"
        ? referencedSchemaAtPath.data.item
        : referencedSchemaAtPath.data?.type === "object" && source !== null
          ? referencedSchemaAtPath.data.items[source]
          : undefined
      : undefined;
  // `source !== null`, not a truthiness check: the empty string is a valid
  // record/object key, and treating it as "nothing selected" is what left the
  // referenced content unrendered for it.
  const referencedItemPath =
    inlineRender && keyOf?.path && source !== null
      ? Internal.createValPathOfItem(keyOf.path, source)
      : undefined;

  const content = (
    <div id={path}>
      <div className="flex justify-between items-center">
        <KeySelector
          keys={keys ?? []}
          previews={previews}
          value={source}
          onChange={(key) => {
            addPatch(
              [
                {
                  op: "replace",
                  path: patchPath,
                  value: key,
                },
              ],
              type,
            );
          }}
          portalContainer={portalContainer}
          isLoading={isLoading}
        />
        {source && keyOf?.path && (
          <button
            title="Go to reference"
            className="px-2"
            onClick={() => {
              navigate(
                Internal.createValPathOfItem(keyOf.path, source) as SourcePath,
              );
            }}
          >
            <Link size={16} />
          </button>
        )}
      </div>
      {inlineRender &&
        referencedItemPath !== undefined &&
        referencedItemSchema !== undefined && (
          <div className="mt-2 rounded-md border border-border-primary p-3">
            {/* Edits here go to the referenced module (this is the SHARED
                entry, not a copy), which is what a reference means — but it is
                worth a label so nobody mistakes it for row-local content. */}
            <div className="pb-2 text-xs text-fg-quaternary truncate">
              {source}
            </div>
            <AnyField
              path={referencedItemPath}
              schema={referencedItemSchema}
              readonly={readonly === true}
              compact
            />
          </div>
        )}
    </div>
  );
  if (readonly) {
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

function buildKeyPreviews(
  previewAtPath: ReturnType<typeof usePreviewAtPath>,
): Record<string, KeyPreview> | undefined {
  if (!previewAtPath || !("data" in previewAtPath) || !previewAtPath.data) {
    return undefined;
  }
  const previewData = previewAtPath.data;
  if (previewData.parent !== "record") {
    return undefined;
  }
  const out: Record<string, KeyPreview> = {};
  for (const [key, value] of previewData.items) {
    out[key] = {
      title: value.title,
      subtitle: value.subtitle ?? null,
      image: value.image ?? null,
    };
  }
  return out;
}

export function KeyOfPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "keyOf");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <div className="truncate">{sourceAtPath.data as string}</div>;
}
