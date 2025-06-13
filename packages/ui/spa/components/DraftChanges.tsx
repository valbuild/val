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
  useValPortal,
  usePatchSets,
  usePublishSummary,
  useAllValidationErrors,
  useAutoPublish,
  useGlobalTransientErrors,
} from "./ValProvider";
import { Checkbox } from "./designSystem/checkbox";
import classNames from "classnames";
import {
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { PatchMetadata, PatchSetMetadata } from "../utils/PatchSets";
import { AnimateHeight } from "./AnimateHeight";
import { relativeLocalDate } from "../utils/relativeLocalDate";
import { Operation } from "@valbuild/core/patch";
import { Button } from "./designSystem/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { PopoverClose } from "@radix-ui/react-popover";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "./designSystem/hover-card";
import { PublishSummary } from "./PublishSummary";
import { ScrollArea } from "./designSystem/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./designSystem/accordion";
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
  const { canGenerate } = usePublishSummary();
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
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60 * 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <div className={classNames("text-sm", className)}>
      {allValidationErrors && validationErrorsCount > 0 && (
        <div className="sticky top-0 border-b border-border-primary bg-bg-error-primary text-text-error-primary z-5">
          <ScrollArea orientation="horizontal">
            <Accordion type="single" className="px-4 font-serif" collapsible>
              <AccordionItem value="error" className="border-b-0">
                <AccordionTrigger className=" data-[state=open]:mb-4 text-text-error-primary border-fg-error-primary ">
                  <div className="flex items-center justify-between w-full ">
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
        <div className="sticky top-0 border-b border-border-primary bg-bg-error-primary text-text-error-primary z-5">
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
                        className="flex items-start justify-between gap-2"
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
      <div className="p-4 z-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
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
          {mode === "http" && (
            <Popover
              open={summaryOpen}
              onOpenChange={(open) => {
                setSummaryOpen(open);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="flex items-center gap-2 text-sm"
                >
                  <span>Summary</span>
                  {canGenerate && <Sparkles size={14} />}
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
          )}
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
      <div className="flex items-center justify-between p-2 font-bold">
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
    <div className="flex items-start justify-between p-2">
      <div className="flex items-start gap-2">
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
        <div className="flex items-start gap-2">
          <span className="text-xs font-light text-text-quartenary">
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
    <div className="text-xs font-light text-text-quartenary">
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
}: {
  patchSet: PatchSetMetadata;
  committedPatchIds: Set<PatchId>;
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
  const { patchErrors, skippedPatches } = useErrors();
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
    return (
      <div
        ref={ref}
        className={classNames("p-6", {
          "bg-bg-secondary": !isOpen,
          "bg-bg-quartenary": isOpen,
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
          {onDelete && !isApplied && (
            <button
              onClick={onDelete}
              title="Revert change"
              className="relative ml-5"
            >
              {amount && (
                <span className="absolute px-2 text-xs rounded-full -top-6 -right-5 bg-bg-quartenary">
                  {amount > 10 ? "10+" : amount}
                </span>
              )}
              <Undo2 size={16} className="inline" />
            </button>
          )}
        </div>
        {errors && errors.length > 0 && !skipped && (
          <div className="p-2 max-w-[240px] bg-bg-error-primary text-text-primary">
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
        {(!errors || errors.length === 0) && skipped && (
          <div className="p-2 max-w-[240px] bg-bg-error-primary text-text-primary">
            <div className="truncate">Skipped</div>
          </div>
        )}
        <div className="flex items-center justify-between pt-2">
          <span className="flex flex-shrink-0 gap-2">
            {authors !== undefined && authors.length > 0 && (
              <span className="flex gap-1 mr-2">
                {authors.slice(0, 2).map((author, i) => {
                  if (author.url) {
                    return (
                      <HoverCard key={author.url}>
                        <HoverCardTrigger className="flex-shrink-0 w-6 h-6 ">
                          <img
                            src={author.url}
                            alt={author.fullName}
                            className={classNames("rounded-full", {
                              "-ml-3": authors.length > 2 && i > 0,
                            })}
                          />
                        </HoverCardTrigger>
                        <HoverCardContent>
                          <div>{author.fullName}</div>
                        </HoverCardContent>
                      </HoverCard>
                    );
                  }
                  const initials = getInitials(author.fullName);
                  return (
                    <HoverCard key={author.fullName + author.url}>
                      <HoverCardTrigger
                        className={classNames({
                          "-ml-3": authors.length > 2 && i > 0,
                        })}
                      >
                        <span
                          className={classNames(
                            "flex items-center justify-center w-6 h-6 text-xs font-semibold rounded-full bg-bg-quartenary text-fg-primary",
                          )}
                          aria-label={"Initials for: " + author.fullName}
                        >
                          {initials}
                        </span>
                      </HoverCardTrigger>
                      <HoverCardContent>
                        <div>{author.fullName}</div>
                      </HoverCardContent>
                    </HoverCard>
                  );
                })}
                {authors.length > 2 && (
                  <HoverCard>
                    <HoverCardTrigger
                      className={classNames({
                        "-ml-3": authors.length > 2,
                      })}
                    >
                      <span className="flex items-center justify-center w-6 h-6 -ml-3 text-xs font-semibold rounded-full bg-bg-quartenary text-fg-primary">
                        +{authors.length - 2}
                      </span>
                    </HoverCardTrigger>
                    <HoverCardContent className="grid grid-cols-[auto,1fr] gap-2">
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
                    </HoverCardContent>
                  </HoverCard>
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
