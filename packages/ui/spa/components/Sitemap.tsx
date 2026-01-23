import { Internal, ModuleFilePath } from "@valbuild/core";
import { ChevronRight, Plus, Loader2, FileText, Folder } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Remote } from "../utils/Remote";
import {
  useNextAppRouterSrcFolder,
  useShallowModulesAtPaths,
} from "./ValProvider";
import { AnimateHeight } from "./AnimateHeight";
import { useNavigation } from "./ValRouter";
import {
  PageNode,
  SitemapNode,
  getNextAppRouterSitemapTree,
} from "@valbuild/shared/internal";
import { cn } from "./designSystem/cn";
import { parseRoutePattern } from "@valbuild/shared/internal";
import { AddRecordPopover } from "./AddRecordPopover";

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
          error: `Failed to load ${
            failedModules.length
          } modules: ${Object.entries(shallowModules.errors)
            .map(([m, e]) => `"${m}": ${e.message}`)
            .join(", ")}`,
        };
      }
      return shallowModules;
    }
    for (const shallowSource of shallowModules.data || []) {
      for (const path in shallowSource) {
        const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
          shallowSource[path]
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
      <div className="flex items-center justify-center h-full">
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
  const { currentSourcePath } = useNavigation();
  const [isOpen, setIsOpen] = useState(true);
  const { navigate } = useNavigation();
  const [addRouteOpen, setAddRouteOpen] = useState(false);
  const isCurrentRoute = useMemo(() => {
    return node.sourcePath === currentSourcePath;
  }, [currentSourcePath, node.sourcePath]);
  const sortedChildren = useMemo(() => {
    return [...node.children].sort((a, b) => a.name.localeCompare(b.name));
  }, [node.children]);
  const routePatternWithParams = useMemo(() => {
    if (!node.pattern) {
      return undefined;
    }
    const routePattern = parseRoutePattern(node.pattern);
    if (
      routePattern.some(
        (part) => part.type === "string-param" || part.type === "array-param"
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
  const [showOptions, setShowOptions] = useState(false);
  return (
    <div>
      <div
        className="relative flex items-center justify-between w-full h-10"
        onMouseEnter={() => {
          setShowOptions(true);
        }}
        onMouseLeave={() => {
          setShowOptions(false);
        }}
      >
        <div className="flex items-center my-1">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={cn("hidden h-4 w-4 mr-2", {
              block: node.children?.length > 0,
            })}
          >
            <ChevronRight
              size={16}
              className={cn("transform", {
                "rotate-90": isOpen,
              })}
            />
          </button>
          <span>
            {node.sourcePath ? (
              <button
                onClick={onClick}
                className={cn("flex items-center gap-1", {})}
              >
                {node.type === "leaf" || (node.type === "node" && node.page) ? (
                  <FileText size={14} />
                ) : null}
                <span
                  className={cn(
                    {
                      underline: isCurrentRoute,
                      "hover:underline": node.sourcePath !== undefined,
                    },
                    "truncate"
                  )}
                >
                  {"/"}
                  {node.name !== "/" && node.name}
                </span>
              </button>
            ) : (
              <button
                onClick={onClick}
                className={cn("flex items-center gap-1", {})}
              >
                <Folder size={14} />
                <span>
                  {/* <span>/</span> */}
                  <span>
                    {"/"}
                    {node.name !== "/" && node.name}
                  </span>
                </span>
              </button>
            )}
          </span>
        </div>
        <div
          className={cn(
            "absolute hidden right-4 top-0 items-center h-10 bg-bg-primary",
            {
              flex: showOptions,
            }
          )}
        >
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
        {sortedChildren.map((child, i) => (
          <SiteMapNode node={child} key={i} />
        ))}
      </AnimateHeight>
    </div>
  );
}
