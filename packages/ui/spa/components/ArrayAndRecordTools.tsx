import {
  SourcePath,
  Internal,
  ModulePath,
  ModuleFilePath,
  isInlineRender,
} from "@valbuild/core";
import * as React from "react";
import { JSONValue } from "@valbuild/core/patch";
import { Plus, Trash, Edit, Link, Copy } from "lucide-react";
import { emptyOf } from "@valbuild/shared/internal";
import { Button } from "./designSystem/button";
import { prettifyFilename } from "../utils/prettifyFilename";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "./ValFieldProvider";
import { useNextAppRouterSrcFolder } from "./ValProvider";
import { useValPortal } from "./ValPortalProvider";
import { useNavigation } from "./ValRouter";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import {
  isArray,
  isParentRecord,
  isRecord,
  useParent,
} from "../hooks/useParent";
import { useKeysOf } from "./useKeysOf";
import { useEagerRouteReferences } from "./useRouteReferences";
import { mergeReferences } from "./useJsonValuesLoad";
import { DeleteRecordPopover } from "./DeleteRecordPopover";
import { AddRecordPopover } from "./AddRecordPopover";
import { RoutePattern, parseRoutePattern } from "@valbuild/shared/internal";
import { getPatternFromModuleFilePath } from "@valbuild/shared/internal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import { ChangeRecordPopover } from "./ChangeRecordPopover";
import { DuplicateRecordPopover } from "./DuplicateRecordPopover";
import { ConnectedReferencesList } from "./ReferencesList";

