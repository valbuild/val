import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  File,
  Search,
  Tally2,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import classNames from "classnames";
import React, { useMemo, useState } from "react";
import {
  deserializeSchema,
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import { Module } from "./components/Module";
import {
  UIProvider,
  useSchemas,
  useModuleSource,
  useNavigation,
  usePatches,
  useErrors,
  useSearch,
  useModuleSourceAndSchema,
} from "./UIProvider";
import { ScrollArea } from "../components/ui/scroll-area";
import { PathNode, pathTree } from "./pathTree";
import { fixCapitalization } from "./fixCapitalization";
import { Remote } from "../utils/Remote";
import { convertPatchPathToModulePath } from "./convertPatchPathToModulePath";
import { error } from "console";
import { Field } from "./components/Field";

export function Layout() {
  return (
    <UIProvider>
      <div className="absolute top-0 left-0 w-full min-h-screen">
        <main className="grid grid-cols-[284px_auto_284px] grid-rows-[64px_auto] py-4">
          <HeaderLeft />
          <HeaderCenter />
          <HeaderRight />
          <Left />
          <Center />
          <Right />
        </main>
        <LayoutBackground />
      </div>
    </UIProvider>
  );
}

function HeaderLeft() {
  return (
    <div className="flex items-center gap-4 px-5 pt-4 ml-4 bg-primary-foreground rounded-t-3xl">
      <div>
        <FakeIcon />
      </div>
      <List />
    </div>
  );
}

function Left() {
  return (
    <div className="flex flex-col justify-between pb-4 ml-4 h-fit bg-primary-foreground rounded-b-3xl">
      <nav>
        <Divider />
        <ScrollArea className="max-h-[max(50vh-80px,100px)] overflow-scroll">
          <NavContentExplorer title="Blank website" />
        </ScrollArea>
        <Divider />
        <ScrollArea className="max-h-[max(50vh-80px,100px)] overflow-scroll">
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
        </ScrollArea>
      </nav>
    </div>
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

function NavContentExplorer({ title }: { title: string }) {
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
      <div className="py-2">{title}</div>
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

function prettifyFilename(filename: string) {
  return fixCapitalization(filename.split(".")[0]);
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

function AnimateHeight({
  isOpen,
  children,
  duration = 0.3,
}: {
  isOpen: boolean;
  children: React.ReactNode | React.ReactNode[];
  duration?: number;
}) {
  return (
    <div
      style={{ transition: `grid-template-rows ${duration}s` }}
      className={classNames("grid overflow-hidden", {
        "grid-rows-[0fr]": !isOpen,
        "grid-rows-[1fr]": isOpen,
      })}
    >
      <div
        style={{
          transition: `visibility ${duration}s`,
        }}
        className={classNames("min-h-0", {
          visible: isOpen,
          invisible: !isOpen,
        })}
      >
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-full pt-4 mb-4 border-b border-border" />;
}

function Author({ size }: { size: "md" | "lg" }) {
  return (
    <img
      src="https://randomuser.me/api/portraits/women/75.jpg"
      className={classNames("rounded-full", {
        "w-8 h-8": size === "md",
        "w-10 h-10": size === "lg",
      })}
    />
  );
}

function List() {
  return (
    <Button
      className="flex items-center justify-between w-full rounded-3xl bg-primary-foreground border-primary-foreground"
      variant="outline"
    >
      <span>Blank Oslo</span>
      <ChevronsUpDown size={16} />
    </Button>
  );
}

function HeaderCenter() {
  const { search, setSearch } = useSearch();

  if (search) {
    return (
      <HeaderCenterContainer>
        <Search />
        <input
          className="px-2 bg-transparent focus:outline-none"
          defaultValue="@error"
        ></input>
        <button
          onClick={() => {
            setSearch(false);
          }}
        >
          <X />
        </button>
      </HeaderCenterContainer>
    );
  }
  return (
    <HeaderCenterContainer>
      <PathBar />
    </HeaderCenterContainer>
  );
}

function HeaderCenterContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center">
      <div className="flex items-center px-4 py-2 rounded-2xl bg-background font-[SpaceGrotesk] w-fit">
        {children}
      </div>
    </div>
  );
}

function PathBar() {
  const { currentSourcePath } = useNavigation();
  const maybeSplittedPaths =
    currentSourcePath &&
    Internal.splitModuleFilePathAndModulePath(
      currentSourcePath as unknown as SourcePath
    );
  if (!maybeSplittedPaths) {
    return null;
  }
  const [moduleFilePath, modulePath] = maybeSplittedPaths;
  const moduleFilePathParts = moduleFilePath.split("/");
  const modulePathParts = modulePath ? modulePath.split(".") : [];
  return (
    <div className="flex items-center gap-2">
      {moduleFilePathParts.map((part, i) => (
        <>
          <span
            className={classNames({
              "text-muted": !(
                modulePathParts.length === 0 &&
                i === moduleFilePathParts.length - 1
              ),
            })}
          >
            {prettifyFilename(part)}
          </span>
          {i > 0 && i < moduleFilePathParts.length - 1 && (
            <span className="text-muted">/</span>
          )}
        </>
      ))}
      {modulePathParts.map((part, i) => (
        <>
          <span className="text-muted">/</span>
          <span
            className={classNames({
              "text-muted": i === modulePathParts.length - 2,
            })}
          >
            {prettifyFilename(JSON.parse(part))}
          </span>
        </>
      ))}
    </div>
  );
}

function Center() {
  const { search } = useSearch();
  if (search) {
    return <SearchFields type={search.type} query={search.query} />;
  }
  return <SourceFields />;
}

function SearchFields({ type, query }: { type: string; query?: string }) {
  if (type === "error") {
    return <SearchErrorFields query={query} />;
  }
  return <div>TODO</div>;
}

function SearchErrorFields({ query }: { query?: string }) {
  const { errors } = useErrors();

  const errorFields = useMemo((): Remote<SourcePath[]> => {
    if (errors.status === "success") {
      const allErrorFields = Object.keys(errors.data) as SourcePath[];
      if (query) {
        return {
          status: "success",
          data: allErrorFields.filter((errorField) =>
            errorField.includes(query)
          ),
        };
      } else {
        return { status: "success", data: allErrorFields };
      }
    } else {
      return errors;
    }
  }, [errors]);

  if (errorFields.status === "error") {
    throw new Error(errorFields.error);
  }
  if (errorFields.status !== "success") {
    return <Loading />;
  }
  return (
    <div className="flex flex-col items-center gap-10">
      {errorFields.data.map((path) => (
        <SearchField path={path} />
      ))}
    </div>
  );
}

function SearchField({ path }: { path: SourcePath }) {
  const res = useModuleSourceAndSchema(path);
  if (res.status === "error") {
    throw new Error(res.error);
  }
  if (res.status !== "success") {
    return <Loading />;
  }
  const { source, schema, moduleFilePath, modulePath } = res.data;
  return (
    <Field
      label={
        <span className="inline-block">
          <CompressedPath
            moduleFilePath={moduleFilePath}
            modulePath={modulePath}
          ></CompressedPath>
        </span>
      }
      path={path}
    >
      <Module path={path} source={source} schema={deserializeSchema(schema)} />
    </Field>
  );
}

function SourceFields() {
  const { currentSourcePath } = useNavigation();
  const maybeSplittedPaths =
    currentSourcePath &&
    Internal.splitModuleFilePathAndModulePath(
      currentSourcePath as unknown as SourcePath
    );
  const remoteSourceContent = useModuleSource(
    maybeSplittedPaths && maybeSplittedPaths[0]
  );
  const remoteSchemasByModuleFilePath = useSchemas();
  if (!maybeSplittedPaths) {
    return <EmptyContent />;
  }
  if (remoteSchemasByModuleFilePath.status === "error") {
    throw new Error(remoteSchemasByModuleFilePath.error);
  }
  if (remoteSourceContent.status === "error") {
    throw new Error(remoteSourceContent.error);
  }
  if (remoteSchemasByModuleFilePath.status !== "success") {
    return <Loading />;
  }
  if (remoteSourceContent.status !== "success") {
    return <Loading />;
  }

  const [moduleFilePath, modulePath] = maybeSplittedPaths;
  const path = currentSourcePath as unknown as SourcePath;

  const moduleSchema = remoteSchemasByModuleFilePath.data[moduleFilePath];
  const moduleSource = remoteSourceContent.data;
  const { source: sourceAtSourcePath, schema: schemaAtSourcePath } =
    Internal.resolvePath(modulePath, moduleSource, moduleSchema);
  return (
    <div className="p-4 overflow-x-hidden mb-4 rounded-b-2xl flex flex-col gap-4 w-[600px] mx-auto">
      <div className="flex flex-col w-full gap-12">
        <Module
          path={path}
          source={sourceAtSourcePath}
          schema={deserializeSchema(schemaAtSourcePath)}
        />
      </div>
    </div>
  );
}

function EmptyContent() {
  return (
    <div className="p-4 mx-4 mb-4 rounded-b-2xl bg-primary-foreground">
      Nothing selected
    </div>
  );
}

function HeaderRight() {
  return (
    <div className="flex items-center justify-between p-4 mr-4 text-sm bg-primary-foreground rounded-t-3xl">
      <div className="flex items-center gap-2">
        <Button variant="secondary">Preview</Button>
        <Button>Publish</Button>
      </div>
      <Author size="md" />
    </div>
  );
}

function Right() {
  return (
    <div className="pb-4 mr-4 text-sm rounded-b-3xl bg-primary-foreground h-fit">
      <Divider />
      <ValidationErrors />
      <Divider />
      <PendingChanges />
    </div>
  );
}

function CompressedPath({
  moduleFilePath,
  modulePath,
}: {
  moduleFilePath: ModuleFilePath;
  modulePath: ModulePath;
}) {
  const moduleFilePathParts = moduleFilePath.split("/");
  const modulePathParts = modulePath.split(".");
  return (
    <>
      <span className="inline-block w-1/2 truncate">
        {moduleFilePathParts.map((part, i) => (
          <>
            <span
              className={classNames({
                "text-muted": !(
                  modulePathParts.length === 0 &&
                  i === moduleFilePathParts.length - 1
                ),
              })}
            >
              {prettifyFilename(part)}
            </span>
            {i > 0 && i < moduleFilePathParts.length - 1 && (
              <span className="text-muted">/</span>
            )}
          </>
        ))}
      </span>
      <span className="inline-block w-1/2 truncate">
        {modulePathParts.map((part, i) => (
          <>
            <span className="text-muted">/</span>
            <span
              className={classNames({
                "text-muted": i === modulePathParts.length - 2,
              })}
            >
              {prettifyFilename(JSON.parse(part))}
            </span>
          </>
        ))}
      </span>
    </>
  );
}

function relativeLocalDate(now: Date, date: string) {
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();
  if (diff < 1000 * 60) {
    return "just now";
  }
  if (diff < 1000 * 60 * 60 * 24) {
    return "yesterday";
  }
  if (diff < 1000 * 60 * 60) {
    return `${Math.floor(diff / 1000 / 60)}m ago`;
  }
  if (diff < 1000 * 60 * 60 * 24) {
    return `${Math.floor(diff / 1000 / 60 / 60)}h ago`;
  }
  return `${Math.floor(diff / 1000 / 60 / 60 / 24)}d ago`;
}

function PendingChanges() {
  const { patches } = usePatches();
  const now = useMemo(() => new Date(), []);
  const items = useMemo((): Remote<
    {
      moduleFilePath: ModuleFilePath;
      modulePath: ModulePath;
      created_at: string;
      avatar: string | null;
    }[]
  > => {
    const items: {
      moduleFilePath: ModuleFilePath;
      modulePath: ModulePath;
      created_at: string;
      avatar: string | null;
    }[] = [];
    // we probably want to massage this data so that it is grouped by author or something
    // we have code for that but we might want to re-implement it since it is messy
    if (patches.status === "success") {
      for (const moduleFilePathS in patches.data) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        const metadata = patches.data[moduleFilePath];
        for (const patch of metadata) {
          for (const op of patch.patch) {
            items.push({
              moduleFilePath,
              modulePath: convertPatchPathToModulePath(op.path),
              created_at: patch.created_at,
              avatar: patch.author.avatar,
            });
          }
        }
      }

      return { status: "success", data: items.reverse() };
    } else {
      return patches;
    }
  }, [patches]);

  if (items.status === "error") {
    throw new Error(items.error);
  }
  if (items.status !== "success") {
    return <Loading />;
  }
  return (
    <ScrollArea className="max-h-[max(50vh-40px,200px)] overflow-scroll px-4 text-xs">
      <div className="py-2">Pending changes</div>
      {items.data.map((item, i) => (
        <div className="grid grid-cols-2 py-2" key={i}>
          <span className="flex items-center gap-4 ">
            {/* {item.avatar && (
              <img src={item.avatar} className="w-8 h-8 rounded-full" />
            )} */}
            <span className="inline-block max-w-full">
              <CompressedPath
                moduleFilePath={item.moduleFilePath}
                modulePath={item.modulePath}
              />
            </span>
          </span>
          <span className="flex items-center justify-end gap-4 text-muted-foreground">
            <span className="truncate">
              {relativeLocalDate(now, item.created_at)}
            </span>
            <ChevronDown />
          </span>
        </div>
      ))}
    </ScrollArea>
  );
}

function ValidationErrors() {
  const { errors } = useErrors();
  const { setSearch } = useSearch();
  const errorSourcePaths = useMemo((): Remote<string[]> => {
    if (errors.status === "success") {
      return {
        status: "success",
        data: Object.keys(errors.data),
      };
    } else {
      return errors;
    }
  }, [errors]);
  if (errorSourcePaths.status === "error") {
    throw new Error(errorSourcePaths.error);
  }
  if (errorSourcePaths.status !== "success") {
    return <Loading />;
  }

  return (
    <ScrollArea className="max-h-[max(50vh-40px,200px)] overflow-scroll px-4 text-xs">
      <div className="flex justify-between py-2">
        <span>Validation errors</span>
        <Button
          className="h-4 px-1 py-0 text-xs"
          onClick={() => {
            setSearch({ type: "error" });
          }}
        >
          View
        </Button>
      </div>
      {errorSourcePaths.data.map((errorSourcePath) => {
        const [moduleFilePath, modulePath] =
          Internal.splitModuleFilePathAndModulePath(
            errorSourcePath as SourcePath
          );
        return (
          <CompressedPath
            key={errorSourcePath}
            moduleFilePath={moduleFilePath}
            modulePath={modulePath}
          />
        );
      })}
    </ScrollArea>
  );
}

function LayoutBackground() {
  return (
    <>
      <div
        className="absolute top-0 left-0 invisible w-full h-full -z-5 dark:visible"
        style={{
          background: `
        radial-gradient(circle 50vw at 42% 20%, rgba(31,42,61,1), rgba(0,0,0,0.4)),
radial-gradient(circle 60vw at 94% 45%, rgba(105,88,119,1), rgba(0,0,0,0.3)),
radial-gradient(circle 80vw at 96% 95%, rgba(86,154,130,1), rgba(0,0,0,0.1)),
radial-gradient(circle 50vw at 28% 23%, rgba(2,8,23,1), rgba(0,0,0,0.7)),
url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='6.48' numOctaves='1' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")
`,
        }}
      />
    </>
  );
}

function FakeIcon() {
  return (
    <svg
      width="48"
      height="49"
      viewBox="0 0 48 49"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="24.5" r="24" fill="#272D2A" />
      <path
        d="M26.1786 19.4509C23.991 19.4509 22.2502 20.5704 21.1792 22.3943V10.625C19.0041 11.035 18.234 11.1831 16.625 11.4617V11.7854C17.4597 12.0984 17.5849 12.1586 18.2953 12.4749V35.9783H21.1792V33.9703C23.3229 37.4006 28.4665 36.9178 31.0296 34.0707C35.6717 29.5678 33.0961 19.3338 26.1786 19.4509ZM28.3289 33.516C26.5052 35.8101 22.668 35.9222 21.1784 33.4884C21.1784 30.8437 21.1784 25.5225 21.1784 22.8795C22.6581 20.0491 26.7796 20.3537 28.4491 22.8837C30.4758 25.2439 30.5007 31.3515 28.3289 33.516Z"
        fill="#FFFCB6"
      />
    </svg>
  );
}
