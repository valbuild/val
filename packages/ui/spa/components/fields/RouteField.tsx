import { Internal, ModulePath, SourcePath } from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useValPortal,
} from "../ValProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
  SelectTrigger,
} from "../designSystem/select";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useNavigation } from "../../components/ValRouter";
import { Link } from "lucide-react";
import { ValidationErrors } from "../../components/ValidationError";
import { useRoutesWithModulePaths } from "../useRoutesOf";

export function RouteField({ path }: { path: SourcePath }) {
  const type = "route";
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const portalContainer = useValPortal();
  const routesWithModulePaths = useRoutesWithModulePaths();

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

  const filteredRoutes = routesWithModulePaths.filter((routeInfo) => {
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

  // Find the module path for the currently selected route
  const selectedRouteInfo = source
    ? routesWithModulePaths.find((r) => r.route === source)
    : undefined;

  return (
    <div id={path}>
      <ValidationErrors path={path} />
      <div className="flex justify-between items-center">
        <Select
          value={source ?? ""}
          onValueChange={(value) => {
            addPatch(
              [
                {
                  op: "replace",
                  path: patchPath,
                  value: value,
                },
              ],
              type,
            );
          }}
        >
          <SelectTrigger>
            <SelectValue>{source}</SelectValue>
          </SelectTrigger>
          <SelectContent className="w-32" container={portalContainer}>
            {schemaAtPath.status === "loading" ? (
              <LoadingSelectContent />
            ) : filteredRoutes.length === 0 ? (
              <span className="p-2 text-sm text-muted-foreground">
                No routes found
              </span>
            ) : (
              filteredRoutes.map((routeInfo) => (
                <SelectItem key={routeInfo.route} value={routeInfo.route}>
                  {routeInfo.route}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
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
}

function LoadingSelectContent() {
  return <span>Loading...</span>;
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
  return <div className="truncate">{sourceAtPath.data}</div>;
}