type Variant = "module" | "field";
export function ArrayAndRecordTools({
  path,
  variant,
}: {
  path: SourcePath;
  variant: Variant;
}) {
  const schemaAtPath = useSchemaAtPath(path);
  const { path: maybeParentPath, schema: parentSchemaAtPath } = useParent(path);
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const parts = splitIntoInitAndLastParts(path);
  const last = parts[parts.length - 1];
  const refs = useKeysOf(
    maybeParentPath as unknown as ModuleFilePath,
    isParentRecord(path, maybeParentPath, parentSchemaAtPath)
      ? last?.part
      : undefined,
  );
  const srcFolder = useNextAppRouterSrcFolder();
  /**
   * Memoised, because these arrays are PROPS that end up in a dependency list.
   *
   * `getRouterPattern` parses into a fresh array on every call, and both are
   * passed down to `RouteForm` (via the add and change popovers), whose
   * `useEffect(..., [defaultValue, routePattern])` calls `setParams` with a
   * freshly built object. Unstable in, unstable out: the effect re-ran every
   * render and its own `setParams` caused the next one.
   *
   * The code here is unchanged from `main` — this is a latent loop that only
   * needed something to re-render this component often enough to enter it, which
   * `.jsonValues()` entry loading duly provided. Verified load-bearing: reverting
   * this memo alone brings the crash back on a 121-entry record.
   */
  const routePattern = React.useMemo(
    () =>
      isRecord("data" in schemaAtPath ? schemaAtPath.data : undefined) &&
      srcFolder.status === "success" &&
      srcFolder.data &&
      "data" in schemaAtPath &&
      schemaAtPath.data.type === "record" &&
      schemaAtPath.data.router
        ? getRouterPattern(
            moduleFilePath,
            srcFolder.data,
            schemaAtPath.data.router,
          )
        : null,
    [schemaAtPath, srcFolder, moduleFilePath],
  );
  const parentRoutePattern = React.useMemo(
    () =>
      isParentRecord(path, maybeParentPath, parentSchemaAtPath) &&
      srcFolder.status === "success" &&
      srcFolder.data &&
      parentSchemaAtPath &&
      parentSchemaAtPath.type === "record" &&
      parentSchemaAtPath.router
        ? getRouterPattern(
            moduleFilePath,
            srcFolder.data,
            parentSchemaAtPath.router,
          )
        : null,
    [path, maybeParentPath, parentSchemaAtPath, srcFolder, moduleFilePath],
  );
  const isParentFixedRoute =
    parentRoutePattern?.every((part) => part.type === "literal") || false;
  const parentWritable =
    !parentSchemaAtPath ||
    parentSchemaAtPath.type !== "record" ||
    (parentSchemaAtPath.external === undefined &&
      parentSchemaAtPath.readonly !== true);
  const canParentDelete =
    parentWritable &&
    // not a route - just a normal record so can delete:
    (!parentRoutePattern ||
      // there are no dynamic route parts so we cannot delete
      !isParentFixedRoute);
  const canParentChange =
    parentWritable && (!parentRoutePattern || !isParentFixedRoute);
  /*
   * The copy needs a key of its own, and a fixed route has none to give: a
   * router whose pattern is all literals has exactly one URL, which is already
   * taken by the entry being duplicated. Same reason `canParentChange` and
   * `canParentDelete` are gated on it.
   */
  const canParentDuplicate = canParentChange;

  const isFixedRoute =
    routePattern?.every((part) => part.type === "literal") || false;
  /**
   * Whether this record's entries live behind an adapter.
   *
   * External records are READ-ONLY for now: reading them works end to end, and
   * writing them — publish, the two clocks, what happens when a commit lands
   * before its build — is its own piece of work. Hiding the affordance is the
   * honest version of that: an editor who cannot save must not be offered a
   * button that says they can.
   *
   * `.readonly()` is folded in here too, which the popovers did not consult at
   * all: a readonly record's add/delete buttons were live, and only the leaf
   * inputs inside an entry were guarded.
   */
  const schemaHere = "data" in schemaAtPath ? schemaAtPath.data : undefined;
  const isExternalRecord =
    schemaHere?.type === "record" && schemaHere.external !== undefined;
  const isReadonlyRecord = schemaHere?.readonly === true;
  const writable = !isExternalRecord && !isReadonlyRecord;
  const canAdd = writable && (!routePattern || !isFixedRoute); // cannot add if this is a router and this has no dynamic route parts

  // Determine if the parent is a router (for showing route references)
  const isParentRouter =
    isParentRecord(path, maybeParentPath, parentSchemaAtPath) &&
    parentSchemaAtPath &&
    parentSchemaAtPath.type === "record" &&
    parentSchemaAtPath.router;

  // Get the current route key (the last part of the path for router items)
  const currentRouteKey = isParentRouter ? last?.part : undefined;

  // Get route references eagerly for the delete check (only for router items)
  const routeRefs = useEagerRouteReferences(currentRouteKey);

  // Combine keyOf refs and route refs for delete protection. The STATUS travels
  // with them: a delete or rename must not act on the union until both scans are
  // complete, or it acts on refs it could not see (an un-loaded `.jsonValues()`
  // entry is opaque to a scan).
  const allRefs = isParentRouter ? mergeReferences(refs, routeRefs) : refs;

  const parentKeyDescription =
    parentSchemaAtPath?.type === "record"
      ? parentSchemaAtPath.key?.description
      : undefined;
  const currentKeyDescription =
    "data" in schemaAtPath && schemaAtPath.data.type === "record"
      ? schemaAtPath.data.key?.description
      : undefined;

  return (
    <span className="inline-flex gap-2 items-center">
      {isParentRecord(path, maybeParentPath, parentSchemaAtPath) && (
        <>
          <ReferencesPopover refs={allRefs.refs} variant={variant} />
          {canParentChange && (
            <ChangeRecordPopover
              defaultValue={last.text}
              path={path}
              parentPath={maybeParentPath}
              variant={getButtonVariant(variant)}
              size={getButtonSize(variant)}
              routePattern={parentRoutePattern}
              references={allRefs}
              keyDescription={parentKeyDescription}
            >
              <Edit size={getIconSize(variant)} />
            </ChangeRecordPopover>
          )}
          {canParentDuplicate && (
            <DuplicateRecordPopover
              defaultValue={last.text}
              parentPath={maybeParentPath}
              variant={getButtonVariant(variant)}
              size={getButtonSize(variant)}
              routePattern={parentRoutePattern}
              keyDescription={parentKeyDescription}
            >
              <Copy size={getIconSize(variant)} />
            </DuplicateRecordPopover>
          )}
          {canParentDelete && (
            <DeleteRecordPopover
              path={path}
              parentPath={maybeParentPath}
              variant={getButtonVariant(variant)}
              size={getButtonSize(variant)}
              references={allRefs}
              confirmationMessage={`This will delete the ${last.text} record.`}
            >
              <Trash size={getIconSize(variant)} />
            </DeleteRecordPopover>
          )}
        </>
      )}
      {isArray("data" in schemaAtPath ? schemaAtPath.data : undefined) && (
        <AddArrayButton path={path} variant={variant} />
      )}
      {isRecord("data" in schemaAtPath ? schemaAtPath.data : undefined) && (
        <>
          <ReferencesPopover refs={refs.refs} variant={variant} />
          {canAdd && (
            <AddRecordPopover
              path={path}
              variant={getButtonVariant(variant)}
              size={getButtonSize(variant)}
              routePattern={routePattern}
              keyDescription={currentKeyDescription}
            >
              <Plus size={getIconSize(variant)} />
            </AddRecordPopover>
          )}
        </>
      )}
    </span>
  );
}

function getRouterPattern(
  moduleFilePath: ModuleFilePath,
  srcFolder: string,
  router: string,
): RoutePattern[] | null {
  if (router === "next-app-router") {
    const pattern = getPatternFromModuleFilePath(moduleFilePath, srcFolder);
    return parseRoutePattern(pattern);
  }
  return null;
}

