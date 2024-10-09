import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  File,
  Search,
  Tally2,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import classNames from "classnames";
import React, { Fragment, useEffect, useMemo, useState } from "react";
import {
  deserializeSchema,
  Internal,
  ModuleFilePath,
  ModulePath,
  PatchId,
  SourcePath,
} from "@valbuild/core";
import { Module } from "./components/Module";
import {
  useSchemas,
  useModuleSource,
  useNavigation,
  usePatches,
  useErrors,
  useSearch,
  useModuleSourceAndSchema,
  usePatchSets,
  Author as AuthorT,
  useSearchResults,
} from "./ValProvider";
import { ScrollArea } from "../components/ui/scroll-area";
import { PathNode, pathTree } from "../utils/pathTree";
import { fixCapitalization } from "../utils/fixCapitalization";
import { Remote } from "../utils/Remote";
import { Field } from "./components/Field";
import { relativeLocalDate } from "../utils/relativeLocalDate";
import { AnimateHeight } from "./components/AnimateHeight";
import { Checkbox } from "../components/ui/checkbox";

export function Layout() {
  return (
    <main className="bg-bg-primary">
      <div className="fixed top-4 left-4 w-[320px] hidden md:block">
        <HeaderLeft />
        <Left />
      </div>
      <div className="mx-auto w-full md:w-[calc(100%-320*2px)] max-w-[600px] min-h-screen">
        <HeaderCenter />
        <Center />
      </div>
      <div className="fixed top-4 right-4 w-[320px] hidden md:block">
        <HeaderRight />
        <Right />
      </div>
    </main>
  );
}

function HeaderLeft() {
  return (
    <div className="flex items-center gap-2 px-5 pt-4 ml-4 text-xs bg-bg-secondary rounded-t-3xl">
      <Author size="md" />
      <List />
    </div>
  );
}

