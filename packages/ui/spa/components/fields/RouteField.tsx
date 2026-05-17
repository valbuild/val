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
import { Link, Check, ChevronsUpDown } from "lucide-react";
import { ValidationErrors } from "../../components/ValidationError";
import { useRoutesWithModulePaths } from "../useRoutesOf";
import { DropdownPreviewRow } from "../DropdownPreviewRow";

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
}: RouteSelectorProps) {
  const [open, setOpen] = React.useState(false);

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
            "w-full justify-between border border-input bg-bg-primary hover:bg-bg-primary-hover h-auto py-1.5",
            className,
          )}
        >
          {selectedRoute && selectedRoute.preview ? (
            <DropdownPreviewRow
              title={selectedRoute.preview.title}
              subtitle={selectedRoute.preview.subtitle ?? null}
              image={selectedRoute.preview.image ?? null}
              placeholder={false}
            />
          ) : (
            <span className="truncate">{value || placeholder}</span>
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
                          placeholder={false}
                        />
                      ) : (
                        <span className="truncate">{routeInfo.route}</span>
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
      <ValidationErrors path={path} />
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
    return (
      <div className="pointer-events-none opacity-70" aria-disabled="true">
        {content}
      </div>
    );
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
