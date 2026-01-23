import * as React from "react";
import { Internal, SourcePath } from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
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

export function KeyOfField({ path }: { path: SourcePath }) {
  const type = "keyOf";
  const [open, setOpen] = React.useState(false);
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
  const isLoading =
    schemaAtPath.status === "loading" ||
    keyOf === undefined ||
    keys === undefined;

  return (
    <div id={path}>
      <ValidationErrors path={path} />
      <div className="flex justify-between items-center">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between border border-input bg-bg-primary hover:bg-bg-primary-hover"
            >
              <span className="truncate">{source || "Select key..."}</span>
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
                    {keys.map((key) => (
                      <CommandItem
                        key={key}
                        value={key}
                        onSelect={(currentValue) => {
                          addPatch(
                            [
                              {
                                op: "replace",
                                path: patchPath,
                                value: currentValue,
                              },
                            ],
                            type,
                          );
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            source === key ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {key}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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
