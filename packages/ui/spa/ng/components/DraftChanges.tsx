import { ModuleFilePath } from "@valbuild/core";
import { useState, useEffect, forwardRef, useRef } from "react";
import {
  LoadingStatus,
  useCurrentPatchIds,
  useSchemaSha,
} from "../ValProvider";
import { Checkbox } from "../../components/ui/checkbox";
import classNames from "classnames";
import { prettifyFilename } from "../../utils/prettifyFilename";
import { Clock } from "lucide-react";
import {
  PatchMetadata,
  PatchSetMetadata,
  SerializedPatchSet,
} from "../PatchSets";
import { AnimateHeight } from "./AnimateHeight";

const createPatchWorker = () =>
  new Worker(new URL("../PatchWorker.ts", import.meta.url));

export function DraftChanges({
  className,
  loadingStatus,
}: {
  className?: string;
  loadingStatus: LoadingStatus;
}) {
  const host = "/api/val";
  const schemaSha = useSchemaSha();
  const patchIds = useCurrentPatchIds();
  const workerRef = useRef<Worker | null>(null);
  const [workerError, setWorkerError] = useState<ErrorEvent | null>(null);
  const [patchSets, setPatchSets] = useState<SerializedPatchSet | null>(null);
  useEffect(() => {
    const worker = createPatchWorker();
    worker.onmessage = (event) => {
      const data = event.data as {
        patchSet: SerializedPatchSet;
        schemaSha: string;
      };
      if (schemaSha === data.schemaSha) {
        setPatchSets(data.patchSet);
      } else {
        console.error("Schema mismatch", schemaSha, data.schemaSha);
      }
    };
    worker.onerror = (event) => {
      console.error("Worker error", event);
      setWorkerError(event);
    };
    workerRef.current = worker;
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, [schemaSha]);
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ patchIds, host, schemaSha });
    }
  }, [patchIds, schemaSha]);
  if (workerError) {
    return <div>{workerError.message}</div>;
  }
  return (
    <div className={classNames(className)}>
      <div className="sticky top-0 flex items-center justify-between p-4 rounded-t-3xl bg-bg-tertiary z-5">
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
      <div className="flex flex-col gap-1">
        {patchSets &&
          patchSets.map((patchSet) => {
            return (
              <PatchSetCard
                key={
                  patchSet.moduleFilePath + ":" + patchSet.patchPath.join("/")
                }
                patchSet={patchSet}
              />
            );
          })}
      </div>
    </div>
  );
}

function PatchCard({
  moduleFilePath,
  patchMetadata,
}: {
  moduleFilePath: ModuleFilePath;
  patchMetadata: PatchMetadata;
}) {
  return (
    <PatchOrPatchSetCard
      path={moduleFilePath
        .split("/")
        .map(prettifyFilename)
        .slice(1)
        .concat(patchMetadata.patchPath)}
      changeDescription={patchMetadata.opType}
      avatars={[]}
      isOpen={true}
    />
  );
}

function PatchSetCard({ patchSet }: { patchSet: PatchSetMetadata }) {
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
        path={patchSet.moduleFilePath
          .split("/")
          .map(prettifyFilename)
          .slice(1)
          .concat(patchSet.patchPath)}
        avatars={[]}
        changeDescription={
          patchSet.opTypes.length > 1
            ? "changed"
            : patchSet.opTypes[0] +
              " " +
              new Date(patchSet.lastUpdated).toDateString()
        }
        isOpen={isOpen}
        setOpen={setOpen}
      />
      <AnimateHeight isOpen={isOpen}>
        {patchSet.patches.map((patchMetadata, i) => (
          <PatchCard
            key={
              patchSet.moduleFilePath +
              ":" +
              patchSet.patchPath.join("/") +
              patchMetadata.patchId +
              i
            }
            moduleFilePath={patchSet.moduleFilePath}
            patchMetadata={patchMetadata}
          />
        ))}
      </AnimateHeight>
    </>
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
              path.join("/") + "/"}
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
            {changeDescription && <span>{changeDescription}</span>}
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
