import * as React from "react";
import {
  ImageSource,
  Internal,
  ModuleFilePath,
  ModulePath,
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
  useAllPreviews,
} from "../ValFieldProvider";
import { useValPortal } from "../ValPortalProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import {
  WindowedOptionList,
  type WindowedOptionAction,
} from "../WindowedOptionList";
import { Button, insetFocusRing } from "../designSystem/button";
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
import { NewExternalPageForm } from "../NewExternalPageForm";
import { ReadonlyGuard } from "./ReadonlyGuard";

export interface RouteSelectorRoute {
  route: string;
  moduleFilePath: string;
  preview?: {
    title: string;
    subtitle?: string | null;
    image?: ImageSource | string | null;
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
  const filteredRoutes = React.useMemo(
    () =>
      routes.filter((routeInfo) => {
        // If include pattern exists, route must match it
        if (includePattern && !includePattern.test(routeInfo.route)) {
          return false;
        }
        // If exclude pattern exists, route must NOT match it
        if (excludePattern && excludePattern.test(routeInfo.route)) {
          return false;
        }
        return true;
      }),
    [routes, includePattern, excludePattern],
  );

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
            "w-full justify-start text-left border border-border-primary bg-bg-primary hover:bg-bg-primary-hover h-auto py-1.5",
            insetFocusRing,
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
            schemes={externalRouter.schemes}
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
          <RouteOptions
            routes={filteredRoutes}
            value={value}
            placeholder={placeholder}
            isLoading={isLoading}
            onChoose={(route) => {
              onChange(route);
              setOpen(false);
            }}
            actions={[
              ...(canCreatePage
                ? [
                    {
                      id: "__val_new_page__",
                      label: "New page",
                      icon: <Plus className="h-4 w-4 shrink-0" />,
                      onSelect: () => setCreating("page"),
                    },
                  ]
                : []),
              ...(canCreateExternal
                ? [
                    {
                      id: "__val_new_external_page__",
                      label: "New external page",
                      icon: <Earth className="h-4 w-4 shrink-0" />,
                      onSelect: () => setCreating("external"),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The routes as options, rendered only while the list is open and only the
 * ones on screen (`WindowedOptionList`): a site of 10,000 pages is 10,000
 * options.
 */
function RouteOptions({
  routes,
  value,
  placeholder,
  isLoading,
  onChoose,
  actions,
}: {
  routes: RouteSelectorRoute[];
  value: string | null;
  placeholder: string;
  isLoading: boolean;
  onChoose: (route: string) => void;
  actions: WindowedOptionAction[];
}) {
  // Its own, so it starts empty each time the list opens.
  const [search, setSearch] = React.useState("");
  const options = React.useMemo(
    () =>
      routes.map((routeInfo) => ({
        key: routeInfo.route,
        filterText: routeInfo.preview
          ? `${routeInfo.route} ${routeInfo.preview.title}`
          : routeInfo.route,
        routeInfo,
      })),
    [routes],
  );
  return (
    <WindowedOptionList
      label="Routes"
      options={options}
      selectedKey={value}
      search={search}
      onSearchChange={setSearch}
      placeholder={placeholder}
      emptyText="No routes found."
      isLoading={isLoading}
      onSelect={(option) => onChoose(option.key)}
      renderOption={({ routeInfo }, { selected }) => (
        <>
          <Check
            className={cn(
              "h-4 w-4 shrink-0",
              selected ? "opacity-100" : "opacity-0",
            )}
          />
          {routeInfo.preview ? (
            <DropdownPreviewRow
              title={routeInfo.preview.title}
              subtitle={routeInfo.preview.subtitle ?? null}
              image={routeInfo.preview.image ?? null}
            />
          ) : (
            <span className="truncate">{routeInfo.route}</span>
          )}
        </>
      )}
      actions={actions}
    />
  );
}

function toAvailableRoute(router: CreatableRouter): AvailableRoute {
  return {
    moduleFilePath: router.moduleFilePath,
    routePattern: router.routePattern,
    patternString: router.patternString,
    existingKeys: router.existingKeys,
    keyDescription: router.keyDescription,
    routeParams: router.routeParams,
  };
}

function useRouteSelectorRoutes(
  routesWithModulePaths: Array<{ route: string; moduleFilePath: string }>,
): RouteSelectorRoute[] {
  const allPreviews = useAllPreviews();
  return React.useMemo(() => {
    const previewItemsByModule = new Map<
      string,
      Map<string, RouteSelectorRoute["preview"]>
    >();
    return routesWithModulePaths.map(({ route, moduleFilePath }) => {
      if (!previewItemsByModule.has(moduleFilePath)) {
        const itemMap = new Map<string, RouteSelectorRoute["preview"]>();
        const previewAtModule = allPreviews[moduleFilePath as ModuleFilePath];
        if (previewAtModule) {
          const modulePreview =
            previewAtModule[moduleFilePath as ModuleFilePath];
          if (
            modulePreview &&
            "data" in modulePreview &&
            modulePreview.data &&
            modulePreview.data.rows?.parent === "record"
          ) {
            for (const [key, value] of modulePreview.data.rows.items) {
              itemMap.set(key, {
                title: value.title,
                subtitle: value.subtitle ?? null,
                image: value.image ?? null,
              });
            }
          }
        }
        previewItemsByModule.set(moduleFilePath, itemMap);
      }
      const preview =
        previewItemsByModule.get(moduleFilePath)?.get(route) ?? null;
      return { route, moduleFilePath, preview };
    });
  }, [routesWithModulePaths, allPreviews]);
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
