import { Internal, ModuleFilePath, PatchId } from "@valbuild/core";
import { useState, useEffect, forwardRef, useRef, Fragment } from "react";
import { LoadingStatus, usePatchesMetadata } from "../ValProvider";
import { SerializedPatchSet } from "../../utils/PatchSet";
import { Checkbox } from "../../components/ui/checkbox";
import classNames from "classnames";
import { PatchWithMetadata } from "../useValState";
import { prettifyFilename } from "../../utils/prettifyFilename";
import { AnimateHeight } from "./AnimateHeight";
import { Clock } from "lucide-react";

export function PendingChanges({
  className,
  patchSets,
  loadingStatus,
}: {
  className?: string;
  patchSets: SerializedPatchSet;
  loadingStatus: LoadingStatus;
}) {
  return (
    <div className={classNames(className)}>
      <div className="flex items-center justify-between p-4">
        <span className="flex items-center gap-2">
          <span>Draft changes</span>
          {(loadingStatus === "loading" || loadingStatus === "not-asked") && (
            <span>
              <Clock size={16} className="animate-spin" />
            </span>
          )}
        </span>
        <span>
          <span>See all</span>
          <Checkbox checked="indeterminate" />
        </span>
      </div>
      <div className="flex flex-col gap-1 bg-transparent">
        {Object.entries(patchSets)
          .reverse()
          .map(([moduleFilePath, patchIdsOrPatchSet]) =>
            Array.isArray(patchIdsOrPatchSet) ? (
              <PatchIdCard
                key={moduleFilePath}
                moduleFilePath={moduleFilePath}
                patchIds={patchIdsOrPatchSet}
              />
            ) : (
              <PatchSetsCard
                key={moduleFilePath}
                moduleFilePath={moduleFilePath}
                patchSet={patchIdsOrPatchSet}
              />
            ),
          )}
      </div>
    </div>
  );
}

function PatchCard({
  patchId,
  moduleFilePath,
}: {
  patchId: PatchId;
  moduleFilePath: string; //ModuleFilePath;
}) {
  const allPatchesMetadata = usePatchesMetadata();
  const [patchMetadata, setPathMetadata] = useState<PatchWithMetadata>();
  const ref = useRef<HTMLDivElement>(null);
  const [hasBeenSeen, setHasBeenSeen] = useState(false);
  useEffect(() => {
    if (hasBeenSeen && "data" in allPatchesMetadata[patchId]) {
      setPathMetadata(allPatchesMetadata[patchId].data);
    }
  }, [allPatchesMetadata[patchId], hasBeenSeen]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setHasBeenSeen(true);
        }
      },
      { threshold: 0.5 },
    );
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  if (!patchMetadata) {
    return <PatchOrPatchSetCard ref={ref} />;
  }
  return patchMetadata.patch.map((op, i) => {
    return (
      <PatchOrPatchSetCard
        key={i}
        avatars={[]}
        path={moduleFilePath.split("/").slice(1).concat(op.path)}
        changeDescription={op.op}
      />
    );
  });
}

function PatchSetsCard({
  moduleFilePath,
  patchSet,
}: {
  moduleFilePath: string; //ModuleFilePath;
  patchSet: Record<string, PatchId[]>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasBeenSeen, setHasBeenSeen] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setHasBeenSeen(true);
        }
      },
      { threshold: 0.5 },
    );
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  if (!hasBeenSeen) {
    return <PatchOrPatchSetCard ref={ref} />;
  }
  return (
    <>
      {Object.entries(patchSet)
        .reverse()
        .map(([patchPath, patchIds]) => (
          <PatchSetCard
            key={moduleFilePath + "/" + patchPath}
            moduleFilePath={moduleFilePath}
            patchPath={patchPath}
            patchIds={patchIds}
          />
        ))}
    </>
  );
}

function PatchSetCard({
  moduleFilePath,
  patchPath,
  patchIds,
}: {
  moduleFilePath: string; //ModuleFilePath;
  patchPath: string;
  patchIds: PatchId[];
}) {
  const [isOpen, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [hasBeenSeen, setHasBeenSeen] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setHasBeenSeen(true);
        }
      },
      { threshold: 0.5 },
    );
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  if (!hasBeenSeen) {
    return <PatchOrPatchSetCard ref={ref} />;
  }
  return (
    <>
      <PatchOrPatchSetCard
        path={moduleFilePath
          .split("/")
          .slice(1)
          .concat(patchPath.split("/").slice(1))}
        avatars={[]}
      />
      {patchIds.map((patchId) => (
        <PatchCard
          key={moduleFilePath + ":" + patchId}
          moduleFilePath={moduleFilePath}
          patchId={patchId}
        />
      ))}
    </>
  );
}

