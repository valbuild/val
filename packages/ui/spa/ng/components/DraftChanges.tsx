import { ModuleFilePath, PatchId } from "@valbuild/core";
import { useState, useEffect, forwardRef, useRef, useMemo } from "react";
import {
  LoadingStatus,
  useCurrentPatchIds,
  useDeletePatches,
  useErrors,
  useGetPatches,
  useSchemas,
  useSchemaSha,
} from "../ValProvider";
import { Checkbox } from "../../components/ui/checkbox";
import classNames from "classnames";
import { prettifyFilename } from "../../utils/prettifyFilename";
import { ChevronDown, Clock } from "lucide-react";
import {
  PatchMetadata,
  PatchSetMetadata,
  PatchSets,
  SerializedPatchSet,
} from "../PatchSets";
import { AnimateHeight } from "./AnimateHeight";
import { relativeLocalDate } from "../../utils/relativeLocalDate";
import { Operation } from "@valbuild/core/patch";
import { Remote } from "../../utils/Remote";

export function DraftChanges({
  className,
  loadingStatus,
}: {
  className?: string;
  loadingStatus: LoadingStatus;
}) {
  const { getPatches } = useGetPatches();
  const schemasRes = useSchemas();
  const schemaSha = useSchemaSha();
  const patchIds = useCurrentPatchIds();
  // refs:
  const patchSetsSchemaShaRef = useRef<string | null>(null);
  const patchSetsRef = useRef<PatchSets | null>(null);
  const requestedPatchIdsRef = useRef<PatchId[]>([]);
  // patch set state:
  const [patchSetsError, setPatchSetsError] = useState<string | null>(null);
  const [serializedPatchSets, setSerializedPatchSets] = useState<
    Remote<SerializedPatchSet>
  >({
    status: "not-asked",
  });
  const prevInsertedPatchesRef = useRef<Set<PatchId>>(new Set());
  useEffect(() => {
    async function load() {
      if (patchSetsSchemaShaRef.current !== schemaSha) {
        // Reset if schema changes
        patchSetsRef.current = new PatchSets();
        prevInsertedPatchesRef.current = new Set();
      }
      patchSetsSchemaShaRef.current = schemaSha ?? null;
      if (!patchSetsRef.current) {
        // Initialize if not already
        patchSetsRef.current = new PatchSets();
        prevInsertedPatchesRef.current = new Set();
      }
      // Only request patches that are not already inserted
      const requestPatchIds: PatchId[] = [];
      for (const patchId of patchIds) {
        if (!prevInsertedPatchesRef.current.has(patchId)) {
          requestPatchIds.push(patchId);
        }
      }
      // Reset if previous patches are not in the current patchIds
      for (const patchId of Array.from(
        // TODO: guessing Array.from(set.values()) is slow for large sets?
        prevInsertedPatchesRef.current.values(),
      )) {
        if (!patchIds.includes(patchId)) {
          patchSetsRef.current = new PatchSets();
          break;
        }
      }
      if (patchIds.length > 0 && requestPatchIds.length === 0) {
        return;
      }
      if (schemasRes.status === "error") {
        setPatchSetsError(schemasRes.error);
        return;
      }
      if (!("data" in schemasRes)) {
        return;
      }
      const patchSets = patchSetsRef.current;
      const schemas = schemasRes.data;
      requestedPatchIdsRef.current = requestPatchIds;
      setPatchSetsError(null);
      const res = await getPatches(
        patchIds.length === requestPatchIds.length
          ? [] // all patchIds are requested so avoid sending a large GET request
          : (requestPatchIds as PatchId[]),
      );
      // skip if requested have have changed since the request was made
      if (
        requestedPatchIdsRef.current.length !== requestPatchIds.length ||
        requestedPatchIdsRef.current.some(
          (id, i) => id !== requestPatchIds[i],
        ) ||
        patchSetsSchemaShaRef.current !== schemaSha
      ) {
        return;
      }
      if (res.status === "ok") {
        const patches = res.data;
        for (const [patchIdS, patchMetadata] of Object.entries(patches)) {
          const patchId = patchIdS as PatchId;
          if (patchMetadata) {
            for (const op of patchMetadata.patch || []) {
              const moduleFilePath = patchMetadata.path;
              const schema = schemas[moduleFilePath];
              prevInsertedPatchesRef.current.add(patchId);
              patchSets.insert(
                patchMetadata.path,
                schema,
                op,
                patchId,
                patchMetadata.createdAt,
                patchMetadata.authorId,
              );
            }
          }
        }
        setSerializedPatchSets({
          status: "success",
          data: patchSets.serialize(),
        });
      } else {
        setPatchSetsError(res.error);
      }
    }
    load().catch((err) => {
      setPatchSetsError(err.message);
    });
  }, [patchIds, getPatches, schemasRes, schemaSha]);

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
      {patchSetsError !== null && (
        <div className="p-4 bg-bg-tertiary text-text-error-primary">
          {patchSetsError}
        </div>
      )}
      <div className="flex flex-col gap-[2px]">
        {"data" in serializedPatchSets &&
          serializedPatchSets.data.map((patchSet) => {
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
  const changeDescription = useChangeDescription(
    [patchMetadata.opType],
    patchMetadata.createdAt,
  );
  const { patchErrors, skippedPatches } = useErrors();
  const [errors, skipped] = useMemo(
    () =>
      [
        patchErrors[patchMetadata.patchId] || [],
        !!skippedPatches[patchMetadata.patchId],
      ] as const,
    [
      patchMetadata.patchId,
      patchErrors[patchMetadata.patchId],
      skippedPatches[patchMetadata.patchId],
    ],
  );
  return (
    <PatchOrPatchSetCard
      path={moduleFilePath
        .split("/")
        .map(prettifyFilename)
        .slice(1)
        .concat(patchMetadata.patchPath)}
      changeDescription={skipped ? "Skipped" : changeDescription}
      avatars={[]}
      isOpen={true}
      errors={errors}
      skipped={skipped}
    />
  );
}

function useChangeDescription(opTypes: string[], lastUpdated: string) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60 * 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);
  if (opTypes.length > 1) {
    return "Updated" + " " + relativeLocalDate(now, lastUpdated);
  }
  const firstOp = opTypes[0] as Operation["op"];
  let changeType: string = firstOp;
  if (firstOp === "add") {
    changeType = "Added";
  } else if (firstOp === "remove") {
    changeType = "Removed";
  } else if (firstOp === "replace") {
    changeType = "Replaced";
  } else if (firstOp === "move") {
    changeType = "Moved";
  } else if (firstOp === "copy") {
    changeType = "Copied";
  } else if (firstOp === "test") {
    changeType = "Tested";
  } else if (firstOp === "file") {
    changeType = "Updated";
  } else {
    const exhaustiveCheck: never = firstOp;
    console.warn("Unexpected op type: ", exhaustiveCheck);
  }
  return changeType + " " + relativeLocalDate(now, lastUpdated);
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
      { threshold: 0 },
    );
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => {
      observer.disconnect();
    };
  }, []);
  const { patchErrors, skippedPatches } = useErrors();
  const { deletePatches } = useDeletePatches();
  const patchIds = useMemo(
    () => patchSet.patches.map((p) => p.patchId),
    [patchSet.patches],
  );
  const errors = useMemo(() => {
    const errors: string[] = [];
    for (const patchId of patchIds) {
      for (const patchError of patchErrors[patchId] || []) {
        if (!skippedPatches[patchId]) {
          errors.unshift(patchError);
        }
      }
    }
    return errors;
  }, [patchIds, patchErrors, skippedPatches]);
  const changeDescription = useChangeDescription(
    patchSet.opTypes,
    patchSet.lastUpdated,
  );

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
        changeDescription={changeDescription}
        isOpen={isOpen}
        setOpen={setOpen}
        errors={errors}
        onDelete={
          errors && errors.length > 0
            ? () => {
                deletePatches(patchIds);
              }
            : undefined
        }
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
    errors?: string[];
    skipped?: boolean;
    onDelete?: () => void;
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
      errors,
      skipped,
      onDelete,
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
            title={path?.join("/") + "/"}
            className={classNames(
              "inline-block w-[calc(320px-24px-8px-16px-24px-48px)] truncate overflow-y-hidden h-6 mr-2 text-left",
              {
                "animate-pulse bg-bg-disabled rounded-3xl": path === undefined,
                "text-text-disabled": skipped,
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
        {errors && errors.length > 0 && !skipped && (
          <div className="p-2 max-w-[240px] rounded bg-bg-error-primary text-text-primary">
            {errors.slice(0, 1).map((error, i) => (
              <div key={i} title={error} className="truncate">
                {error}
              </div>
            ))}
            {errors.length > 1 && (
              <div className="truncate">+{errors.length - 1} more</div>
            )}
          </div>
        )}
        {onDelete && <button onClick={onDelete}>Delete</button>}
        <div className="flex items-center justify-between pt-2">
          <span className="flex-shrink-0">
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
            {changeDescription && (
              <span className={classNames({ "text-text-disabled": skipped })}>
                {changeDescription}
              </span>
            )}
          </span>
          {isOpen !== undefined && (
            <button
              className="flex-shrink-0 inline-block"
              onClick={() => {
                if (setOpen) {
                  setOpen(!isOpen);
                }
              }}
            >
              <ChevronDown
                size={16}
                className={classNames("transform", {
                  "rotate-180": isOpen,
                })}
              />
            </button>
          )}
        </div>
      </div>
    );
  },
);
