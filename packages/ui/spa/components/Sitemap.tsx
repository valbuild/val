import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  ChevronRight,
  Ellipsis,
  Plus,
  Edit2,
  Trash2,
  Globe,
  Loader2,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import { RenameRecordKeyForm } from "./RenameRecordKeyForm";
import { useKeysOf } from "./useKeysOf";
import { DeleteRecordButton } from "./DeleteRecordButton";
import { Button } from "./designSystem/button";
import { parseRoutePattern } from "../utils/parseRoutePattern";
import { AddRecordPopover } from "./AddRecordPopover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";

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
  const [isOpen, setIsOpen] = useState(true);
  const { navigate } = useNavigation();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [addRouteOpen, setAddRouteOpen] = useState(false);
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
  const moduleFilePath = useMemo(
    () =>
      node.sourcePath &&
      Internal.splitModuleFilePathAndModulePath(node.sourcePath)[0],
    [node.sourcePath],
  );
  return (
    <div>
      <div className="flex justify-between items-center w-full group">
        <div className="flex items-center my-1">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={cn("hidden", {
              "group-hover:block": node.children?.length > 0,
            })}
          >
            <ChevronRight
              size={16}
              className={cn("", "transform", {
                "rotate-90": isOpen,
              })}
            />
          </button>
          <div
            className={cn("block w-4 h-4", {
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
                        onClick={() => {
                          if (node.sourcePath) {
                            navigate(node.sourcePath);
                          }
                        }}
                      >
                        <Globe size={16} className="hover:stroke-2" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Go to main page</TooltipContent>
                  </Tooltip>
                ) : (
                  <button
                    onClick={() => {
                      if (node.sourcePath) {
                        navigate(node.sourcePath);
                      }
                    }}
                  >
                    <span className="text-fg-brand-secondary">
                      <Globe size={16} />
                    </span>
                  </button>
                )}
              </>
            )}
            {node.name !== "/" && (
              <>
                <span className={cn("pr-[2px] text-fg-quaternary")}>/</span>
                <span>{node.name}</span>
              </>
            )}
          </span>
        </div>
        <div
          className={cn("items-center group-hover:flex h-6", {
            hidden: !optionsOpen && !addRouteOpen,
            flex: optionsOpen || addRouteOpen,
          })}
        >
          <Popover onOpenChange={setOptionsOpen} open={optionsOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost">
                <Ellipsis size={12} />
              </Button>
            </PopoverTrigger>
            <PopoverContent container={portalContainer}>
              <SiteMapNodeOptions
                node={node}
                onClose={() => setOptionsOpen(false)}
              />
            </PopoverContent>
          </Popover>
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
}: {
  node: SitemapNode | PageNode;
  onClose: () => void;
}) {
  const { navigate } = useNavigation();
  const [optionsState, setOptionsState] = useState<"rename" | "delete" | null>(
    null,
  );
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
    <div>
      {optionsState === null && (
        <>
          {currentKey !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              className="flex gap-2 items-center"
              onClick={() => {
                setOptionsState("rename");
              }}
            >
              <Edit2 size={12} />
              <span>Rename</span>
            </Button>
          )}
          {parentPath && node.sourcePath && (
            <DeleteRecordButton
              path={node.sourcePath as SourcePath}
              parentPath={parentPath}
              refs={refs}
              size="sm"
              variant="ghost"
            >
              <div className="flex gap-2 items-center">
                <Trash2 size={12} />
                <span>Delete</span>
              </div>
            </DeleteRecordButton>
          )}
        </>
      )}
      {optionsState === "rename" &&
        currentKey !== undefined &&
        node.sourcePath &&
        parentPath && (
          <RenameRecordKeyForm
            parentPath={parentPath}
            path={node.sourcePath}
            defaultValue={currentKey}
            refs={refs}
            onSubmit={(sourcePath) => {
              setOptionsState(null);
              onClose();
              navigate(sourcePath);
            }}
            onCancel={() => {
              setOptionsState(null);
              onClose();
            }}
          />
        )}
    </div>
  );
}
