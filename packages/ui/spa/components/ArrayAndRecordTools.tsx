import {
  SourcePath,
  Internal,
  ModulePath,
  ModuleFilePath,
} from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { Plus, Trash, Edit, Workflow } from "lucide-react";
import { useState, useEffect } from "react";
import { emptyOf } from "./fields/emptyOf";
import { Button } from "./designSystem/button";
import { prettifyFilename } from "../utils/prettifyFilename";
import {
  useAddPatch,
  useNextAppRouterSrcFolder,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useValPortal,
} from "./ValProvider";
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
import { RenameRecordKeyForm } from "./RenameRecordKeyForm";
import { useKeysOf } from "./useKeysOf";
import { DeleteRecordButton } from "./DeleteRecordButton";
import { AddRecordPopover } from "./AddRecordPopover";
import { RoutePattern, parseRoutePattern } from "../utils/parseRoutePattern";
import { getPatternFromModuleFilePath } from "@valbuild/shared/internal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";

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
  return (
    <span className="inline-flex gap-2 items-center">
      {isParentRecord(path, maybeParentPath, parentSchemaAtPath) && (
        <>
          <ReferencesPopover refs={refs} variant={variant} />
          <ChangeRecordPopover
            defaultValue={last.text}
            path={path}
            parentPath={maybeParentPath}
            variant={variant}
            refs={refs}
          />
          <DeleteRecordButton
            path={path}
            parentPath={maybeParentPath}
            variant={getButtonVariant(variant)}
            size={getButtonSize(variant)}
            refs={refs}
          >
            <Trash size={getIconSize(variant)} />
          </DeleteRecordButton>
        </>
      )}
      {isArray("data" in schemaAtPath ? schemaAtPath.data : undefined) && (
        <AddArrayButton path={path} variant={variant} />
      )}
      {isRecord("data" in schemaAtPath ? schemaAtPath.data : undefined) && (
        <>
          <ReferencesPopover refs={refs} variant={variant} />
          <AddRecordPopover
            path={path}
            variant={getButtonVariant(variant)}
            size={getButtonSize(variant)}
            routePattern={routePattern}
          >
            <Plus size={getIconSize(variant)} />
          </AddRecordPopover>
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
  if (refs.length === 0) {
    return null;
  }
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger>
          <Button
            asChild
            size={getButtonSize(variant)}
            variant={getButtonVariant(variant)}
          >
            <PopoverTrigger>
              <Workflow size={getIconSize(variant)} />
            </PopoverTrigger>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">References to this record</TooltipContent>
      </Tooltip>
      <PopoverContent container={portalContainer}>
        <div className="text-sm">
          <ul>
            {refs.map((ref) => {
              const [moduleFilePath, modulePath] =
                Internal.splitModuleFilePathAndModulePath(ref);
              const patchPath = Internal.createPatchPath(modulePath);
              return (
                <li key={ref}>
                  <ValPath
                    moduleFilePath={moduleFilePath}
                    patchPath={patchPath}
                  />
                </li>
              );
            })}
          </ul>
        </div>
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

function ChangeRecordPopover({
  defaultValue,
  path,
  parentPath,
  variant,
  refs,
}: {
  defaultValue: string;
  path: SourcePath;
  parentPath: SourcePath;
  variant: Variant;
  refs: SourcePath[];
}) {
  const { navigate } = useNavigation();
  const [open, setOpen] = useState(false);
  const portalContainer = useValPortal();
  useEffect(() => {
    const keyDownListener = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", keyDownListener);
    return () => {
      window.removeEventListener("keydown", keyDownListener);
    };
  }, []);
  return (
    <Popover open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            size={getButtonSize(variant)}
            variant={getButtonVariant(variant)}
          >
            <PopoverTrigger
              onClick={() => {
                setOpen(true);
              }}
            >
              <Edit size={16} />
            </PopoverTrigger>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Rename</TooltipContent>
      </Tooltip>
      <PopoverContent container={portalContainer} className="text-fg-primary">
        <RenameRecordKeyForm
          parentPath={parentPath}
          path={path}
          defaultValue={defaultValue}
          refs={refs}
          onSubmit={(sourcePath) => {
            navigate(sourcePath, {
              replace: true,
            });
          }}
          onCancel={() => {
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
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
