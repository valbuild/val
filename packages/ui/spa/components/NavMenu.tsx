import { DEFAULT_APP_HOST, SourcePath } from "@valbuild/core";
import classNames from "classnames";
import {
  Tally2,
  ChevronRight,
  File,
  PanelRightOpen,
  Ellipsis,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PathNode, pathTree } from "../utils/pathTree";
import { Remote } from "../utils/Remote";
import {
  useAllValidationErrors,
  useSchemas,
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
import { Switch } from "./designSystem/switch";
import { useLayout } from "./Layout";

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
  }, [config]);
  const remoteSchemasByModuleFilePath = useSchemas();
  const portalContainer = useValPortal();
  const { theme, setTheme } = useTheme();
  const { navMenu } = useLayout();
  const appHostUrl = config?.appHost || DEFAULT_APP_HOST;
  const [orgName, projectName] = name.split("/");

  return (
    <nav className="relative min-h-[100svh] bg-bg-primary">
      <div className="flex items-center justify-between h-16 gap-4 p-4 pr-6 border-b border-border-primary">
        <div className="flex items-center gap-4">
          {mainImageUrl ? (
            <img src={mainImageUrl} alt={""} className="w-4 h-4" />
          ) : (
            <div className="w-4 h-4" />
          )}
          {orgName && projectName ? (
            <a
              className="truncate"
              href={`${appHostUrl}/orgs/${orgName}/projects/${projectName}`}
            >
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
            <div className="max-h-[calc(100svh-32px-64px-32px-16px)]">
              <NavContentExplorer />
            </div>
          </ScrollArea>
        </div>
      )}
      <div className="h-6 p-4" />
      <div className="absolute bottom-0 left-0 flex items-center justify-between w-full p-4 pr-6 border-t border-border-primary">
        <span></span>
        <Popover>
          <PopoverTrigger>
            <Ellipsis size={16} />
          </PopoverTrigger>
          <PopoverContent container={portalContainer}>
            <div className="flex items-center justify-between">
              <span>Dark mode</span>
              <Switch
                checked={theme !== "light"}
                onClick={(ev) => {
                  ev.stopPropagation();
                }}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setTheme("dark");
                  } else {
                    setTheme("light");
                  }
                }}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}

function useSchemasTree(): Remote<PathNode> {
  const remoteSchemasByModuleFilePath = useSchemas();
  return useMemo(() => {
    if (remoteSchemasByModuleFilePath.status === "success") {
      const filePaths = Object.keys(remoteSchemasByModuleFilePath.data);
      return {
        status: remoteSchemasByModuleFilePath.status,
        data: pathTree(filePaths),
      };
    }
    return remoteSchemasByModuleFilePath;
  }, [remoteSchemasByModuleFilePath]);
}

function NavContentExplorer({ title }: { title?: string }) {
  const remoteSchemaTree = useSchemasTree();
  if (remoteSchemaTree.status === "error") {
    console.error(remoteSchemaTree.error);
    return null;
  }
  if (remoteSchemaTree.status !== "success") {
    return <Loading />;
  }
  const root = remoteSchemaTree.data;
  return (
    <div className="pl-0 pr-4">
      {title && <div className="py-2">{title}</div>}
      <div>
        {root.children.sort(sortPathTree).map((child, i) => (
          <ExplorerNode {...child} name={child.name} key={i} />
        ))}
      </div>
    </div>
  );
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
  return (
    <div className="w-full text-sm">
      <button
        className={classNames("relative flex justify-between w-full p-2", {
          underline: currentSourcePath.startsWith(fullPath as SourcePath),
        })}
        onClick={() => {
          if (isDirectory) {
            setIsOpen(!isOpen);
          } else {
            if (window.innerWidth < NAV_MENU_MOBILE_BREAKPOINT) {
              navMenu.setOpen(false);
            }
            navigate(fullPath as SourcePath);
          }
        }}
      >
        <div className="flex items-center pr-2">
          {isDirectory ? <Tally2 /> : <File className="pr-2" />}
          <span>{prettifyFilename(name)}</span>
          {showErrorIndicator && (
            <div className="w-2 h-2 ml-2 rounded-full bg-bg-error-primary"></div>
          )}
        </div>
        <ChevronRight
          size={16}
          className={classNames("transform", {
            "rotate-90": isOpen,
            hidden: !children.length,
          })}
        />
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
