import { SourcePath, ModuleFilePath, Internal, PatchId } from "@valbuild/core";
import classNames from "classnames";
import { ArrowRight, ChevronDown, Clock, ChevronRight } from "lucide-react";
import { useMemo, useState, Fragment, useRef, useEffect } from "react";
import { prettifyFilename } from "../../utils/prettifyFilename";
import { relativeLocalDate } from "../../utils/relativeLocalDate";
import { Remote } from "../../utils/Remote";
import { AnimateHeight } from "./AnimateHeight";
import { Divider } from "./Divider";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Checkbox } from "../../components/ui/checkbox";
import { Author } from "../useValState";
import { isoDateStringSort } from "../../utils/isoDateStringSort";
import { usePatchesMetadata, usePatchSets } from "../ValProvider";

type AuthorId = string; // TODO: use this
type PatchSetPatchItem = {
  title: string;
  subTitle: string[];
  sourcePath: SourcePath;
  type: "add" | "replace" | "remove" | "move" | "copy" | "test" | "file";
  patchId: string;
  author: AuthorId | null;
  created_at: string;
};
type PatchSetItem =
  | {
      title: string;
      subTitle: string[];
      sourcePath: SourcePath;
      isPatchSet: true;
      patches: PatchSetPatchItem[];
      authors: AuthorId[] | null;
      updated_at: string;
    }
  | ({ isPatchSet: false } & PatchSetPatchItem);

