import * as React from "react";
import {
  ImageMetadata,
  ImageSource,
  Internal,
  ListRecordRender,
  RemoteSource,
  SourcePath,
} from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useRenderOverrideAtPath,
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
import { Button } from "../designSystem/button";
import { cn } from "../designSystem/cn";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useNavigation } from "../../components/ValRouter";
import { Link, Check, ChevronsUpDown } from "lucide-react";
import { ValidationErrors } from "../../components/ValidationError";
import { DropdownPreviewRow } from "../DropdownPreviewRow";

export type KeyPreview = {
  title: string;
  subtitle?: string | null;
  image?: ImageSource | RemoteSource<ImageMetadata> | string | null;
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
            "w-full justify-between border border-input bg-bg-primary hover:bg-bg-primary-hover h-auto py-1.5",
            className,
          )}
        >
          {value ? (
            selectedPreview ? (
              <DropdownPreviewRow
                title={selectedPreview.title}
                subtitle={selectedPreview.subtitle ?? null}
                image={selectedPreview.image ?? null}
                placeholder={false}
              />
            ) : (
              <span className="truncate">{value}</span>
            )
          ) : (
            <span className="truncate">{placeholder}</span>
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
                          placeholder={false}
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
  const referencedRender = useRenderOverrideAtPath(
    (keyOf?.path ?? path) as SourcePath,
  );
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
  const previews = buildKeyPreviews(referencedRender);
  const isLoading =
    schemaAtPath.status === "loading" ||
    keyOf === undefined ||
    keys === undefined;

  const content = (
    <div id={path}>
      <ValidationErrors path={path} />
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
    </div>
  );
  if (readonly) {
    return (
      <div className="pointer-events-none opacity-70" aria-disabled="true">
        {content}
      </div>
    );
  }
  return content;
}

function buildKeyPreviews(
  renderAtPath: ReturnType<typeof useRenderOverrideAtPath>,
): Record<string, KeyPreview> | undefined {
  if (!renderAtPath || !("data" in renderAtPath) || !renderAtPath.data) {
    return undefined;
  }
  const renderData = renderAtPath.data;
  if (renderData.layout !== "list" || renderData.parent !== "record") {
    return undefined;
  }
  const recordRender = renderData as ListRecordRender;
  const out: Record<string, KeyPreview> = {};
  for (const [key, value] of recordRender.items) {
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
