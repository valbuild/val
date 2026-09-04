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
  CommandSeparator,
} from "../designSystem/command";
import { Button } from "../designSystem/button";
import { Input } from "../designSystem/input";
import { cn } from "../designSystem/cn";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useNavigation } from "../../components/ValRouter";
import { Link, Check, ChevronsUpDown, Plus } from "lucide-react";
import { DropdownPreviewRow } from "../DropdownPreviewRow";
import { ReadonlyGuard } from "./ReadonlyGuard";
import { AnyField } from "../AnyField";
import { emptyOf, RoutePattern } from "@valbuild/shared/internal";
import { JSONValue } from "@valbuild/core/patch";
import { RouteForm } from "../RouteForm";
import {
  isExternalRouter,
  routePatternOfRouterModule,
} from "../creatableRouters";

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
  /**
   * Add an entry to the referenced record from here, and reference it - the
   * reference counterpart of "New page" in `RouteSelector`.
   *
   * The caller owns the WHOLE outcome - the entry, the selection, and where the
   * editor ends up afterwards - so this does not report back through
   * `onChange`: a new entry is empty, and following it is part of creating it.
   *
   * Only a record can take a new key (an object's keys ARE its schema), so
   * `KeyOfField` passes this only then. Omitted: no create option is shown.
   */
  onCreate?: (key: string) => void;
  /** The referenced record's key description, shown above the key input. */
  keyDescription?: string;
  /**
   * Set when the referenced record is a router: its keys are routes, so the new
   * key is asked for per segment rather than as a free string.
   */
  createRoutePattern?: RoutePattern[] | null;
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
  onCreate,
  keyDescription,
  createRoutePattern,
}: KeySelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  // Held rather than left to cmdk so that the create form can start from it: an
  // editor types the key they were looking for, find it is not there, and the
  // key they typed is what they want the new entry to be called.
  const [search, setSearch] = React.useState("");
  /**
   * The preview for a key, unless it has nothing to show.
   *
   * A preview built from the entry's own fields (`title: val.name`) is EMPTY
   * for an entry that was just created here, and a preview row with an empty
   * title draws a blank where the reference should be. The key is what the
   * reference is, so it is the honest fallback.
   */
  const previewOf = (key: string): KeyPreview | undefined => {
    const preview = previews?.[key];
    return preview && preview.title ? preview : undefined;
  };
  const selectedPreview = value !== null ? previewOf(value) : undefined;
  // Closing discards a half-filled form: reopening into someone else's
  // abandoned input is worse than starting clean. Same rule as `RouteSelector`.
  const closeAndReset = () => {
    setOpen(false);
    setCreating(false);
    setSearch("");
  };
  const createLabel = createRoutePattern ? "New page" : "New entry";
  const onCreateSubmit = (key: string) => {
    onCreate?.(key);
    closeAndReset();
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
        } else {
          closeAndReset();
        }
      }}
    >
      <div className="flex items-center w-full min-w-0">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-start text-left border border-border-primary bg-bg-primary hover:bg-bg-primary-hover h-auto py-1.5",
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
        {/* The same create form, reachable without opening the menu first -
            the "+" beside a reference select that Django's admin, Sanity's
            reference input and Contentful all have. It is deliberately the
            SAME popover: a second one anchored to this button would be a
            second copy of the form to keep in step. Outside the trigger, so a
            click on it opens straight into the form rather than toggling the
            list. */}
        {onCreate !== undefined && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-1 shrink-0"
            title={createLabel}
            aria-label={createLabel}
            onClick={() => {
              setCreating(true);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        container={portalContainer}
      >
        {creating && onCreate !== undefined ? (
          createRoutePattern ? (
            <div className="p-3">
              <RouteForm
                routePattern={createRoutePattern}
                existingKeys={keys}
                submitText="Create"
                keyDescription={keyDescription}
                onSubmit={onCreateSubmit}
                onCancel={() => setCreating(false)}
              />
            </div>
          ) : (
            <NewKeyForm
              defaultKey={search}
              existingKeys={keys}
              keyDescription={keyDescription}
              onSubmit={onCreateSubmit}
              onCancel={() => setCreating(false)}
            />
          )
        ) : (
          <Command>
            <CommandInput
              placeholder="Search key..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {isLoading ? (
                <div className="py-6 text-center text-sm">Loading...</div>
              ) : keys.length === 0 ? (
                <CommandEmpty>No keys found.</CommandEmpty>
              ) : (
                <CommandGroup>
                  {keys.map((key) => {
                    const preview = previewOf(key);
                    const filterValue = preview
                      ? `${key} ${preview.title}`
                      : key;
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
              {onCreate !== undefined && !isLoading && (
                <>
                  {/* Both of these are told to stay: cmdk hides a separator
                      while there is a search, and hides a GROUP whose items do
                      not match it - and a force-mounted item inside a hidden
                      group is still invisible. Which is exactly backwards here,
                      because a search that matches nothing is how the editor
                      establishes that the key does not exist yet, and the
                      moment they need this option most. The group's
                      `forceMount` reaches its items through cmdk's context. */}
                  <CommandSeparator alwaysRender />
                  <CommandGroup forceMount>
                    <CommandItem
                      value="__val_new_key__"
                      onSelect={() => setCreating(true)}
                      className="flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4 shrink-0" />
                      <span>{createLabel}</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Asking for the key of a new entry in the referenced record.
 *
 * The key is what the reference is stored as, so it is worth refusing an empty
 * or duplicate one here: adding at an existing key would silently overwrite
 * that entry - which is not "add an author", it is "replace an author".
 */
function NewKeyForm({
  defaultKey,
  existingKeys,
  keyDescription,
  onSubmit,
  onCancel,
}: {
  defaultKey?: string;
  existingKeys: string[];
  keyDescription?: string;
  onSubmit: (key: string) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = React.useState(defaultKey ?? "");
  const trimmed = key.trim();
  const error = !trimmed
    ? null
    : existingKeys.includes(trimmed)
      ? "This key already exists"
      : null;
  const disabled = !trimmed || error !== null;
  return (
    <form
      className="p-3 space-y-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (disabled) {
          return;
        }
        onSubmit(trimmed);
      }}
    >
      <div className="text-sm font-medium text-fg-primary">New entry</div>
      {keyDescription && (
        <div className="text-xs text-pretty text-fg-tertiary">
          {keyDescription}
        </div>
      )}
      <div className="space-y-1">
        <Input
          autoFocus
          value={key}
          placeholder="Key"
          onChange={(ev) => setKey(ev.target.value)}
        />
        {error && <p className="text-xs text-fg-error">{error}</p>}
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={disabled}>
          Create
        </Button>
      </div>
    </form>
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
  const { patchPath, addPatch, addModuleFilePatch } = useAddPatch(path);
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

  const referencedSchema =
    "data" in referencedSchemaAtPath ? referencedSchemaAtPath.data : undefined;
  // Adding an entry to the referenced module, so that an editor can reference
  // something that does not exist yet - an author who has not been added to the
  // authors record - without leaving the field, adding it, and coming back to
  // link it.
  //
  // A RECORD only: an object's keys are its schema, so there is no key to add.
  // A media record (`s.images()` / `s.files()`) is keyed by file path and needs
  // bytes rather than a key, so it is left to the gallery.
  const creatableRecordSchema =
    !readonly &&
    keyOf?.path !== undefined &&
    referencedSchema?.type === "record" &&
    !referencedSchema.readonly &&
    referencedSchema.mediaType === undefined
      ? referencedSchema
      : undefined;
  const [referencedModuleFilePath, referencedModulePath] =
    keyOf?.path !== undefined
      ? Internal.splitModuleFilePathAndModulePath(keyOf.path)
      : [undefined, undefined];
  // A key of a router record IS a route, so it is asked for per segment - the
  // same form the sitemap's "Add page" uses. The external router is the
  // exception: its keys are plain URLs.
  const createRoutePattern =
    creatableRecordSchema?.router !== undefined &&
    referencedModuleFilePath !== undefined &&
    !isExternalRouter(creatableRecordSchema.router)
      ? routePatternOfRouterModule(referencedModuleFilePath)
      : null;
  // What to write in the key box. The record's own key schema describes the key
  // itself ("Unique identifier for the author"), so it is the better answer
  // when there is one; the field's description is what is left when there is
  // not, and it is still about what this reference is.
  const keyDescription =
    creatableRecordSchema?.key?.description ??
    ("data" in schemaAtPath && schemaAtPath.data?.type === "keyOf"
      ? schemaAtPath.data.description
      : undefined);
  const createKey = (key: string) => {
    if (
      creatableRecordSchema === undefined ||
      keyOf?.path === undefined ||
      referencedModuleFilePath === undefined ||
      referencedModulePath === undefined
    ) {
      return;
    }
    // The entry, in the module the key belongs to.
    addModuleFilePatch(
      referencedModuleFilePath,
      [
        {
          op: "add",
          path: Internal.createPatchPath(referencedModulePath).concat(key),
          value: emptyOf(creatableRecordSchema.item) as JSONValue,
        },
      ],
      "record",
    );
    // The reference, in this one. Immediately, rather than waiting for the new
    // key to come back through the referenced source: referencing it is what
    // the editor opened this for.
    addPatch([{ op: "replace", path: patchPath, value: key }], type);
    // And then to the entry itself, because it is EMPTY - what was created is
    // a key and a shape, and the editor still has to say who this author is.
    // Not when the entry renders inline under the selector: it is already on
    // screen, and navigating away from it is the one thing inline render
    // exists to avoid. Same rule `AddRecordPopover` follows.
    if (!inlineRender) {
      navigate(Internal.createValPathOfItem(keyOf.path, key) as SourcePath);
    }
  };

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
          onCreate={creatableRecordSchema !== undefined ? createKey : undefined}
          keyDescription={keyDescription}
          createRoutePattern={createRoutePattern}
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