export function PendingChanges({ className }: { className?: string }) {
  const remotePatchSets = usePatchSets();
  const patchMetadataByPatchId = usePatchesMetadata();
  const lastSuccessRef = useRef<PatchSetItem[] | null>(null);
  const now = useMemo(() => new Date(), []);
  const currentAuthorId = "1";
  const [items, setItems] = useState<Remote<PatchSetItem[]>>({
    status: "not-asked",
  });
  useEffect(() => {
    const timeout = setTimeout(() => {
      const patchSetsItems: PatchSetItem[] = [];
      // we probably want to massage this data so that it is grouped by author or something
      // we have code for that but we might want to re-implement it since it is messy
      if (remotePatchSets.status !== "success") {
        setItems(remotePatchSets);
        return;
      }
      let status: "success" | "loading" = "success";
      const patchSets = remotePatchSets.data.patchSets;
      for (const moduleFilePathS in patchSets) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        const modulePatchSets = patchSets[moduleFilePath];
        if (Array.isArray(modulePatchSets)) {
          for (const patchId of modulePatchSets) {
            const patchMetadata = patchMetadataByPatchId[patchId];
            if (
              patchMetadata?.status === "loading" ||
              patchMetadata?.status === "not-asked"
            ) {
              status = "loading";
            }
            if (patchMetadata?.status === "success") {
              for (const op of patchMetadata.data.patch) {
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
                  created_at: patchMetadata.data.createdAt,
                  author: patchMetadata.data.author,
                });
              }
            }
          }
        } else {
          for (const patchSetPathS in modulePatchSets) {
            const patchIds = modulePatchSets[patchSetPathS];
            const authorIds: Set<string> = new Set();
            let updatedAt = "";
            const patchSetSubItems: PatchSetPatchItem[] = [];
            for (const patchIdS of patchIds) {
              const patchId = patchIdS as PatchId;
              const remotePatch = patchMetadataByPatchId[patchId];

              if (remotePatch.status === "loading") {
                status = "loading";
              }
              if (remotePatch.status !== "success") {
                continue;
              }
              const patch = remotePatch.data;
              if (patch.author !== null) {
                if (!authorIds.has(patch.author)) {
                  authorIds.add(patch.author);
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
                return isoDateStringSort(b.created_at, a.created_at); // most recent first
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
              authors: authorIds.size > 0 ? Array.from(authorIds) : null,
              updated_at: updatedAt,
            });
          }
        }
      }
      patchSetsItems.sort((a, b) => {
        // sort current author first, then by date:
        const isCurrentAuthorA = a.isPatchSet
          ? a.authors?.some((author) => author === currentAuthorId)
          : a.author === currentAuthorId;
        const isCurrentAuthorB = b.isPatchSet
          ? b.authors?.some((author) => author === currentAuthorId)
          : b.author === currentAuthorId;
        if (isCurrentAuthorA && !isCurrentAuthorB) {
          return -1;
        }
        if (!isCurrentAuthorA && isCurrentAuthorB) {
          return 1;
        }
        const aUpdatedAt = a.isPatchSet ? a.updated_at : a.created_at;
        const bUpdatedAt = b.isPatchSet ? b.updated_at : b.created_at;
        return isoDateStringSort(bUpdatedAt, aUpdatedAt); // most recent first
      });
      if (patchSetsItems.length > 0) {
        lastSuccessRef.current = patchSetsItems.slice();
      }
      setItems({ status: status, data: patchSetsItems });
    }, 100);
    return () => {
      clearTimeout(timeout);
    };
  }, [remotePatchSets, patchMetadataByPatchId]);

  if (items.status === "error") {
    return <div>Error: {items.error}</div>;
  }
  const currentItems =
    lastSuccessRef.current !== null
      ? lastSuccessRef.current
      : "data" in items
        ? items.data
        : [];
  if (currentItems === null) {
    return <Loading />;
  }
  if (currentItems.length === 0) {
    return (
      <span className="px-3 text-sm font-bold">
        {items.status === "loading" ? "Loading..." : "No pending changes"}
      </span>
    );
  }

  return (
    <ScrollArea className={classNames("py-4 w-[calc(100%-16px)]", className)}>
      <div className="flex justify-between px-3 py-2">
        <span className="flex items-center gap-2">
          <ChangesAmountBadge
            status={items.status}
            amount={currentItems.reduce(
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
        {currentItems.map((item, i) =>
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
  );
}

function Loading() {
  return null;
}

function PatchSetCard({
  title,
  subTitle,
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
  authors: AuthorId[] | null;
  date: string;
  now: Date;
  expandable: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  // const { setSearch } = useSearch();

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
                // setSearch({ type: "change", sourcePath });
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
              // setSearch({
              //   type: "change",
              //   sourcePath: Internal.parentOfSourcePath(sourcePath),
              // });
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
        {expandable && (
          <ChangesAmountBadge status={"success"} amount={patches.length} />
        )}
        <div className="flex items-center gap-[2px]">
          {/* {authors
            ?.slice(0, 2)
            .map((author) => <Avatar key={author.id} {...author} />)}
          {authors && authors.length > 2 && (
            <div className="w-6 h-6 leading-6 text-center rounded-full bg-bg-brand-primary text-text-secondary">
              +{authors.length - 2}
            </div>
          )} */}
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

function ChangesAmountBadge({
  amount,
  status,
}: {
  amount: number;
  status: "loading" | "error" | "success" | "not-asked";
}) {
  const showAmount = status === "success";
  return (
    <div
      className={classNames(
        "flex items-center h-6 leading-6 rounded-xl bg-bg-brand-primary text-text-secondary",
      )}
    >
      {!showAmount && <Clock className="w-6 h-6 animate-spin" />}
      {showAmount && <span className="text-center min-w-8 ">{amount}</span>}
    </div>
  );
}

function Avatar({ avatar }: Author) {
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
  author: AuthorId | null;
  created_at: string;
  now: Date;
  last: boolean;
}) {
  // const { setSearch } = useSearch();
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
              // setSearch({ type: "change", sourcePath });
            }}
          >
            <div className="font-bold">{title}</div>
          </button>
          <Checkbox checked />
        </div>
        <button
          className="text-left"
          onClick={() => {
            // setSearch({
            //   type: "change",
            //   sourcePath: Internal.parentOfSourcePath(sourcePath),
            // });
          }}
        >
          <SubTitle subTitle={subTitle} />
        </button>
        <div className="text-xs">{relativeLocalDate(now, created_at)}</div>
        {/* <div className="self-end py-1">{author && <Avatar {...author} />}</div> */}
      </div>
    </div>
  );
}

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