function PatchIdCard({
  moduleFilePath,
  patchIds,
}: {
  moduleFilePath: string; //ModuleFilePath;
  patchIds: PatchId[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasBeenSeen, setHasBeenSeen] = useState(false);
  useEffect(() => {
    //
  }, [hasBeenSeen]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setHasBeenSeen(true);
        }
      },
      { threshold: 0.5 },
    );
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  if (!hasBeenSeen) {
    return <PatchOrPatchSetCard ref={ref} />;
  }
  return (
    <PatchOrPatchSetCard
      path={moduleFilePath.split("/")}
      avatars={[]}
      changeDescription={"changed"}
    />
  );
}

const PatchOrPatchSetCard = forwardRef<
  HTMLDivElement,
  {
    path?: string[];
    changeDescription?: string;
    avatars?: { url: string; alt: string }[];
    isOpen?: boolean;
    setOpen?: (isOpen: boolean) => void;
    isSelected?: boolean;
    setSelected?: (isSelected: boolean | "indeterminate") => void;
  }
>(
  (
    {
      path,
      changeDescription,
      avatars,
      isOpen,
      setOpen,
      isSelected,
      setSelected,
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={classNames("p-6", {
          "bg-bg-secondary": !isOpen,
          "bg-bg-quartenary": isOpen,
        })}
      >
        <div>
          <span
            className={classNames(
              "inline-block w-[calc(320px-24px-8px-16px-24px-48px)] truncate overflow-y-hidden h-6 mr-2 text-left",
              {
                "animate-pulse bg-bg-disabled rounded-3xl": path === undefined,
              },
            )}
            dir="rtl"
          >
            {path !== undefined &&
              // path.map((pathPart, index) => (
              //   <Fragment key={index}>
              //     {index === 0 && (
              //       <span className="text-text-quartenary">/</span>
              //     )}
              //     <span
              //       className={classNames("truncate", {
              //         "font-bold": index === path.length - 1,
              //         "text-text-quartenary": index !== path.length - 1,
              //       })}
              //     >
              //       {pathPart}
              //     </span>
              //     {index !== path.length - 1 && (
              //       <span className="text-text-quartenary">/</span>
              //     )}
              //   </Fragment>
              // ))
              path.join("/")}
          </span>
          {isSelected === undefined && (
            <span
              className={classNames("inline-block w-6 h-6 rounded", {
                "bg-bg-disabled animate-pulse": path === undefined,
              })}
            ></span>
          )}
          {isSelected !== undefined && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => {
                if (setSelected) {
                  setSelected(checked);
                }
              }}
            />
          )}
        </div>
        <div className="pt-2">
          <span>
            {avatars !== undefined && avatars.length > 0 && (
              <span className="flex gap-2 mr-2">
                {avatars.slice(0, 2).map((avatar) => (
                  <img
                    key={avatar.url}
                    src={avatar.url}
                    alt={avatar.alt}
                    className="flex-shrink-0 w-6 h-6 rounded-full"
                  />
                ))}
                {avatars.length > 2 && (
                  <span className="w-6 h-6 rounded-full bg-bg-primary text-text-primary">
                    +{avatars.length - 2}
                  </span>
                )}
              </span>
            )}
            {avatars === undefined && (
              <span
                className={classNames("inline-block w-6 h-6 mr-2", {
                  "bg-bg-disabled animate-pulse rounded-3xl":
                    avatars === undefined,
                })}
              ></span>
            )}
            <span
              className={classNames("inline-block pr-2 h-6", {
                "w-[calc(100%-64px)]":
                  avatars !== undefined && avatars.length > 0,
                "w-full": avatars !== undefined && avatars.length === 0,
                "rounded-3xl bg-bg-disabled animate-pulse":
                  changeDescription === undefined,
              })}
            ></span>
          </span>
          {isOpen !== undefined && (
            <button
              onClick={() => {
                if (setOpen) {
                  setOpen(!isOpen);
                }
              }}
            >
              {isOpen ? "Close" : "Open"}
            </button>
          )}
        </div>
      </div>
    );
  },
);

function getPath(moduleFilePath: string, patchPath: string[]) {
  const res = moduleFilePath
    .split("/")
    .slice(1)
    .concat(patchPath)
    .map(prettifyFilename);
  console.log({ res });
  return res;
}
