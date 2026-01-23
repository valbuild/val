import { Internal, ModuleFilePath, PatchId, SourcePath } from "@valbuild/core";
import {
  useState,
  useEffect,
  forwardRef,
  useRef,
  useMemo,
  Fragment,
} from "react";
import {
  LoadingStatus,
  useCommittedPatches,
  useCurrentPatchIds,
  useDeletePatches,
  useDeployments,
  useErrors,
  useProfilesByAuthorId,
  useValMode,
  usePatchSets,
  usePublishSummary,
  useAutoPublish,
  useGlobalTransientErrors,
  useAllPatchErrors,
  useClient,
} from "./ValProvider";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useValPortal } from "./ValPortalProvider";
import { Checkbox } from "./designSystem/checkbox";
import classNames from "classnames";
import {
  Check,
  ChevronDown,
  Download,
  Loader2,
  Sparkles,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { PatchMetadata, PatchSetMetadata } from "../utils/PatchSets";
import { AnimateHeight } from "./AnimateHeight";
import { relativeLocalDate } from "../utils/relativeLocalDate";
import { Operation, deepEqual } from "@valbuild/core/patch";
import { Button } from "./designSystem/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { PopoverClose } from "@radix-ui/react-popover";
import { PublishSummary } from "./PublishSummary";
import { ScrollArea } from "./designSystem/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./designSystem/accordion";
import * as RadixAccordion from "@radix-ui/react-accordion";
import { ValEnrichedDeployment } from "../utils/mergeCommitsAndDeployments";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";
import { TooltipPortal } from "@radix-ui/react-tooltip";
import { ValPath } from "./ValPath";

export function DraftChanges({
  className,
  loadingStatus,
}: {
  className?: string;
  loadingStatus: LoadingStatus;
}) {
  const currentPatchIds = useCurrentPatchIds();
  const mode = useValMode();
  const committedPatchIds = useCommittedPatches();
  const serializedPatchSets = usePatchSets();
  const portalContainer = useValPortal();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const { canGenerate, generateSummary, setSummary, summary } =
    usePublishSummary();
  const allValidationErrors = useAllValidationErrors();
  const { autoPublish } = useAutoPublish();
  const validationErrorsCount = useMemo(() => {
    let count = 0;
    for (const sourcePathS in allValidationErrors) {
      const sourcePath = sourcePathS as SourcePath;
      count += allValidationErrors[sourcePath]?.length || 0;
    }
    return count;
  }, [allValidationErrors]);
  const pendingChanges = currentPatchIds.length - committedPatchIds.size;
  const { deployments, dismissDeployment, observedCommitShas } =
    useDeployments();
  const { globalTransientErrors, removeGlobalTransientErrors } =
    useGlobalTransientErrors();
  const { patchErrors } = useAllPatchErrors();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60 * 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);
  const { deletePatches } = useDeletePatches();
  const client = useClient();
  const downloadReport = async (
    moduleFilePath: ModuleFilePath | string,
    patchId: PatchId | string,
    error: string,
  ) => {
    const patchRes = await client("/patches", "GET", {
      query: {
        patch_id: [patchId as PatchId],
        exclude_patch_ops: false,
      },
    });
    if (patchRes.status === 200) {
      const json = patchRes.json;
      const fileName = `val-patch-error-report-${moduleFilePath.replace("/", "__").replace(/\.val\./, "-")}-${patchId}.json`;
      const blob = new Blob(
        [
          JSON.stringify(
            {
              moduleFilePath,
              patchId,
              error,
              patch: json,
            },
            null,
            2,
          ),
        ],
        {
          type: "application/json",
        },
      );
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
    } else {
      alert("Failed to download report");
    }
  };

  return (
    <div className={classNames("text-sm", className)}>
      {patchErrors &&
        Object.values(patchErrors).some((errors) => errors !== null) && (
          <div className="sticky top-0 border-b border-border-primary bg-bg-error-primary text-fg-error-primary z-5">
            <div className="flex flex-col gap-4 p-4">
              <div className="px-4 text-pretty">
                <div>Unfortunately, one or more changes have errors.</div>
                <div>No changes can currently be applied.</div>
              </div>
              {Object.entries(patchErrors).map(
                ([moduleFilePath, errors], i) => (
                  <div key={moduleFilePath + "#" + i} className="pb-4">
                    <ScrollArea
                      orientation="horizontal"
                      className="max-w-[280px] text-pretty text-xs"
                    >
                      {errors &&
                        Object.entries(errors).map(([patchId, error], j) => (
                          <RadixAccordion.Root
                            key={j}
                            className="grid grid-cols-2 gap-2"
                            type="single"
                            collapsible
                          >
                            <RadixAccordion.AccordionItem value={patchId}>
                              <div>
                                <Button
                                  variant="destructive"
                                  onClick={() => {
                                    deletePatches([patchId as PatchId]);
                                  }}
                                >
                                  <span className="flex gap-2 justify-between items-center text-left">
                                    <span>Remove change and fix issue</span>
                                  </span>
                                </Button>
                              </div>

                              <RadixAccordion.AccordionTrigger
                                asChild
                                className="group"
                              >
                                <Button variant="destructive">
                                  <span className="text-left truncate group-data-[state=open]:hidden">
                                    Report
                                  </span>
                                  <span className="text-left truncate group-data-[state=open]:block hidden">
                                    Hide
                                  </span>
                                </Button>
                              </RadixAccordion.AccordionTrigger>
                              <RadixAccordion.AccordionContent>
                                <Button
                                  variant="destructive"
                                  onClick={() => {
                                    downloadReport(
                                      moduleFilePath,
                                      patchId,
                                      error.message,
                                    );
                                  }}
                                >
                                  <span className="flex gap-2 justify-between items-center text-left">
                                    <span>Download debug report</span>
                                    <Download size={14} />
                                  </span>
                                </Button>
                                <div className="p-4">
                                  <div className="font-bold">Details</div>
                                  <div>Module file path</div>
                                  <div>
                                    <ValidationErrorValPath
                                      sourcePath={moduleFilePath as SourcePath}
                                    />
                                  </div>
                                  <div>Error message</div>
                                  <pre>{error.message}</pre>
                                </div>
                              </RadixAccordion.AccordionContent>
                            </RadixAccordion.AccordionItem>
                          </RadixAccordion.Root>
                        ))}
                    </ScrollArea>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      {allValidationErrors && validationErrorsCount > 0 && (
        <div className="sticky top-0 border-b border-border-primary bg-bg-error-primary text-fg-error-primary z-5">
          <ScrollArea orientation="horizontal">
            <Accordion type="single" className="px-4 font-serif" collapsible>
              <AccordionItem value="error" className="border-b-0">
                <AccordionTrigger className=" data-[state=open]:mb-4 text-fg-error-primary border-fg-error-primary ">
                  <div className="flex justify-between items-center w-full">
                    <div>
                      {validationErrorsCount} validation issue
                      {validationErrorsCount > 1 ? "s" : ""}
                    </div>
                    <TriangleAlert size={16} />
                  </div>
                </AccordionTrigger>
                <AccordionContent className="">
                  <div className="flex flex-col gap-4">
                    {Object.entries(allValidationErrors).map(
                      ([sourcePath, errors], i) => (
                        <div key={sourcePath + "#" + i} className="pb-4">
                          <div className="items-start text-left">
                            <ValidationErrorValPath sourcePath={sourcePath} />
                          </div>
                          <div>
                            <ScrollArea
                              orientation="horizontal"
                              className="max-w-[280px] text-pretty text-xs"
                            >
                              {errors?.map((error, j) => (
                                <div key={j} className="">
                                  <div>{error.message}</div>
                                </div>
                              ))}
                            </ScrollArea>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </ScrollArea>
        </div>
      )}
      {globalTransientErrors && globalTransientErrors.length > 0 && (
        <div className="sticky top-0 border-b border-border-primary bg-bg-error-primary text-fg-error-primary z-5">
          <ScrollArea orientation="horizontal">
            <Accordion type="single" className="px-4 font-serif" collapsible>
              <AccordionItem
                value="error"
                className="border-b-0 data-[state=open]:mb-4"
              >
                <AccordionTrigger>
                  {globalTransientErrors.length} transient error
                  {globalTransientErrors.length > 1 ? "s" : ""}
                </AccordionTrigger>
                <AccordionContent className="w-full">
                  <div className="flex flex-col gap-2">
                    {globalTransientErrors.map((error) => (
                      <div
                        key={error.id}
                        className="flex gap-2 justify-between items-start"
                      >
                        <div className="flex flex-col gap-1">
                          <div className="font-bold">{error.message}</div>
                          {error.details && <div>{error.details}</div>}
                          <div className="text-[10px] font-thin">
                            {relativeLocalDate(
                              now,
                              new Date(error.timestamp).toISOString(),
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            removeGlobalTransientErrors([error.id])
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </ScrollArea>
        </div>
      )}
      {deployments.length > 0 && (
        <div className="p-4 border-b border-border-primary">
          <Deployments
            deployments={deployments}
            observedCommitShas={observedCommitShas}
            onDismiss={dismissDeployment}
          />
        </div>
      )}
      {mode === "http" && (
        <div className="flex justify-end items-center p-4 border-b z-5 border-border-primary">
          <Popover
            open={summaryOpen}
            onOpenChange={(open) => {
              setSummaryOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                className="flex gap-2 items-center text-sm"
                onClick={() => {
                  // Auto-generate summary if:
                  // 1. No summary exists, OR
                  // 2. Summary is AI-generated and patches have changed
                  const isStaleAiSummary =
                    summary.type === "ai" &&
                    !deepEqual(summary.patchIds, currentPatchIds);

                  if (
                    canGenerate &&
                    (summary.type === "not-asked" || isStaleAiSummary)
                  ) {
                    const timeoutPromise = new Promise<{ type: "timeout" }>(
                      (resolve) =>
                        setTimeout(() => resolve({ type: "timeout" }), 20000),
                    );

                    Promise.race([generateSummary(), timeoutPromise]).then(
                      (result) => {
                        if (result.type === "timeout") {
                          console.warn(
                            "Val: Summary generation timed out after 20s",
                          );
                        } else if (result.type === "ai") {
                          setSummary({ type: "ai", text: result.text.trim() });
                        } else if (result.type === "error") {
                          console.warn(
                            "Val: Summary generation failed:",
                            result.message,
                          );
                        }
                      },
                    );
                  }
                }}
              >
                <span>
                  {summary.isGenerating ? "Generating..." : "Summary"}
                </span>
                {canGenerate && !summary.isGenerating && <Sparkles size={14} />}
                {summary.isGenerating && (
                  <Loader2 size={14} className="animate-spin" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              container={portalContainer}
              align="end"
              className="z-[9001] flex flex-col gap-4"
            >
              <PopoverClose asChild className="self-end cursor-pointer">
                <X size={12} />
              </PopoverClose>
              <PublishSummary
                onClose={() => {
                  setSummaryOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      )}
      <div className="p-4 z-5">
        <div className="flex justify-between items-center">
          <div className="flex gap-2 items-center">
            <div className="font-bold">
              {pendingChanges <= 0 ? "No " : `${pendingChanges} `}
              pending change
              {pendingChanges === 1 ? "" : "s"}
            </div>
            {(loadingStatus === "loading" || loadingStatus === "not-asked") && (
              <div className="">
                <Loader2 size={16} className="animate-spin" />
              </div>
            )}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                disabled={currentPatchIds.length === 0}
                variant="secondary"
                className="flex gap-2 items-center text-sm"
              >
                <span>Undo all</span>
                <Undo2 size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent container={portalContainer} className="z-[9001]">
              <div className="flex flex-col gap-4">
                <div className="text-lg font-bold">Are you sure?</div>
                <div>This will undo all changes to the current state.</div>
                <div>
                  <PopoverClose asChild>
                    <Button
                      variant="destructive"
                      className="flex gap-2 items-center text-sm"
                      onClick={() => {
                        deletePatches(currentPatchIds);
                      }}
                    >
                      <span>Undo all changes</span>
                      <Undo2 size={14} />
                    </Button>
                  </PopoverClose>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {(!autoPublish || validationErrorsCount > 0) && (
        <div className="flex flex-col gap-[2px]">
          {"data" in serializedPatchSets &&
            currentPatchIds.length > 0 &&
            serializedPatchSets.data.map((patchSet) => {
              return (
                <PatchSetCard
                  key={
                    patchSet.moduleFilePath + ":" + patchSet.patchPath.join("/")
                  }
                  committedPatchIds={committedPatchIds}
                  patchSet={patchSet}
                  patchErrors={patchErrors?.[patchSet.moduleFilePath] ?? {}}
                />
              );
            })}
        </div>
      )}
    </div>
  );
}

function ValidationErrorValPath({
  sourcePath,
}: {
  sourcePath: SourcePath | string;
}) {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);
  const patchPath = Internal.splitModulePath(modulePath);
  return <ValPath moduleFilePath={moduleFilePath} patchPath={patchPath} />;
}

function Deployments({
  deployments,
  observedCommitShas,
  onDismiss,
}: {
  deployments: ValEnrichedDeployment[];
  observedCommitShas: Set<string>;
  onDismiss: (commitSha: string) => void;
}) {
  useEffect(() => {
    for (const deployment of deployments) {
      if (observedCommitShas.has(deployment.commitSha)) {
        setTimeout(() => {
          onDismiss(deployment.commitSha);
        }, 5000);
      }
    }
  }, [deployments, observedCommitShas]);
  return (
    <div>
      <div className="flex justify-between items-center p-2 font-bold">
        <span>Deployments</span>
        <Loader2 size={16} className="inline animate-spin" />
      </div>
      <div>
        {deployments.reverse().map((deployment) => {
          return (
            <Deployment
              key={deployment.commitSha}
              deployment={deployment}
              isFinished={observedCommitShas.has(deployment.commitSha)}
              onDismiss={() => {
                onDismiss(deployment.commitSha);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function Deployment({
  deployment,
  isFinished,
  onDismiss,
}: {
  deployment: ValEnrichedDeployment;
  isFinished: boolean;
  onDismiss: () => void;
}) {
  const profilesById = useProfilesByAuthorId();
  const portalContainer = useValPortal();
  const author = deployment.creator && profilesById[deployment.creator];
  return (
    <div className="flex justify-between items-start p-2">
      <div className="flex gap-2 items-start">
        {author && (
          <img
            src={author.avatar?.url}
            alt={author.fullName}
            className="w-8 h-8 rounded-full"
          />
        )}

        <Tooltip>
          <TooltipPortal container={portalContainer} />
          <TooltipTrigger>
            <div className="max-w-[180px] overflow-clip font-light truncate">
              {deployment.commitMessage}
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[320px]">
            <pre className="font-sans font-light whitespace-break-spaces">
              {deployment.commitMessage}
            </pre>
          </TooltipContent>
        </Tooltip>
      </div>
      {isFinished && (
        <div className="flex gap-2 items-start">
          <span className="text-xs font-light text-fg-quaternary">
            Deployed
          </span>
          <button
            onClick={() => {
              onDismiss();
            }}
          >
            <Check size={14} />
          </button>
        </div>
      )}
      {!isFinished && <TimeSpent since={new Date(deployment.createdAt)} />}
    </div>
  );
}

function TimeSpent({ since }: { since: Date }) {
  const [minutes, setMinutes] = useState("00");
  const [seconds, setSeconds] = useState<string | null>("00");
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const updateTime = () => {
      const now = Date.now();
      const diff = Math.floor((now - since.getTime()) / 1000);
      const minutes = Math.floor(diff / 60);
      const seconds = diff % 60;
      let nextCheck: number;
      if (minutes > 4) {
        // every minute:
        nextCheck = (60 - seconds) * 1000;
        setMinutes(minutes.toString());
        setSeconds(null);
      } else {
        // every second::
        nextCheck = 1000;
        setMinutes(minutes.toString().padStart(2, "0"));
        setSeconds(seconds.toString().padStart(2, "0"));
      }
      timeout = setTimeout(updateTime, nextCheck);
    };
    updateTime();
    return () => {
      clearTimeout(timeout);
    };
  }, [since]);
  return (
    <div className="text-xs font-light text-fg-quaternary">
      {minutes}
      {seconds !== null ? `:${seconds}` : " mins"}
    </div>
  );
}

function PatchCard({
  moduleFilePath,
  patchMetadata,
  committedPatchIds,
}: {
  moduleFilePath: ModuleFilePath;
  patchMetadata: PatchMetadata;
  committedPatchIds: Set<PatchId>;
}) {
  const changeDescription = useChangeDescription(
    [patchMetadata.opType],
    patchMetadata.createdAt,
    committedPatchIds.has(patchMetadata.patchId),
  );
  const profilesById = useProfilesByAuthorId();
  const { skippedPatches } = useErrors();
  const errors = undefined; // TODO
  const [skipped] = useMemo(
    () => [!!skippedPatches[patchMetadata.patchId]] as const,
    [patchMetadata.patchId, skippedPatches[patchMetadata.patchId]],
  );
  const mode = useValMode();
  let authors: {
    url: string | null;
    fullName: string;
  }[] = [];
  if (patchMetadata.author) {
    const profile = profilesById[patchMetadata.author];
    if (profile) {
      const url = profile?.avatar?.url ?? null;
      authors = [
        {
          fullName: profile.fullName,
          url,
        },
      ];
    } else {
      console.warn("Did not find profile for author: ", patchMetadata.author, {
        profilesById,
      });
    }
  }
  if (authors.length === 0 && mode === "http") {
    console.warn("No authors", { patchMetadata });
  }
  return (
    <PatchOrPatchSetCard
      moduleFilePath={moduleFilePath}
      patchPath={patchMetadata.patchPath}
      changeDescription={skipped ? "Skipped" : changeDescription}
      authors={authors}
      errors={errors}
      skipped={skipped}
      isApplied={committedPatchIds.has(patchMetadata.patchId)}
    />
  );
}

function useChangeDescription(
  opTypes: string[],
  lastUpdated: string,
  isCommitted: boolean,
) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60 * 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);
  if (isCommitted) {
    return "Pushed " + relativeLocalDate(now, lastUpdated);
  }
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

function PatchSetCard({
  patchSet,
  committedPatchIds,
  patchErrors,
}: {
  patchSet: PatchSetMetadata;
  committedPatchIds: Set<PatchId>;
  patchErrors: Record<PatchId, { message: string }> | null;
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
      { threshold: 0 },
    );
    if (ref.current) {
      observer.observe(ref.current);
    }
    return () => {
      observer.disconnect();
    };
  }, []);
  const { skippedPatches } = useErrors();
  const { deletePatches } = useDeletePatches();
  const patchIds = useMemo(
    () => patchSet.patches.map((p) => p.patchId),
    [
      patchSet.patches.map((p) => p.patchId).join(","), // ugly
    ],
  );
  const errors = useMemo(() => {
    const errors: string[] = [];
    for (const patchId of patchIds) {
      const patchError = patchErrors?.[patchId];
      if (!skippedPatches[patchId] && patchError) {
        errors.unshift(patchError.message);
      }
    }
    return errors;
  }, [patchIds, patchErrors, skippedPatches]);
  const changeDescription = useChangeDescription(
    patchSet.opTypes,
    patchSet.lastUpdated,
    false,
  );
  const profilesById = useProfilesByAuthorId();

  const isApplied = patchSet.patches.every((patch) =>
    committedPatchIds.has(patch.patchId),
  );
  if (!hasBeenSeen) {
    return <PatchOrPatchSetCard ref={ref} isApplied={isApplied} />;
  }
  return (
    <>
      <PatchOrPatchSetCard
        moduleFilePath={patchSet.moduleFilePath}
        patchPath={patchSet.patchPath}
        isApplied={isApplied}
        authors={patchSet.authors
          .reduce((prev, curr) => {
            if (prev.includes(curr)) {
              return prev;
            }
            return prev.concat(curr);
          }, [] as string[])
          .flatMap((authorId) => {
            const profile = profilesById[authorId];
            if (profile) {
              const url = profile?.avatar?.url ?? null;
              return [
                {
                  fullName: profile.fullName,
                  url,
                },
              ];
            }
            return [];
          })}
        changeDescription={changeDescription}
        isOpen={isOpen}
        setOpen={setOpen}
        errors={errors}
        onDelete={() => {
          deletePatches(
            patchIds.filter((patchId) => !committedPatchIds.has(patchId)),
          );
        }}
        amount={new Set(patchIds).size}
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
            committedPatchIds={committedPatchIds}
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
    moduleFilePath?: ModuleFilePath;
    patchPath?: string[];
    changeDescription?: string;
    authors?: { url: string | null; fullName: string }[];
    isOpen?: boolean;
    setOpen?: (isOpen: boolean) => void;
    isSelected?: boolean;
    setSelected?: (isSelected: boolean | "indeterminate") => void;
    errors?: string[];
    skipped?: boolean;
    onDelete?: () => void;
    amount?: number;
    isApplied: boolean;
  }
>(
  (
    {
      moduleFilePath,
      patchPath,
      changeDescription,
      authors,
      isOpen,
      setOpen,
      isSelected,
      setSelected,
      errors,
      skipped,
      onDelete,
      amount,
      isApplied,
    },
    ref,
  ) => {
    const portalContainer = useValPortal();
    return (
      <div
        ref={ref}
        className={classNames("p-6", {
          "bg-bg-secondary": !isOpen,
          "bg-bg-tertiary": isOpen,
          "opacity-50": isApplied,
        })}
      >
        <div className="relative">
          <span className="inline-block w-[calc(320px-24px-8px-16px-24px-48px)] truncate mr-2 ">
            {moduleFilePath && patchPath && (
              <ValPath
                moduleFilePath={moduleFilePath}
                patchPath={patchPath}
                link
                toolTip
              />
            )}
          </span>
          {isSelected === undefined && (
            <span
              className={classNames("inline-block w-6 h-6 rounded", {
                "bg-bg-disabled animate-pulse": patchPath === undefined,
              })}
            ></span>
          )}
          {isSelected !== undefined && !isApplied && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => {
                if (setSelected) {
                  setSelected(checked);
                }
              }}
            />
          )}
          <div className="inline relative ml-5">
            {amount && (
              <Tooltip>
                <TooltipTrigger>
                  <span className="absolute -right-5 -top-6 w-6 h-6 text-xs leading-6 text-center rounded-full bg-bg-primary text-fg-primary">
                    {amount > 9 ? "9+" : amount}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>
                    {amount} change{amount > 1 ? "s" : ""} in this patch set
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
            {onDelete && !isApplied && amount && amount > 0 && (
              <Popover>
                <PopoverTrigger>
                  <Undo2 size={16} className="inline" />
                </PopoverTrigger>
                <PopoverContent
                  container={portalContainer}
                  className="flex flex-col gap-2 z-[9001]"
                >
                  <div className="text-lg font-bold">Are you sure?</div>
                  <div>
                    This will undo {amount} change
                    {amount > 1 ? "s" : ""}.
                  </div>
                  <div>
                    <PopoverClose asChild>
                      <Button variant="destructive" onClick={onDelete}>
                        Undo change
                        {amount > 1 ? "s" : ""}
                      </Button>
                    </PopoverClose>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
        {errors && errors.length > 0 && !skipped && (
          <div className="p-2 max-w-[240px] bg-bg-error-primary text-fg-primary rounded-lg">
            {errors.slice(0, 1).map((error, i) => (
              <div key={i} title={error} className="truncate">
                Invalid change
              </div>
            ))}
            {errors.length > 1 && (
              <div className="truncate">+{errors.length - 1} more</div>
            )}
          </div>
        )}
        {(!errors || errors.length === 0) && skipped && (
          <div className="p-2 max-w-[240px] bg-bg-error-primary text-fg-primary">
            <div className="truncate">Skipped</div>
          </div>
        )}
        <div className="flex justify-between items-center pt-2">
          <span className="flex flex-shrink-0 gap-2">
            {authors !== undefined && authors.length > 0 && (
              <span className="flex gap-1 mr-2">
                {authors.slice(0, 2).map((author, i) => {
                  if (author.url) {
                    return (
                      <Tooltip key={author.url}>
                        <TooltipTrigger className="flex-shrink-0 w-6 h-6">
                          <img
                            src={author.url}
                            alt={author.fullName}
                            className={classNames("rounded-full", {
                              "-ml-3": authors.length > 2 && i > 0,
                            })}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <div>{author.fullName}</div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  const initials = getInitials(author.fullName);
                  return (
                    <Tooltip key={author.fullName + author.url}>
                      <TooltipTrigger
                        className={classNames({
                          "-ml-3": authors.length > 2 && i > 0,
                        })}
                      >
                        <span
                          className={classNames(
                            "flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full bg-bg-primary text-fg-primary",
                          )}
                          aria-label={"Initials for: " + author.fullName}
                        >
                          {initials}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div>{author.fullName}</div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {authors.length > 2 && (
                  <Tooltip>
                    <TooltipTrigger
                      className={classNames({
                        "-ml-3": authors.length > 2,
                      })}
                    >
                      <span className="flex justify-center items-center -ml-3 w-6 h-6 text-xs font-semibold rounded-full bg-bg-primary text-fg-primary">
                        +{authors.length - 2}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="grid grid-cols-[auto,1fr] gap-2">
                      {authors.slice(2).map((author) => {
                        return (
                          <Fragment key={author.fullName + author.url}>
                            {author.url ? (
                              <img
                                key={author.url}
                                src={author.url}
                                alt={author.fullName}
                                title={author.fullName}
                                className={classNames("w-6 h-6 rounded-full")}
                              />
                            ) : (
                              <div />
                            )}
                            <div>{author.fullName}</div>
                          </Fragment>
                        );
                      })}
                    </TooltipContent>
                  </Tooltip>
                )}
              </span>
            )}
            {authors === undefined && (
              <span
                className={classNames("inline-block w-6 h-6 mr-2", {
                  "bg-bg-disabled animate-pulse rounded-3xl":
                    authors === undefined,
                })}
              ></span>
            )}
            {changeDescription && (
              <span className={classNames({ "text-fg-disabled": skipped })}>
                {changeDescription}
              </span>
            )}
          </span>
          {isOpen !== undefined && (
            <button
              className="inline-block flex-shrink-0"
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

// Thanks ChatGPT
function getInitials(fullName: string): string {
  if (!fullName || typeof fullName !== "string") {
    return "";
  }

  // Normalize the input, trim whitespace, and split by Unicode word boundaries
  const nameParts = fullName
    .trim()
    .normalize("NFC") // Normalize to canonical form
    .split(/\s+/) // Split by whitespace

    .filter((part) => part.length > 0); // Remove empty strings

  // Handle each part
  const initials = nameParts.map((part) => {
    // Special handling for CJK (first character of each part)
    if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
        part,
      )
    ) {
      return part[0];
    }
    // Latin and other scripts (use first letter)
    return part[0].toLocaleUpperCase();
  });

  // Join and return initials
  return initials.join("");
}
