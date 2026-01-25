import {
  SourcePath,
  Internal,
  ModulePath,
  ModuleFilePath,
} from "@valbuild/core";
import * as React from "react";
import { JSONValue } from "@valbuild/core/patch";
import { Plus, Trash, Edit, Link, Check } from "lucide-react";
import { emptyOf } from "./fields/emptyOf";
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
import { ValPath } from "./ValPath";
import { useKeysOf } from "./useKeysOf";
import { useEagerRouteReferences } from "./useRouteReferences";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./designSystem/command";
import { cn } from "./designSystem/cn";

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
  const routePattern =
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
      : null;
  const parentRoutePattern =
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
      : null;
  const isParentFixedRoute =
    parentRoutePattern?.every((part) => part.type === "literal") || false;
  const canParentDelete =
    // not a route - just a normal record so can delete:
    !parentRoutePattern ||
    // there are no dynamic route parts so we cannot delete
    !isParentFixedRoute;
  const canParentChange = !parentRoutePattern || !isParentFixedRoute;

  const isFixedRoute =
    routePattern?.every((part) => part.type === "literal") || false;
  const canAdd = !routePattern || !isFixedRoute; // cannot add if this is a router and this has no dynamic route parts

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

  // Combine keyOf refs and route refs for delete protection
  const allRefs = isParentRouter
    ? [...refs, ...routeRefs.filter((ref) => !refs.includes(ref))]
    : refs;

  return (
    <span className="inline-flex gap-2 items-center">
      {isParentRecord(path, maybeParentPath, parentSchemaAtPath) && (
        <>
          <ReferencesPopover refs={allRefs} variant={variant} />
          {canParentChange && (
            <ChangeRecordPopover
              defaultValue={last.text}
              path={path}
              parentPath={maybeParentPath}
              variant={getButtonVariant(variant)}
              size={getButtonSize(variant)}
              routePattern={parentRoutePattern}
              existingKeys={allRefs}
            >
              <Edit size={getIconSize(variant)} />
            </ChangeRecordPopover>
          )}
          {canParentDelete && (
            <DeleteRecordPopover
              path={path}
              parentPath={maybeParentPath}
              variant={getButtonVariant(variant)}
              size={getButtonSize(variant)}
              refs={allRefs}
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
          <ReferencesPopover refs={refs} variant={variant} />
          {canAdd && (
            <AddRecordPopover
              path={path}
              variant={getButtonVariant(variant)}
              size={getButtonSize(variant)}
              routePattern={routePattern}
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

  // Create display labels for each reference
  const refItems = refs.map((ref) => {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(ref);
    const patchPath = Internal.createPatchPath(modulePath);
    return {
      path: ref,
      moduleFilePath,
      patchPath,
      label: `${prettifyFilename(
        Internal.splitModuleFilePath(moduleFilePath).pop() || "",
      )}${
        modulePath
          ? ` → ${Internal.splitModulePath(modulePath).join(" → ")}`
          : ""
      }`,
    };
  });

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
        <Command>
          <CommandInput placeholder="Filter" />
          <CommandList>
            {refItems.length === 0 ? (
              <CommandEmpty>No references found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {refItems.map((item) => {
                  const isCurrent = currentSourcePath === item.path;
                  return (
                    <CommandItem
                      key={item.path}
                      value={item.label}
                      onSelect={() => {
                        navigate(item.path);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          isCurrent ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <ValPath
                        moduleFilePath={item.moduleFilePath}
                        patchPath={item.patchPath}
                      />
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
        if (schema.item.type !== "string") {
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
  const moduleFilePathParts = Internal.splitModuleFilePath(moduleFilePath).map(
    (part) => {
      return {
        text: prettifyFilename(part),
        part,
        sourcePath: moduleFilePath as unknown as SourcePath,
      };
    },
  );
  if (!modulePath) {
    return moduleFilePathParts;
  }
  const splittedModulePath = Internal.splitModulePath(modulePath);
  const modulePathParts: {
    text: string;
    part: string;
    sourcePath: SourcePath;
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
    });
  }
  return moduleFilePathParts.concat(modulePathParts);
}
