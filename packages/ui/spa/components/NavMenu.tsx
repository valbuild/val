import {
  DEFAULT_APP_HOST,
  Internal,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import classNames from "classnames";
import {
  ChevronRight,
  PanelRightOpen,
  Ellipsis,
  Loader2,
  Type,
  Calendar,
  Code,
  FileIcon,
  FileText,
  Hash,
  ImageIcon,
  Key,
  List,
  Split,
  Table,
  ToggleRight,
  HelpCircle,
  Layers,
  Moon,
  Sun,
  LogOut,
  User,
  Home,
  Globe,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PathNode, pathTree } from "../utils/pathTree";
import { Remote } from "../utils/Remote";
import {
  useAllValidationErrors,
  useCurrentProfile,
  useSchemaAtPath,
  useSchemas,
  useShallowModulesAtPaths,
  useTheme,
  useValConfig,
  useValPortal,
} from "./ValProvider";
import { AnimateHeight } from "./AnimateHeight";
import { prettifyFilename } from "../utils/prettifyFilename";
import { useNavigation } from "./ValRouter";
import { ScrollArea } from "./designSystem/scroll-area";
import { fixCapitalization } from "../utils/fixCapitalization";
import { Popover, PopoverContent } from "./designSystem/popover";
import { PopoverTrigger } from "@radix-ui/react-popover";
import { useLayout } from "./Layout";
import { ProfileImage } from "./ProfileImage";
import {
  PageNode,
  SitemapNode,
  getNextAppRouterSitemapTree,
  urlOf,
} from "@valbuild/shared/internal";
import { cn } from "./designSystem/cn";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "./designSystem/hover-card";

export const NAV_MENU_MOBILE_BREAKPOINT = 1280; // nav menu behaves a bit differently (closes it self) below this breakpoint.

export function NavMenu() {
  const config = useValConfig();
  const [mainImageUrl, setMainImageUrl] = useState<string>("");
  const [name, setName] = useState<string>("");
  useEffect(() => {
    async function loadImage() {
      let found = false;
      const tryUrl = async (url: string) => {
        if (found) {
          return;
        }
        try {
          const response = await fetch(url);
          if (response.ok) {
            found = true;
            setMainImageUrl(url);
          }
        } catch {
          //
        }
      };
      await tryUrl("/favicon.ico");
      await tryUrl("/favicon.svg");
      await tryUrl("/favicon.png");
      await tryUrl("/apple-touch-icon.png");
      await tryUrl("https://valbuild.com/favicon.ico");
    }
    loadImage();
    if (config?.project) {
      setName(config.project);
    } else {
      try {
        let hostname = new URL(location.origin).hostname;
        if (hostname !== "localhost") {
          const parts = hostname.split(".");
          if (parts.length >= 2) {
            hostname = parts.slice(1, -1).join(".");
          }
          setName(fixCapitalization(hostname));
        } else {
          setName("Dev mode");
        }
      } catch {
        setName("Studio");
      }
    }
  }, [JSON.stringify(config)]);
  const remoteSchemasByModuleFilePath = useSchemas();
  const portalContainer = useValPortal();
  const { theme, setTheme } = useTheme();
  const { navMenu } = useLayout();
  const remoteSchemaTree = useTrees();
  const appHostUrl = config?.appHost || DEFAULT_APP_HOST;
  const [orgName, projectName] = name.split("/");
  const profile = useCurrentProfile();
  const orgUrl = `${appHostUrl}/orgs/${orgName}`;
  const membersUrl = `${appHostUrl}/orgs/${orgName}/members`;
  const projectUrl = `${orgUrl}/projects/${projectName}`;

  return (
    <nav className="relative min-h-[100svh] bg-bg-primary">
      <div className="flex gap-4 justify-between items-center p-4 pr-6 h-16 border-b border-border-primary">
        <div className="flex gap-4 items-center">
          {mainImageUrl ? (
            <img src={mainImageUrl} alt={""} className="w-4 h-4" />
          ) : (
            <div className="w-4 h-4" />
          )}
          {orgName && projectName ? (
            <a className="truncate hover:underline" href={projectUrl}>
              {name}
            </a>
          ) : (
            <span className="truncate">{name}</span>
          )}
        </div>
        <button
          className="lg:hidden"
          onClick={() => {
            navMenu.setOpen(!navMenu.isOpen);
          }}
        >
          <PanelRightOpen
            size={16}
            className={classNames("transform", {
              "rotate-180": !navMenu.isOpen,
            })}
          />
        </button>
      </div>
      {"data" in remoteSchemasByModuleFilePath && (
        <div className={classNames("py-4 pl-2", {})}>
          <ScrollArea>
            <div className="max-h-[calc(100svh-32px-64px-32px-16px)] px-2">
              {"data" in remoteSchemaTree ? (
                <>
                  <SiteMapExplorer
                    title="Site map"
                    defaultOpen={true}
                    sitemap={remoteSchemaTree.data.sitemap}
                  />
                  <NavContentExplorer
                    title="Explorer"
                    defaultOpen={false}
                    node={remoteSchemaTree.data.root}
                  />
                </>
              ) : remoteSchemaTree.status === "loading" ? (
                <Loading />
              ) : null}
            </div>
          </ScrollArea>
        </div>
      )}
      <div className="p-4 h-6" />
      <div className="absolute bottom-0 left-0 w-full">
        <Popover>
          <PopoverTrigger className="flex items-center justify-between w-full p-4 border-t border-border-primary hover:bg-bg-secondary data-[state=open]:bg-bg-secondary">
            <span>
              {profile && <ProfileImage size="sm" profile={profile} />}
            </span>
            <Ellipsis size={16} />
          </PopoverTrigger>
          <PopoverContent
            className="p-0 py-2"
            container={portalContainer}
            side="top"
          >
            <div className="flex flex-col gap-2 justify-between items-center">
              {profile && (
                <>
                  <div className="flex gap-2 items-center px-4 py-2 w-full">
                    <ProfileImage size="sm" profile={profile} />
                    <div className="text-sm">
                      <div className="truncate">{profile.fullName}</div>
                      {profile.email && (
                        <div className="font-light truncate">
                          {profile.email}
                        </div>
                      )}
                    </div>
                  </div>
                  <hr className="mb-1 w-full h-1 border-t border-border-primary" />
                </>
              )}
              <div className="flex gap-2 items-center px-4 w-full">
                {theme === "dark" ? (
                  <Moon size={"1rem"} />
                ) : (
                  <Sun size={"1rem"} />
                )}
                <button
                  className=""
                  onClick={() => {
                    setTheme(theme === "dark" ? "light" : "dark");
                  }}
                >
                  {theme === "dark" ? (
                    <span className="text-sm">Dark mode</span>
                  ) : (
                    <span className="text-sm">Light mode</span>
                  )}
                </button>
              </div>
              {profile && (
                <div className="flex gap-2 items-center px-4 w-full">
                  <User size={"1rem"} />
                  <a href={membersUrl}>
                    <span className="text-sm truncate">Manage members</span>
                  </a>
                </div>
              )}
              {profile && (
                <>
                  <hr className="mt-1 mb-1 w-full h-1 border-t border-border-primary" />
                  <div className="flex gap-2 items-center px-4 w-full">
                    <LogOut size={"1rem"} />
                    <a
                      href={urlOf("/api/val/logout", {
                        redirect_to: `${window.location.origin}`,
                      })}
                    >
                      <span className="text-sm">Log out</span>
                    </a>
                  </div>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}

function useTrees(): Remote<{
  root: PathNode;
  sitemap: { [routerId: string]: ModuleFilePath[] };
}> {
  const remoteSchemasByModuleFilePath = useSchemas();
  return useMemo(() => {
    if (remoteSchemasByModuleFilePath.status === "success") {
      const moduleFilePaths: ModuleFilePath[] = [];
      const routerPaths: { [routerId: string]: ModuleFilePath[] } = {};
      for (const filePathS in remoteSchemasByModuleFilePath.data) {
        const filePath = filePathS as ModuleFilePath;
        const schema = remoteSchemasByModuleFilePath.data[filePath];
        if (schema.type === "record" && schema.router) {
          routerPaths[schema.router] = routerPaths[schema.router] || [];
          routerPaths[schema.router].push(filePath);
        } else {
          moduleFilePaths.push(filePath);
        }
      }

      return {
        status: remoteSchemasByModuleFilePath.status,
        data: {
          root: pathTree(moduleFilePaths),
          sitemap: routerPaths,
        },
      };
    }
    return remoteSchemasByModuleFilePath;
  }, [remoteSchemasByModuleFilePath]);
}

function NavContentExplorer({
  title,
  defaultOpen,
  node: root,
}: {
  title?: string;
  defaultOpen?: boolean;
  node: PathNode;
}) {
  return (
    <NavSection title={title} defaultOpen={defaultOpen}>
      {root.children.sort(sortPathTree).map((child, i) => (
        <ExplorerNode {...child} name={child.name} key={i} />
      ))}
    </NavSection>
  );
}

function NavSection({
  title,
  children,
  defaultOpen,
}: {
  title?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? true);
  return (
    <div className="pr-4 pl-0">
      {title && (
        <button
          className="flex justify-between items-center py-2 w-full text-sm tracking-tighter uppercase text-fg-secondary"
          onClick={() => {
            setIsOpen(!isOpen);
          }}
        >
          {title}
          <ChevronRight
            size={16}
            className={classNames("transform", {
              "rotate-90": isOpen,
            })}
          />
        </button>
      )}
      <AnimateHeight isOpen={isOpen} className="pr-4 pl-0">
        {children}
      </AnimateHeight>
    </div>
  );
}

function SiteMapExplorer({
  title,
  defaultOpen,
  sitemap,
}: {
  title?: string;
  defaultOpen?: boolean;
  sitemap: { [routerId: string]: ModuleFilePath[] };
}) {
  const nextAppRouterSitemap = sitemap["next-app-router"];
  if (nextAppRouterSitemap) {
    return (
      <NavSection title={title} defaultOpen={defaultOpen}>
        <NextAppRouterSitemap moduleFilePaths={nextAppRouterSitemap} />
      </NavSection>
    );
  }
  return null;
}

// TODO: technically this shouldn't be defined here in the ui package, but it should be in the next package.
function NextAppRouterSitemap({
  moduleFilePaths,
}: {
  moduleFilePaths: ModuleFilePath[];
}) {
  const { navigate } = useNavigation();
  const shallowModules = useShallowModulesAtPaths(moduleFilePaths, "record");
  const rootNode = useMemo((): Remote<SitemapNode> => {
    const paths: { urlPath: string; moduleFilePath: ModuleFilePath }[] = [];
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
    let srcFolder = undefined;
    for (const shallowSource of shallowModules.data || []) {
      for (const path in shallowSource) {
        const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
          shallowSource[path],
        );
        if (moduleFilePath.startsWith("/app")) {
          srcFolder = "/app";
        } else if (moduleFilePath.startsWith("/src/app")) {
          srcFolder = "/src/app";
        } else {
          console.warn(
            `Unknown src folder for module file path: ${moduleFilePath}`,
          );
        }
        paths.push({
          urlPath: path,
          moduleFilePath,
        });
      }
    }
    if (!srcFolder) {
      console.warn("No src folder found");
      return {
        status: "error",
        error: "No src folder found",
      };
    }
    const sitemapData = getNextAppRouterSitemapTree(srcFolder, paths);
    return {
      status: shallowModules.status,
      data: sitemapData,
    };
  }, [shallowModules]);
  if (rootNode.status === "loading" || rootNode.status === "not-asked") {
    return <Loading />;
  }
  if (rootNode.status === "error") {
    console.error("Sitemap errors", rootNode.error);
    return null;
  }
  return (
    <div>
      <SiteMapNode node={rootNode.data} />
    </div>
  );
}

function SiteMapNode({ node }: { node: SitemapNode | PageNode }) {
  const [isOpen, setIsOpen] = useState(true);
  const { navigate } = useNavigation();
  if (node.type === "leaf") {
    return (
      <button
        className="p-2 w-full text-left"
        onClick={() => {
          navigate(node.sourcePath);
        }}
      >
        <span className="pr-1 text-fg-tertiary">/</span>
        <span>{node.name}</span>
      </button>
    );
  }
  if (node.type === "node") {
    return (
      <div>
        <div className="flex items-center">
          <button onClick={() => setIsOpen(!isOpen)} className="py-2 pr-1">
            <ChevronRight
              size={16}
              className={cn("", "transform", {
                "rotate-90": isOpen,
                hidden: !node.children?.length,
              })}
            />
          </button>
          <button
            onClick={() => {
              if (node.sourcePath) {
                navigate(node.sourcePath);
              }
            }}
          >
            {node.name === "/" && (
              <HoverCard>
                <HoverCardTrigger>
                  <span className="text-fg-brand-sencondary">/</span>
                </HoverCardTrigger>
                <HoverCardContent>Main page</HoverCardContent>
              </HoverCard>
            )}
            {node.name !== "/" && (
              <>
                <span
                  className={cn("pr-[2px]", {
                    "text-fg-brand-sencondary": !!node.sourcePath,
                  })}
                >
                  /
                </span>
                <span>{node.name}</span>
              </>
            )}
          </button>
        </div>
        <AnimateHeight isOpen={isOpen} className="pl-2">
          {node.children.map((child, i) => (
            <SiteMapNode node={child} key={i} />
          ))}
        </AnimateHeight>
      </div>
    );
  }
}

function Loading() {
  return null;
}

function sortPathTree(a: PathNode, b: PathNode) {
  if (a.isDirectory && !b.isDirectory) {
    return -1;
  }
  if (!a.isDirectory && b.isDirectory) {
    return 1;
  }
  return a.name.localeCompare(b.name);
}

function ExplorerNode({ name, fullPath, isDirectory, children }: PathNode) {
  const { navigate, currentSourcePath } = useNavigation();
  const { navMenu } = useLayout();
  const [isOpen, setIsOpen] = useState(true);
  const validationErrors = useAllValidationErrors() || {};
  const nodeErrors = useMemo(() => {
    let hasErrors = false;
    for (const errorPath in validationErrors) {
      if (errorPath.startsWith(fullPath)) {
        hasErrors = true;
        break;
      }
    }
    return hasErrors;
  }, [validationErrors, fullPath]);
  const showErrorIndicator = useMemo(() => {
    if (isDirectory) {
      if (!isOpen) {
        return nodeErrors;
      }
    } else if (!isDirectory) {
      return nodeErrors;
    }
    return false;
  }, [nodeErrors, isOpen, isDirectory]);
  const path = fullPath as SourcePath;
  const schema = useSchemaAtPath(path);
  const schemaType = "data" in schema ? schema.data.type : "loading";
  return (
    <div className="w-full text-sm">
      <button
        className={classNames(
          "relative flex items-center justify-between w-full p-2",
          {
            underline: currentSourcePath.startsWith(path) && !isDirectory,
            "font-bold": currentSourcePath.startsWith(path) && isDirectory,
          },
        )}
        onClick={() => {
          if (isDirectory) {
            setIsOpen(!isOpen);
          } else {
            if (window.innerWidth < NAV_MENU_MOBILE_BREAKPOINT) {
              navMenu.setOpen(false);
            }
            navigate(path);
          }
        }}
      >
        <div className="flex items-center pr-2">
          {isDirectory ? (
            <ChevronRight
              size={16}
              className={classNames("transform mr-2", {
                "rotate-90": isOpen,
                hidden: !children.length,
              })}
            />
          ) : (
            <NodeIcon type={schemaType} size={14} />
          )}
          <span>{prettifyFilename(name)}</span>
        </div>
        {showErrorIndicator && (
          <div className="ml-2 w-2 h-2 rounded-full bg-bg-error-secondary"></div>
        )}
      </button>
      <div className="pl-2">
        <AnimateHeight isOpen={isOpen}>
          {children.sort(sortPathTree).map((child, i) => (
            <ExplorerNode {...child} key={i} />
          ))}
        </AnimateHeight>
      </div>
    </div>
  );
}

function NodeIcon({
  size,
  type,
}: {
  size?: number;
  type: SerializedSchema["type"] | "loading";
}) {
  if (type === "loading") {
    return <Loader2 size={size} className="mr-2 animate-spin" />;
  }

  switch (type) {
    case "string":
      return <Type size={size} className="mr-2" />;
    case "number":
      return <Hash size={size} className="mr-2" />;
    case "boolean":
      return <ToggleRight size={size} className="mr-2" />;
    case "object":
      return <Layers size={size} className="mr-2" />;
    case "literal":
      return <Code size={size} className="mr-2" />;
    case "array":
      return <List size={size} className="mr-2" />;
    case "union":
      return <Split size={size} className="mr-2" />;
    case "richtext":
      return <FileText size={size} className="mr-2" />;
    case "record":
      return <Table size={size} className="mr-2" />;
    case "keyOf":
      return <Key size={size} className="mr-2" />;
    case "file":
      return <FileIcon size={size} className="mr-2" />;
    case "date":
      return <Calendar size={size} className="mr-2" />;
    case "image":
      return <ImageIcon size={size} className="mr-2" />;
    default:
      return <HelpCircle size={size} className="mr-2" />;
  }
}
