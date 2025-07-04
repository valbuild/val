import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  ChevronRight,
  Ellipsis,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  Link,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Remote } from "../utils/Remote";
import {
  useNextAppRouterSrcFolder,
  useShallowModulesAtPaths,
  useValPortal,
} from "./ValProvider";
import { AnimateHeight } from "./AnimateHeight";
import { useNavigation } from "./ValRouter";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "./designSystem/popover";
import {
  PageNode,
  SitemapNode,
  getNextAppRouterSitemapTree,
} from "@valbuild/shared/internal";
import { cn } from "./designSystem/cn";
import { useKeysOf } from "./useKeysOf";
import { DeleteRecordPopover } from "./DeleteRecordPopover";
import { Button } from "./designSystem/button";
import { RoutePattern, parseRoutePattern } from "@valbuild/shared/internal";
import { AddRecordPopover } from "./AddRecordPopover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import { ChangeRecordPopover } from "./ChangeRecordPopover";

// TODO: technically this shouldn't be defined here in the ui package, but it should be in the next package.
export function NextAppRouterSitemap({
  moduleFilePaths,
}: {
  moduleFilePaths: ModuleFilePath[];
}) {
  const shallowModules = useShallowModulesAtPaths(moduleFilePaths, "record");
  const srcFolder = useNextAppRouterSrcFolder();
  const rootNode = useMemo((): Remote<SitemapNode> => {
    const paths: { urlPath: string; moduleFilePath: ModuleFilePath }[] = [];
    if (srcFolder.status !== "success") {
      return srcFolder;
    }
    if (srcFolder.data === null) {
      return {
        status: "error",
        error: "No src folder found",
      };
    }
    if (shallowModules.status !== "success") {
      if (shallowModules.status === "not-found") {
        return {
          status: "error",
          error: "No data found",
        };
      } else if (shallowModules.status === "error") {
        const failedModules = Object.keys(shallowModules.errors);
        return {
          status: "error",
          error: `Failed to load ${failedModules.length} modules: ${Object.entries(
            shallowModules.errors,
          )
            .map(([m, e]) => `"${m}": ${e.message}`)
            .join(", ")}`,
        };
      }
      return shallowModules;
    }
    for (const shallowSource of shallowModules.data || []) {
      for (const path in shallowSource) {
        const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
          shallowSource[path],
        );
        paths.push({
          urlPath: path,
          moduleFilePath,
        });
      }
    }
    const sitemapData = getNextAppRouterSitemapTree(srcFolder.data, paths);
    return {
      status: shallowModules.status,
      data: sitemapData,
    };
  }, [shallowModules, srcFolder]);
  if (rootNode.status === "loading" || rootNode.status === "not-asked") {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }
  if (rootNode.status === "error") {
    console.error("Sitemap errors", rootNode.error);
    return null;
  }
  return <SiteMapNode node={rootNode.data} />;
}

