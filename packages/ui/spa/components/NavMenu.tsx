import { SourcePath } from "@valbuild/core";
import classNames from "classnames";
import { Tally2, ChevronRight, File } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PathNode, pathTree } from "../utils/pathTree";
import { Remote } from "../utils/Remote";
import { useSchemas, useValConfig } from "./ValProvider";
import { AnimateHeight } from "./AnimateHeight";
import { prettifyFilename } from "../utils/prettifyFilename";
import { useNavigation } from "./ValRouter";
import { ScrollArea } from "./designSystem/scroll-area";
import { fixCapitalization } from "../utils/fixCapitalization";

export function NavMenu({
  isOpen,
  setOpen,
}: {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}) {
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

  return (
    <nav className="flex flex-col gap-1 pl-4">
      <div className="flex items-center h-16 gap-4 p-4 mt-4 bg-bg-tertiary rounded-3xl">
        {mainImageUrl ? (
          <img src={mainImageUrl} alt={""} className="w-4 h-4" />
        ) : (
          <div className="w-4 h-4" />
        )}
        <span>{name}</span>
        <button
          className="block xl:hidden"
          onClick={() => {
            setOpen(!isOpen);
          }}
        >
          <ChevronRight
            className={classNames("transform", {
              "rotate-90": isOpen,
            })}
          />
        </button>
      </div>
      {"data" in remoteSchemasByModuleFilePath && (
        <div
          className={classNames("py-4 bg-bg-tertiary rounded-3xl", {
            "hidden xl:block": !isOpen,
            block: isOpen,
          })}
        >
          <ScrollArea>
            <div className="max-h-[calc(100svh-32px-64px-32px-16px)]">
              <NavContentExplorer />
            </div>
          </ScrollArea>
        </div>
      )}
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
    <div className="p-4">
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

  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="w-full">
      <button
        className={classNames("flex justify-between w-full p-2", {
          underline: currentSourcePath.startsWith(fullPath as SourcePath),
        })}
        onClick={() => {
          if (isDirectory) {
            setIsOpen(!isOpen);
          } else {
            navigate(fullPath as SourcePath);
          }
        }}
      >
        <div className="flex items-center pr-2">
          {isDirectory ? <Tally2 /> : <File className="pr-2" />}
          <span>{prettifyFilename(name)}</span>
        </div>
        <ChevronRight
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
