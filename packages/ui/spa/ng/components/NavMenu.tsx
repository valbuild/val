import { SourcePath } from "@valbuild/core";
import classNames from "classnames";
import { Tally2, ChevronRight, File } from "lucide-react";
import { useMemo, useState } from "react";
import { PathNode, pathTree } from "../../utils/pathTree";
import { Remote } from "../../utils/Remote";
import { useSchemas } from "../ValProvider";
import { AnimateHeight } from "./AnimateHeight";
import { Divider } from "./Divider";
import { ScrollArea } from "../../components/ui/scroll-area";
import { prettifyFilename } from "../../utils/prettifyFilename";
import { useNavigation } from "../../components/ValRouter";

export function NavMenu({ className }: { className?: string }) {
  return (
    <nav>
      <Divider />
      <ScrollArea className={classNames("overflow-scroll", className)}>
        <NavContentExplorer />
      </ScrollArea>
      {/* <Divider /><ScrollArea className="max-h-[max(50vh-84px,100px)] overflow-scroll">
          <NavSiteMap
            title="Pages"
            items={[
              "/content/projects.val.ts",
              "/content/employees/employeeList.val.ts",
              "/content/pages/projects.val.ts",
              "/content/salary.val.ts",
              "/content/handbook.val.ts",
            ]}
          />
        </ScrollArea> */}
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
    throw new Error(remoteSchemaTree.error);
  }
  if (remoteSchemaTree.status !== "success") {
    return <Loading />;
  }
  const root = remoteSchemaTree.data;

  return (
    <div className="px-2">
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

function NavSiteMap({ items, title }: { title: string; items: string[] }) {
  const root = useMemo(() => {
    return pathTree(items);
  }, [items]);
  return (
    <div className="px-2">
      <div className="py-2">{title}</div>
      <div>
        {root.children.sort(sortPathTree).map((child, i) => (
          <ExplorerNode {...child} name={child.name} key={i} />
        ))}
      </div>
    </div>
  );
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
  const { navigate } = useNavigation();
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className="w-full">
      <button
        className="flex justify-between w-full p-2"
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