function SiteMapNode({ node }: { node: SitemapNode | PageNode }) {
  const portalContainer = useValPortal();
  const { currentSourcePath } = useNavigation();
  const [isOpen, setIsOpen] = useState(true);
  const { navigate } = useNavigation();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [addRouteOpen, setAddRouteOpen] = useState(false);
  const isCurrentRoute = useMemo(() => {
    return !!node.sourcePath?.startsWith(currentSourcePath);
  }, [currentSourcePath, node.sourcePath]);
  const routePatternWithParams = useMemo(() => {
    if (!node.pattern) {
      return undefined;
    }
    const routePattern = parseRoutePattern(node.pattern);
    if (
      routePattern.some(
        (part) => part.type === "string-param" || part.type === "array-param",
      )
    ) {
      return routePattern;
    } else {
      return undefined;
    }
  }, [node.pattern]);
  const onClick = useCallback(() => {
    if (node.sourcePath) {
      navigate(node.sourcePath);
    } else if (node.type === "node" && node.children?.length > 0) {
      setIsOpen((prev) => !prev);
    }
  }, [navigate, node]);
  const moduleFilePath = node.moduleFilePath;
  return (
    <div>
      <div className="flex relative justify-between items-center w-full h-10 group">
        <div className="flex items-center my-1">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={cn("hidden h-6 w-6", {
              "group-hover:block": node.children?.length > 0,
            })}
          >
            <ChevronRight
              size={16}
              className={cn("transform", {
                "rotate-90": isOpen,
              })}
            />
          </button>
          <div
            className={cn("block h-6 w-6", {
              "group-hover:hidden": node.children?.length > 0,
            })}
          />
          <span>
            {node.name === "/" && (
              <>
                {node.sourcePath ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={onClick}
                        className={cn({
                          underline: isCurrentRoute,
                        })}
                      >
                        Main page
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Go to main page</TooltipContent>
                  </Tooltip>
                ) : (
                  <button onClick={onClick}>
                    <span className="text-fg-brand-secondary">/</span>
                  </button>
                )}
              </>
            )}
            {node.name !== "/" && (
              <button
                onClick={onClick}
                className={cn("cursor-pointer disabled:cursor-default", {
                  underline: isCurrentRoute,
                })}
              >
                <span className={cn("pr-[2px] text-fg-quaternary")}>/</span>
                <span>{node.name}</span>
              </button>
            )}
          </span>
        </div>
        <div
          className={cn(
            "absolute right-0 top-0 items-center group-hover:flex h-10 bg-bg-primary",
            {
              hidden: !optionsOpen && !addRouteOpen,
              flex: optionsOpen || addRouteOpen,
            },
          )}
        >
          {node.sourcePath && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClick}
              className="flex gap-2 items-center"
            >
              <Link size={12} />
            </Button>
          )}
          {(node.sourcePath || node.type === "leaf" || node.page) && (
            <Popover onOpenChange={setOptionsOpen} open={optionsOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost">
                  <Ellipsis size={12} />
                </Button>
              </PopoverTrigger>
              <PopoverContent container={portalContainer}>
                <SiteMapNodeOptions
                  node={node}
                  routePatternWithParams={routePatternWithParams}
                  onClose={() => setOptionsOpen(false)}
                />
              </PopoverContent>
            </Popover>
          )}
          {routePatternWithParams && moduleFilePath && (
            <AddRecordPopover
              path={moduleFilePath}
              size="sm"
              variant="ghost"
              open={addRouteOpen}
              setOpen={setAddRouteOpen}
              routePattern={routePatternWithParams}
            >
              <Plus size={12} />
            </AddRecordPopover>
          )}
        </div>
      </div>
      <AnimateHeight isOpen={isOpen} className="pl-3">
        {node.children.map((child, i) => (
          <SiteMapNode node={child} key={i} />
        ))}
      </AnimateHeight>
    </div>
  );
}

function SiteMapNodeOptions({
  node,
  onClose,
  routePatternWithParams,
}: {
  node: SitemapNode | PageNode;
  onClose: () => void;
  routePatternWithParams?: RoutePattern[] | null;
}) {
  const currentKey = useMemo(() => {
    return node.type === "leaf" ? node.fullPath : node.page?.fullPath;
  }, [node]);
  const parentPath = useMemo(
    () =>
      node.sourcePath
        ? Internal.splitModuleFilePathAndModulePath(node.sourcePath)[0]
        : undefined,
    [node?.sourcePath],
  );
  const refs = useKeysOf(parentPath, currentKey);
  return (
    <div className="flex flex-col gap-2 justify-center items-start">
      {parentPath && node.sourcePath && (
        <DeleteRecordPopover
          path={node.sourcePath as SourcePath}
          parentPath={parentPath}
          refs={refs}
          size="sm"
          variant="ghost"
          onComplete={onClose}
          confirmationMessage={`This will delete the ${currentKey} page.`}
        >
          <div className="flex gap-2 items-center">
            <Trash2 size={14} />
            <span>Delete</span>
          </div>
        </DeleteRecordPopover>
      )}
      {currentKey !== undefined && node.sourcePath && parentPath && (
        <ChangeRecordPopover
          variant="ghost"
          size="sm"
          existingKeys={refs}
          path={node.sourcePath as SourcePath}
          defaultValue={currentKey}
          routePattern={routePatternWithParams}
          parentPath={parentPath}
          onComplete={onClose}
        >
          <div className="flex gap-2 items-center">
            <Edit2 size={12} />
            <span>Rename</span>
          </div>
        </ChangeRecordPopover>
      )}
    </div>
  );
}