function ReferencesPopover({
  refs,
  variant,
}: {
  refs: SourcePath[];
  variant: Variant;
}) {
  const portalContainer = useValPortal();
  const { navigate, currentSourcePath } = useNavigation();
  const [open, setOpen] = React.useState(false);

  if (refs.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={getButtonVariant(variant)}
              size={getButtonSize(variant)}
              role="combobox"
              aria-expanded={open}
            >
              <Link size={getIconSize(variant)} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">References to this record</TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-[clamp(300px, 40vw, 400px)] p-0 z-[8999]"
        container={portalContainer}
      >
        <ConnectedReferencesList
          refs={refs}
          currentPath={currentSourcePath}
          onSelect={(navPath, { scrollToPath }) => {
            navigate(navPath, { scrollToPath });
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function getIconSize(variant: Variant) {
  return variant === "module" ? 16 : 12;
}

function getButtonSize(variant: Variant): "icon" | "sm" | "lg" | "default" {
  return variant === "module" ? "icon" : "icon";
}

function getButtonVariant(
  variant: Variant,
): "ghost" | "outline" | "default" | "secondary" {
  return variant === "module" ? "outline" : "ghost";
}

function AddArrayButton({
  path,
  variant,
}: {
  path: SourcePath;
  variant: Variant;
}) {
  const { navigate } = useNavigation();
  const { addPatch, patchPath } = useAddPatch(path);
  const schemaAtPath = useSchemaAtPath(path);
  const shallowSourceAtPath = useShallowSourceAtPath(path, "array");
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (!("data" in shallowSourceAtPath) || !shallowSourceAtPath.data) {
    return null;
  }
  if (!("data" in schemaAtPath)) {
    return null;
  }
  const schema = schemaAtPath.data;
  if (schema.type !== "array") {
    console.error("Cannot add to non-array", shallowSourceAtPath, {
      parentPath: path,
    });
    return null;
  }
  const highestIndex = shallowSourceAtPath.data.length;
  return (
    <Button
      title="Add"
      size={getButtonSize(variant)}
      variant={getButtonVariant(variant)}
      onClick={() => {
        const newPatchPath = patchPath.concat(highestIndex.toString());
        addPatch(
          [
            {
              op: "add",
              path: newPatchPath,
              value: emptyOf(schema.item) as JSONValue,
            },
          ],
          schema.type,
        );
        // An inline item is edited in place in the list, so adding one should
        // not navigate away from it. Everything else opens as its own page.
        if (!isInlineRender(schema.item)) {
          navigate(
            Internal.joinModuleFilePathAndModulePath(
              moduleFilePath,
              Internal.patchPathToModulePath(newPatchPath),
            ),
          );
        }
      }}
    >
      <Plus size={getIconSize(variant)} />
    </Button>
  );
}

export function splitIntoInitAndLastParts(path: SourcePath) {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  /*
   * Every segment of the module file path, and only the LAST one is a place.
   *
   * `/content/authors.val.ts` splits into `content` and `authors.val.ts`, and
   * both used to be handed the whole module file path as their `sourcePath` — so
   * a trail rendered two links to the same destination, one of them labelled with
   * a directory that is not a thing you can open. `isDirectory` says which are
   * which; the scope trail renders those as text.
   */
  const moduleFilePathSegments = Internal.splitModuleFilePath(moduleFilePath);
  const moduleFilePathParts = moduleFilePathSegments.map((part, index) => {
    return {
      text: prettifyFilename(part),
      part,
      sourcePath: moduleFilePath as unknown as SourcePath,
      isDirectory: index < moduleFilePathSegments.length - 1,
    };
  });
  if (!modulePath) {
    return moduleFilePathParts;
  }
  const splittedModulePath = Internal.splitModulePath(modulePath);
  const modulePathParts: {
    text: string;
    part: string;
    sourcePath: SourcePath;
    isDirectory: boolean;
  }[] = [];
  let lastPart = "";
  for (let i = 0; i < splittedModulePath.length; i++) {
    let modulePathPart =
      (lastPart ? lastPart + "." : "") + JSON.stringify(splittedModulePath[i]);
    if (!modulePath.startsWith(modulePathPart)) {
      // This happens if the current element is a number
      // It is a sneaky / clever (but not smart?) way to build the sourcePath without actually figuring out the schema types
      modulePathPart = (lastPart ? lastPart + "." : "") + splittedModulePath[i];
    }
    lastPart = modulePathPart;
    modulePathParts.push({
      text: splittedModulePath[i],
      part: splittedModulePath[i],
      sourcePath: Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        modulePathPart as ModulePath,
      ),
      // A path inside a module is always somewhere you can go.
      isDirectory: false,
    });
  }
  return moduleFilePathParts.concat(modulePathParts);
}