function Left() {
  return (
    <div className="flex flex-col justify-between pb-4 ml-4 text-xs h-fit bg-bg-secondary rounded-b-3xl">
      <nav>
        <Divider />
        <ScrollArea className="max-h-[max(50vh-84px,100px)] overflow-scroll">
          <NavContentExplorer title="Blank website" />
        </ScrollArea>
        <Divider />
        <ScrollArea className="max-h-[max(50vh-84px,100px)] overflow-scroll">
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
function Divider() {
  return <div className="w-full pt-4 mb-4 border-b border-border-primary" />;
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
    <button className="flex items-center justify-between w-full px-4 py-2 text-xs rounded-3xl bg-bg-secondary">
      <span>Blank Oslo</span>
      <ChevronsUpDown size={12} />
    </button>
  );
}

function HeaderCenter() {
  const { search, setSearch } = useSearch();
  const [query, setQuery] = useState("");
  useEffect(() => {
    // debounce:
    const timeout = setTimeout(() => {
      if (query.includes("@error")) {
        setSearch({
          type: "error",
          filter: query.replace("@error", "").trim(),
        });
      } else if (query.includes("@change")) {
        setSearch({
          type: "change",
          filter: query.replace("@change", "").trim(),
        });
      } else {
        setSearch({ filter: query.trim() });
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  if (search) {
    return (
      <HeaderCenterContainer>
        <Search size={22} />
        <input
          className="px-2 bg-transparent focus:outline-none w-[calc(100%-48px)]"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          autoFocus
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
      <button
        className="flex items-center justify-between w-full h-full"
        onClick={() => {
          setSearch({ filter: "" });
        }}
      >
        <div className="flex items-center h-full pr-4 border-r border-border">
          <Search size={22} />
        </div>
        <PathBar />
        <div>⌘K</div>
      </button>
    </HeaderCenterContainer>
  );
}

function HeaderCenterContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 mx-auto mb-10 text-sm">
      <div className="flex items-center justify-between px-4 rounded-2xl bg-bg-secondary font-[SpaceGrotesk] h-12 border border-border-primary">
        {children}
      </div>
    </div>
  );
}

function PathBar() {
  const { currentSourcePath } = useNavigation();
  const maybeSplitPaths =
    currentSourcePath &&
    Internal.splitModuleFilePathAndModulePath(
      currentSourcePath as unknown as SourcePath,
    );
  if (!maybeSplitPaths) {
    return null;
  }
  const [moduleFilePath, modulePath] = maybeSplitPaths;
  const moduleFilePathParts = moduleFilePath.split("/");
  const modulePathParts = modulePath ? modulePath.split(".") : [];
  return (
    <div className="flex items-center gap-2">
      {moduleFilePathParts.map((part, i) => (
        <Fragment key={`${part}-${i}`}>
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
            <span className="text-muted">
              <ChevronRight size={16} />
            </span>
          )}
        </Fragment>
      ))}
      {modulePathParts.map((part, i) => (
        <Fragment key={`${part}-${i}`}>
          <span className="text-muted">
            <ChevronRight size={16} />
          </span>
          <span
            className={classNames({
              "text-muted": i === modulePathParts.length - 2,
            })}
          >
            {prettifyFilename(JSON.parse(part))}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function Center() {
  const { search } = useSearch();
  if (search) {
    return (
      <SearchFields
        type={search.type}
        sourcePath={search.sourcePath}
        filter={search.filter}
      />
    );
  }
  return <SourceFields />;
}

function SearchFields({
  sourcePath,
  filter,
}: {
  type?: "change" | "error";
  sourcePath?: SourcePath;
  filter?: string;
}) {
  const results = useSearchResults({
    query: (sourcePath || "") + " " + (filter || ""),
    patches: [], // TODO: get patches
  });
  if (results.status === "error") {
    throw new Error(results.error);
  }
  if (results.status !== "success") {
    return <Loading />;
  }
  return (
    <div className="flex flex-col gap-10 pt-4">
      {results.data.map((result) => {
        return <SearchField key={result.sourcePath} path={result.sourcePath} />;
      })}
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
  const maybeSplitPaths =
    currentSourcePath &&
    Internal.splitModuleFilePathAndModulePath(
      currentSourcePath as unknown as SourcePath,
    );
  const remoteSourceContent = useModuleSource(
    maybeSplitPaths && maybeSplitPaths[0],
  );
  const remoteSchemasByModuleFilePath = useSchemas();
  if (!maybeSplitPaths) {
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

  const [moduleFilePath, modulePath] = maybeSplitPaths;
  const path = currentSourcePath as unknown as SourcePath;

  const moduleSchema = remoteSchemasByModuleFilePath.data[moduleFilePath];
  const moduleSource = remoteSourceContent.data;
  const { source: sourceAtSourcePath, schema: schemaAtSourcePath } =
    Internal.resolvePath(modulePath, moduleSource, moduleSchema);
  return (
    <div className="flex flex-col gap-4 p-4 mb-4 rounded-b-2xl">
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
  const { patches } = usePatches();
  const { errors } = useErrors();

  let publishDisabled = false;
  if (patches.status !== "success") {
    publishDisabled = true;
  }
  if (patches.status === "success") {
    publishDisabled = Object.keys(patches.data).length === 0;
  }
  if (errors.status !== "success") {
    publishDisabled = true;
  }
  if (errors.status === "success") {
    publishDisabled = Object.keys(errors.data).length > 0;
  }

  return (
    <div className="flex items-center justify-end gap-2 p-4 mb-1 text-sm bg-bg-secondary rounded-3xl">
      <Button disabled={publishDisabled}>Publish</Button>
    </div>
  );
}

function Right() {
  return (
    <div className="flex flex-col gap-1">
      <ValidationErrors />
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
  const moduleFilePathParts = moduleFilePath.split("/"); // TODO: create a function to split module file paths properly
  const modulePathParts = Internal.splitModulePath(modulePath);
  const { navigate } = useNavigation();
  return (
    <div
      title={Internal.joinModuleFilePathAndModulePath(
        moduleFilePath,
        modulePath,
      )}
    >
      <button
        className="inline-block w-1/2 text-left truncate"
        onClick={() => {
          navigate(moduleFilePath);
        }}
      >
        {moduleFilePathParts.map((part, i) => (
          <Fragment key={`${part}-${i}`}>
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
          </Fragment>
        ))}
      </button>
      <button
        className="inline-block w-1/2 text-left truncate"
        onClick={() => {
          navigate(
            Internal.joinModuleFilePathAndModulePath(
              moduleFilePath,
              modulePath,
            ),
          );
        }}
      >
        {modulePathParts.map((part, i) => (
          <Fragment key={`${part}-${i}`}>
            <span className="text-muted">/</span>
            <span
              className={classNames({
                "text-muted": i === modulePathParts.length - 2,
              })}
            >
              {prettifyFilename(part)}
            </span>
          </Fragment>
        ))}
      </button>
    </div>
  );
}

type PatchSetPatchItem = {
  title: string;
  subTitle: string[];
  sourcePath: SourcePath;
  type: "add" | "replace" | "remove" | "move" | "copy" | "test" | "file";
  patchId: string;
  author: AuthorT | null;
  created_at: string;
};
type PatchSetItem =
  | {
      title: string;
      subTitle: string[];
      sourcePath: SourcePath;
      isPatchSet: true;
      patches: PatchSetPatchItem[];
      authors: AuthorT[];
      updated_at: string;
    }
  | ({ isPatchSet: false } & PatchSetPatchItem);

function getTitles(moduleFilePath: string, patchPath: string[]) {
  const parts = moduleFilePath
    .split("/")
    .slice(1)
    .map(prettifyFilename)
    .concat(patchPath.map(prettifyFilename));
  const title = parts[parts.length - 1];
  const subTitle = parts.slice(0, -1);
  return { title, subTitle };
}

function PendingChanges() {
  const { setSearch } = useSearch();
  const {
    patchSets: remotePatchSets,
    patchMetadataByPatchId: remotePatchMetadataByPatchId,
  } = usePatchSets();
  const now = useMemo(() => new Date(), []);
  const currentAuthorId = "1";
  const items = useMemo((): Remote<PatchSetItem[]> => {
    const patchSetsItems: PatchSetItem[] = [];
    // we probably want to massage this data so that it is grouped by author or something
    // we have code for that but we might want to re-implement it since it is messy
    if (remotePatchSets.status !== "success") {
      return remotePatchSets;
    }
    if (remotePatchMetadataByPatchId.status !== "success") {
      return remotePatchMetadataByPatchId;
    }
    const patchMetadataByPatchId = remotePatchMetadataByPatchId.data;
    const serializedPatchSets = remotePatchSets.data;
    for (const moduleFilePathS in serializedPatchSets) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const modulePatchSets = serializedPatchSets[moduleFilePath];
      if (Array.isArray(modulePatchSets)) {
        for (const patchId of modulePatchSets) {
          const patchMetadata = patchMetadataByPatchId[patchId];
          if (patchMetadata) {
            for (const op of patchMetadata.patch) {
              const { title, subTitle } = getTitles(moduleFilePath, op.path);
              patchSetsItems.push({
                isPatchSet: false,
                type: op.op,
                title,
                subTitle,
                sourcePath: Internal.joinModuleFilePathAndModulePath(
                  moduleFilePath,
                  Internal.patchPathToModulePath(op.path),
                ),
                patchId,
                created_at: patchMetadata.createdAt,
                author: patchMetadata.author,
              });
            }
          }
        }
      } else {
        for (const patchSetPathS in modulePatchSets) {
          const patchIds = modulePatchSets[patchSetPathS];
          const authors: AuthorT[] = [];
          const authorIds: Set<string> = new Set();
          let updatedAt = "";
          const patchSetSubItems: PatchSetPatchItem[] = [];
          for (const patchIdS of patchIds) {
            const patchId = patchIdS as PatchId;
            const patch = patchMetadataByPatchId[patchId];
            if (patch.author) {
              if (!authorIds.has(patch.author.id)) {
                authors.push(patch.author);
                authorIds.add(patch.author.id);
              }
            }
            if (!updatedAt) {
              updatedAt = patch.createdAt;
            } else {
              // assumes that comparing iso datetime strings works
              updatedAt =
                patch.createdAt > updatedAt ? patch.createdAt : updatedAt;
            }
            for (const op of patch.patch) {
              const { title, subTitle } = getTitles(moduleFilePath, op.path);
              patchSetSubItems.push({
                title,
                subTitle,
                sourcePath: Internal.joinModuleFilePathAndModulePath(
                  moduleFilePath,
                  Internal.patchPathToModulePath(op.path),
                ),
                type: op.op,
                author: patch.author,
                patchId: patchId,
                created_at: patch.createdAt,
              });
            }
            patchSetSubItems.sort((a, b) => {
              return isoStringSort(b.created_at, a.created_at); // most recent first
            });
          }
          const patchSetPath = patchSetPathS.split("/").slice(1); // remove the first empty string
          const { title, subTitle } = getTitles(moduleFilePath, patchSetPath);
          patchSetsItems.push({
            title,
            subTitle,
            sourcePath: Internal.joinModuleFilePathAndModulePath(
              moduleFilePath,
              Internal.patchPathToModulePath(patchSetPath),
            ),
            isPatchSet: true,
            patches: patchSetSubItems,
            authors,
            updated_at: updatedAt,
          });
        }
      }
    }

    patchSetsItems.sort((a, b) => {
      // sort current author first, then by date:
      const isCurrentAuthorA = a.isPatchSet
        ? a.authors.some((author) => author.id === currentAuthorId)
        : a.author?.id === currentAuthorId;
      const isCurrentAuthorB = b.isPatchSet
        ? b.authors.some((author) => author.id === currentAuthorId)
        : b.author?.id === currentAuthorId;
      if (isCurrentAuthorA && !isCurrentAuthorB) {
        return -1;
      }
      if (!isCurrentAuthorA && isCurrentAuthorB) {
        return 1;
      }
      const aUpdatedAt = a.isPatchSet ? a.updated_at : a.created_at;
      const bUpdatedAt = b.isPatchSet ? b.updated_at : b.created_at;
      return isoStringSort(bUpdatedAt, aUpdatedAt); // most recent first
    });
    return { status: "success", data: patchSetsItems };
  }, [remotePatchSets, remotePatchMetadataByPatchId]);

  if (items.status === "error") {
    throw new Error(items.error);
  }
  if (items.status !== "success") {
    return <Loading />;
  }
  if (items.data.length === 0) {
    return (
      <div className="py-4 rounded-3xl bg-bg-secondary">
        <span className="px-3 text-sm font-bold">No pending changes</span>
      </div>
    );
  }

  return (
    <div className="py-4 rounded-3xl bg-bg-secondary">
      <ScrollArea>
        <div className="flex justify-between px-3 py-2">
          <span className="flex items-center gap-2">
            <ChangesAmountBadge
              amount={items.data.reduce(
                (prev, item) =>
                  prev + (item.isPatchSet ? item.patches.length : 1),
                0,
              )}
            />
            <span className="text-sm font-bold">Changes</span>
          </span>
          <Checkbox checked />
        </div>
        <div className="flex flex-col pt-4">
          {items.data.map((item, i) =>
            item.isPatchSet ? (
              <PatchSetCard
                key={[item.title].concat(item.subTitle).join("/")}
                title={item.title}
                subTitle={item.subTitle}
                sourcePath={item.sourcePath}
                patches={item.patches}
                authors={item.authors}
                date={item.updated_at}
                now={now}
                expandable={item.patches.length > 1}
              />
            ) : (
              <PatchSetCard
                key={i}
                title={item.title}
                subTitle={item.subTitle}
                sourcePath={item.sourcePath}
                date={item.created_at}
                now={now}
                patches={[]}
                authors={item.author ? [item.author] : []}
                expandable={false}
              />
            ),
          )}
        </div>
      </ScrollArea>
      <Divider />
      <button
        className="flex items-center justify-between w-full px-3"
        onClick={() => {
          setSearch({ type: "change" });
        }}
      >
        <span>See all changes</span>
        <span>
          <ArrowRight size={16} />
        </span>
      </button>
    </div>
  );
}

function isoStringSort(a: string, b: string) {
  // NOTE: we benchmarked different sort methods on ISO datetime strings on node v18.17.0 and v22.9.0 and localeCompare was about 10x faster than new Date().getTime and about 100x faster than localeCompare with numeric: true or sensitivity: 'base' (or both) despite various AIs telling us the opposite. Go figure...
  // the undefined sets the locale to
  return a.localeCompare(b, ["en-US"]);
}

function PatchSetCard({
  title,
  subTitle,
  sourcePath,
  patches,
  authors,
  date,
  now,
  expandable,
}: {
  title: string;
  subTitle: string[];
  sourcePath: SourcePath;
  patches: PatchSetPatchItem[];
  authors: AuthorT[];
  date: string;
  now: Date;
  expandable: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { setSearch } = useSearch();

  return (
    <div
      className={classNames("flex flex-col text-sm rounded-t-lg py-4 gap-2", {
        "bg-bg-secondary rounded-b-lg": !isOpen,
        "bg-bg-secondary_hover": isOpen,
      })}
    >
      <div className="flex flex-col gap-1 px-3">
        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-2 "
            onClick={() => {
              if (expandable) {
                setIsOpen(!isOpen);
              } else {
                setSearch({ type: "change", sourcePath });
              }
            }}
          >
            {expandable && (
              <ChevronDown
                size={16}
                className={classNames(
                  "transform text-fg-quinary duration-300",
                  {
                    "rotate-180": isOpen,
                    "rotate-0": !isOpen,
                  },
                )}
              />
            )}
            <span>{title}</span>
          </button>
          <Checkbox checked />
        </div>
        <button
          onClick={() => {
            if (expandable) {
              setIsOpen(!isOpen);
            } else {
              setSearch({
                type: "change",
                sourcePath: Internal.parentOfSourcePath(sourcePath),
              });
            }
          }}
          className="text-left"
        >
          <SubTitle subTitle={subTitle} />
        </button>
        <div className="flex items-center gap-2 text-xs">
          <Clock className="text-fg-secondary" size={11} />
          <span className="text-fg-quinary">
            {relativeLocalDate(now, date)}
          </span>
        </div>
      </div>
      <div
        className={classNames("flex items-center px-3", {
          "justify-between": expandable,
          "justify-end": !expandable,
        })}
      >
        {expandable && <ChangesAmountBadge amount={patches.length} />}
        <div className="flex items-center gap-[2px]">
          {authors.slice(0, 2).map((author) => (
            <Avatar key={author.id} {...author} />
          ))}
          {authors.length > 2 && (
            <div className="w-6 h-6 leading-6 text-center rounded-full bg-bg-brand-primary text-text-secondary">
              +{authors.length - 2}
            </div>
          )}
        </div>
      </div>
      <AnimateHeight isOpen={isOpen}>
        <div className="flex flex-col gap-1 pt-1 bg-bg-secondary">
          {patches.map((patch, i) => (
            <PatchCard
              key={i}
              title={patch.title}
              subTitle={patch.subTitle}
              sourcePath={patch.sourcePath}
              type={patch.type}
              author={patch.author}
              created_at={patch.created_at}
              now={now}
              last={i === patches.length - 1}
            />
          ))}
        </div>
      </AnimateHeight>
    </div>
  );
}

function SubTitle({ subTitle }: { subTitle: string[] }) {
  return (
    <div className="flex max-w-full text-xs truncate text-fg-quinary">
      {subTitle.map((part, i) => (
        <Fragment key={i}>
          <span className="truncate">{part}</span>
          {i < subTitle.length - 1 && (
            <span>
              <ChevronRight size={14} />
            </span>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function ChangesAmountBadge({ amount }: { amount: number }) {
  return (
    <div className="h-6 leading-6 text-center min-w-8 rounded-xl bg-bg-brand-primary text-text-secondary">
      {amount}
    </div>
  );
}

function Avatar({ avatar }: AuthorT) {
  return <img src={avatar} className="w-6 h-6 rounded-full" />;
}

function PatchCard({
  title,
  subTitle,
  sourcePath,
  author,
  created_at,
  now,
  last,
}: {
  title: string;
  subTitle: string[];
  sourcePath: SourcePath;
  type: PatchSetPatchItem["type"];
  author: AuthorT | null;
  created_at: string;
  now: Date;
  last: boolean;
}) {
  const { setSearch } = useSearch();
  return (
    <div
      className={classNames("flex text-left bg-bg-secondary_hover gap-[11px]", {
        "rounded-b-lg": last,
      })}
    >
      <div className="w-[11px] px-3">
        <div className="pl-[5px] h-[40px] mr-[5px] border-r border-border-primary"></div>
        <div className="py-1 text-fg-secondary">
          <Clock size={11} />
        </div>
        <div className="pl-[5px] h-[40px] mr-[5px] border-r border-border-primary"></div>
      </div>
      <div className="flex flex-col max-w-[210px] py-2 text-fg-quartenary">
        <div className="flex items-center justify-between">
          <button
            className="text-left"
            onClick={() => {
              setSearch({ type: "change", sourcePath });
            }}
          >
            <div className="font-bold">{title}</div>
          </button>
          <Checkbox checked />
        </div>
        <button
          className="text-left"
          onClick={() => {
            setSearch({
              type: "change",
              sourcePath: Internal.parentOfSourcePath(sourcePath),
            });
          }}
        >
          <SubTitle subTitle={subTitle} />
        </button>
        <div className="text-xs">{relativeLocalDate(now, created_at)}</div>
        <div className="self-end py-1">{author && <Avatar {...author} />}</div>
      </div>
    </div>
  );
}

function ValidationErrors() {
  const { errors } = useErrors();
  const errorSourcePaths = useMemo((): Remote<SourcePath[]> => {
    if (errors.status === "success") {
      return {
        status: "success",
        data: Object.keys(errors.data) as SourcePath[],
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
  if (errorSourcePaths.data.length === 0) {
    return null;
  }
  return (
    <div className="py-4 rounded-3xl bg-bg-secondary">
      <ScrollArea className="max-h-[max(50vh-40px,200px)] overflow-scroll">
        <div className="flex items-center gap-2 px-4">
          <ErrorsAmountBadge amount={errorSourcePaths.data.length} />
          <span className="font-bold">Errors</span>
        </div>
        <Divider />
        <div className="flex flex-col px-4">
          {errorSourcePaths.data.map((errorSourcePath) => {
            return (
              <ValidationErrorCard
                key={errorSourcePath}
                sourcePath={errorSourcePath}
              />
            );
          })}
        </div>
      </ScrollArea>
      <Divider />
      <button
        className="flex items-center justify-between w-full px-4 text-left"
        onClick={() => {
          // setSearch({ type: "error" });
        }}
      >
        <span>See all errors</span>
        <span>
          <ArrowRight size={16} />
        </span>
      </button>
    </div>
  );
}

function ValidationErrorCard({ sourcePath }: { sourcePath: SourcePath }) {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const { title, subTitle } = getTitles(
    moduleFilePath,
    Internal.splitModulePath(modulePath),
  );
  const { setSearch } = useSearch();
  return (
    <div className="py-3">
      <button
        className="flex items-center gap-2 text-left"
        onClick={() => {
          setSearch({ type: "error", sourcePath });
        }}
      >
        <span>{title}</span>
      </button>
      <button
        className="text-left"
        onClick={() => {
          setSearch({
            type: "error",
            sourcePath: Internal.parentOfSourcePath(sourcePath),
          });
        }}
      >
        <SubTitle subTitle={subTitle} />
      </button>
    </div>
  );
}

function ErrorsAmountBadge({ amount }: { amount: number }) {
  return (
    <div className="h-6 leading-6 text-center min-w-8 rounded-xl bg-bg-error-primary text-text-secondary">
      {amount}
    </div>
  );
}
