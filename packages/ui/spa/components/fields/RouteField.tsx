import * as React from "react";
import {
  ImageMetadata,
  ImageSource,
  Internal,
  ListRecordRender,
  ModuleFilePath,
  ModulePath,
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
  useAllRenders,
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
import { Link, Check, ChevronsUpDown, Earth, Plus } from "lucide-react";
import { useRoutesWithModulePaths } from "../useRoutesOf";
import { DropdownPreviewRow } from "../DropdownPreviewRow";
import {
  CreatableRouter,
  useCreatableRouters,
  useCreateRouteEntry,
} from "../useCreateRouteEntry";
import { NewPageForm, AvailableRoute } from "../NavMenu/NewPageForm";
import { CommandSeparator } from "../designSystem/command";
import { ReadonlyGuard } from "./ReadonlyGuard";

export interface RouteSelectorRoute {
  route: string;
  moduleFilePath: string;
  preview?: {
    title: string;
    subtitle?: string | null;
    image?: ImageSource | RemoteSource<ImageMetadata> | string | null;
  } | null;
}

export interface RouteSelectorProps {
  routes: RouteSelectorRoute[];
  value: string | null;
  onChange: (route: string) => void;
  includePattern?: RegExp;
  excludePattern?: RegExp;
  placeholder?: string;
  className?: string;
  portalContainer?: HTMLElement | null;
  isLoading?: boolean;
  zIndex?: number;
  readonly?: boolean;
  /**
   * Let the editor create a page - or an external link - from inside the
   * dropdown, instead of leaving to create it and coming back to link it.
   */
  allowCreate?: boolean;
}

export function RouteSelector({
  routes,
  value,
  onChange,
  includePattern,
  excludePattern,
  placeholder = "Select route...",
  className,
  portalContainer,
  isLoading = false,
  zIndex,
  readonly,
  allowCreate = false,
}: RouteSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [creating, setCreating] = React.useState<null | "page" | "external">(
    null,
  );
  const { pageRouters, externalRouter } = useCreatableRouters();
  const createRouteEntry = useCreateRouteEntry();

  // Closing the popover discards a half-filled form: reopening into someone
  // else's abandoned input is worse than starting clean.
  const closeAndReset = () => {
    setOpen(false);
    setCreating(null);
  };

  const canCreatePage = allowCreate && !readonly && pageRouters.length > 0;
  const canCreateExternal = allowCreate && !readonly && externalRouter !== null;

  // Filter routes based on include/exclude patterns
  const filteredRoutes = routes.filter((routeInfo) => {
    // If include pattern exists, route must match it
    if (includePattern && !includePattern.test(routeInfo.route)) {
      return false;
    }
    // If exclude pattern exists, route must NOT match it
    if (excludePattern && excludePattern.test(routeInfo.route)) {
      return false;
    }
    return true;
  });

  const selectedRoute = value
    ? filteredRoutes.find((r) => r.route === value)
    : undefined;
  return (
    <Popover
      open={readonly ? false : open}
      onOpenChange={readonly ? undefined : setOpen}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-start text-left border border-input bg-bg-primary hover:bg-bg-primary-hover h-auto py-1.5",
            className,
          )}
        >
          {selectedRoute && selectedRoute.preview ? (
            <DropdownPreviewRow
              title={selectedRoute.preview.title}
              subtitle={selectedRoute.preview.subtitle ?? null}
              image={selectedRoute.preview.image ?? null}
            />
          ) : (
            <span className="truncate flex-1">{value || placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        style={{
          zIndex,
        }}
        container={portalContainer}
      >
        {creating === "page" && (
          <NewPageForm
            routes={pageRouters.map(toAvailableRoute)}
            onSubmit={(moduleFilePath, urlPath) => {
              const router = pageRouters.find(
                (candidate) => candidate.moduleFilePath === moduleFilePath,
              );
              if (!router) {
                return;
              }
              // Select it immediately rather than waiting for the new entry to
              // come back through the routes list: linking is what the editor
              // opened this dropdown to do.
              if (createRouteEntry(router, urlPath) !== null) {
                onChange(urlPath);
              }
              closeAndReset();
            }}
            onCancel={() => setCreating(null)}
          />
        )}
        {creating === "external" && externalRouter && (
          <NewExternalPageForm
            existingKeys={externalRouter.existingKeys}
            onSubmit={(url) => {
              if (createRouteEntry(externalRouter, url) !== null) {
                onChange(url);
              }
              closeAndReset();
            }}
            onCancel={() => setCreating(null)}
          />
        )}
        {creating === null && (
          <Command>
            <CommandInput placeholder={placeholder} />
            <CommandList>
              {isLoading ? (
                <div className="py-6 text-center text-sm">Loading...</div>
              ) : filteredRoutes.length === 0 ? (
                <CommandEmpty>No routes found.</CommandEmpty>
              ) : (
                <CommandGroup>
                  {filteredRoutes.map((routeInfo) => {
                    const preview = routeInfo.preview;
                    const filterValue = preview
                      ? `${routeInfo.route} ${preview.title}`
                      : routeInfo.route;
                    return (
                      <CommandItem
                        key={routeInfo.route}
                        value={filterValue}
                        onSelect={() => {
                          onChange(routeInfo.route);
                          setOpen(false);
                        }}
                        className="flex items-center gap-2"
                      >
                        <Check
                          className={cn(
                            "h-4 w-4 shrink-0",
                            value === routeInfo.route
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        {preview ? (
                          <DropdownPreviewRow
                            title={preview.title}
                            subtitle={preview.subtitle ?? null}
                            image={preview.image ?? null}
                          />
                        ) : (
                          <span className="truncate">{routeInfo.route}</span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
              {(canCreatePage || canCreateExternal) && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    {canCreatePage && (
                      <CommandItem
                        value="__val_new_page__"
                        onSelect={() => setCreating("page")}
                        className="flex items-center gap-2"
                      >
                        <Plus className="h-4 w-4 shrink-0" />
                        <span>New page</span>
                      </CommandItem>
                    )}
                    {canCreateExternal && (
                      <CommandItem
                        value="__val_new_external_page__"
                        onSelect={() => setCreating("external")}
                        className="flex items-center gap-2"
                      >
                        <Earth className="h-4 w-4 shrink-0" />
                        <span>New external page</span>
                      </CommandItem>
                    )}
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
 * Creating an entry in the external page router.
 *
 * Its keys are absolute URLs rather than route patterns, so it gets a plain
 * input rather than the per-segment inputs `NewPageForm` builds. The rule is
 * the one `externalPageRouter.validate` enforces server-side - checked here so
 * the editor sees it while typing rather than as a validation error afterwards.
 */
function NewExternalPageForm({
  existingKeys,
  onSubmit,
  onCancel,
}: {
  existingKeys: string[];
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = React.useState("");
  const trimmed = url.trim();
  const alreadyExists = existingKeys.includes(trimmed);
  const hasScheme =
    trimmed.startsWith("https://") || trimmed.startsWith("http://");
  const error = !trimmed
    ? null
    : !hasScheme
      ? "Must start with https:// or http://"
      : alreadyExists
        ? "This external page already exists"
        : null;
  const disabled = !trimmed || error !== null;

  return (
    <form
      className="p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        onSubmit(trimmed);
      }}
    >
      <div className="text-sm font-medium text-fg-primary">
        New external page
      </div>
      <div className="space-y-1">
        <input
          autoFocus
          className={cn(
            "w-full p-1 bg-bg-secondary border border-border-primary rounded text-fg-primary",
            "focus:outline-none focus:ring-1 focus:ring-border-focus",
            { "border-fg-error": error !== null },
          )}
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
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

function toAvailableRoute(router: CreatableRouter): AvailableRoute {
  return {
    moduleFilePath: router.moduleFilePath,
    routePattern: router.routePattern,
    patternString: router.patternString,
    existingKeys: router.existingKeys,
    keyDescription: router.keyDescription,
  };
}

function useRouteSelectorRoutes(
  routesWithModulePaths: Array<{ route: string; moduleFilePath: string }>,
): RouteSelectorRoute[] {
  const allRenders = useAllRenders();
  return React.useMemo(() => {
    const renderItemsByModule = new Map<
      string,
      Map<string, RouteSelectorRoute["preview"]>
    >();
    return routesWithModulePaths.map(({ route, moduleFilePath }) => {
      if (!renderItemsByModule.has(moduleFilePath)) {
        const itemMap = new Map<string, RouteSelectorRoute["preview"]>();
        const renderAtModule = allRenders[moduleFilePath as ModuleFilePath];
        if (renderAtModule) {
          const moduleRender = renderAtModule[moduleFilePath as ModuleFilePath];
          if (
            moduleRender &&
            "data" in moduleRender &&
            moduleRender.data &&
            moduleRender.data.layout === "list" &&
            moduleRender.data.parent === "record"
          ) {
            const recordRender = moduleRender.data as ListRecordRender;
            for (const [key, value] of recordRender.items) {
              itemMap.set(key, {
                title: value.title,
                subtitle: value.subtitle ?? null,
                image: value.image ?? null,
              });
            }
          }
        }
        renderItemsByModule.set(moduleFilePath, itemMap);
      }
      const preview =
        renderItemsByModule.get(moduleFilePath)?.get(route) ?? null;
      return { route, moduleFilePath, preview };
    });
  }, [routesWithModulePaths, allRenders]);
}

export function RouteField({
  path,
  readonly,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
}) {
  const type = "route";
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const portalContainer = useValPortal();
  const routesWithModulePaths = useRoutesWithModulePaths();
  const routesWithPreview = useRouteSelectorRoutes(routesWithModulePaths);

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
  if (
    sourceAtPath.status == "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
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

  const source = sourceAtPath.data as string | null;

  // Filter routes based on include/exclude patterns if they exist
  const schema =
    "data" in schemaAtPath && schemaAtPath.data?.type === "route"
      ? schemaAtPath.data
      : undefined;

  const includePattern = schema?.options?.include
    ? new RegExp(schema.options.include.source, schema.options.include.flags)
    : undefined;
  const excludePattern = schema?.options?.exclude
    ? new RegExp(schema.options.exclude.source, schema.options.exclude.flags)
    : undefined;

  // Find the module path for the currently selected route
  const selectedRouteInfo = source
    ? routesWithModulePaths.find((r) => r.route === source)
    : undefined;

  const isLoading = schemaAtPath.status === "loading";

  const content = (
    <div id={path}>
      <div className="flex justify-between items-center">
        <RouteSelector
          routes={routesWithPreview}
          value={source}
          onChange={(route) => {
            if (readonly) return;
            addPatch(
              [
                {
                  op: "replace",
                  path: patchPath,
                  value: route,
                },
              ],
              type,
            );
          }}
          includePattern={includePattern}
          excludePattern={excludePattern}
          portalContainer={portalContainer}
          isLoading={isLoading}
          readonly={readonly}
          allowCreate
        />
        {source && selectedRouteInfo && (
          <button
            title="Go to reference"
            className="px-2"
            onClick={() => {
              navigate(
                Internal.joinModuleFilePathAndModulePath(
                  selectedRouteInfo.moduleFilePath,
                  JSON.stringify(source) as ModulePath,
                ),
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
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

export function RoutePreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "route");
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
