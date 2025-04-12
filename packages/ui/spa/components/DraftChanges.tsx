import { ModuleFilePath, PatchId, SourcePath } from "@valbuild/core";
import {
  useState,
  useEffect,
  forwardRef,
  useRef,
  useMemo,
  Fragment,
} from "react";
import {
  Deployment,
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
} from "./ValProvider";
import { Checkbox } from "./designSystem/checkbox";
import classNames from "classnames";
import { prettifyFilename } from "../utils/prettifyFilename";
import { ChevronDown, Loader2, Sparkles, Undo2, X } from "lucide-react";
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
import { useNavigation } from "./ValRouter";

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
  const { deployments, dismissDeployment } = useDeployments();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const { canGenerate } = usePublishSummary();
  const allValidationErrors = useAllValidationErrors();
  const validationErrorsCount = useMemo(() => {
    let count = 0;
    for (const sourcePathS in allValidationErrors) {
      const sourcePath = sourcePathS as SourcePath;
      count += allValidationErrors[sourcePath]?.length || 0;
    }
    return count;
  }, [allValidationErrors]);
  const pendingChanges = currentPatchIds.length - committedPatchIds.size;

  // TODO: remove test data
  // const deployments: Deployment[] = [
  //   {
  //     deploymentId: "1",
  //     deploymentState: "success",
  //     createdAt: new Date().toISOString(),
  //     updatedAt: new Date().toISOString(),
  //   },
  //   {
  //     deploymentId: "2",
  //     deploymentState: "pending",
  //     createdAt: new Date().toISOString(),
  //     updatedAt: new Date().toISOString(),
  //   },
  //   {
  //     deploymentId: "3",
  //     deploymentState: "failure",
  //     createdAt: new Date().toISOString(),
  //     updatedAt: new Date().toISOString(),
  //   },
  // ];
  const [isDeploymentsExpanded, setIsDeploymentsExpanded] = useState(false);
  const navigation = useNavigation();
  return (
    <div className={classNames("text-sm", className)}>
      {deployments.length > 0 && (
        <div className="p-4 border-b border-border-primary">
          <div className="flex flex-col gap-2">
            {deployments
              .slice() // slice because sort mutates
              .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
              .slice(0, isDeploymentsExpanded ? undefined : 2)
              .map((deployment) => (
                <DeploymentCard
                  key={deployment.deploymentId}
                  deployment={deployment}
                  onDismiss={() => {
                    dismissDeployment(deployment.deploymentId);
                  }}
                />
              ))}
          </div>
          {deployments.length > 2 && !isDeploymentsExpanded && (
            <div className="flex items-center justify-center mt-4">
              <button
                className="p-2 text-xs border rounded border-border-primary"
                onClick={() => {
                  setIsDeploymentsExpanded(true);
                }}
              >
                View all deployments
              </button>
            </div>
          )}
        </div>
      )}

      {allValidationErrors && validationErrorsCount > 0 && (
        <div className="text-white border-b border-border-primary bg-bg-error-primary ">
          <ScrollArea orientation="horizontal">
            <Accordion type="single" className="px-4 font-serif" collapsible>
              <AccordionItem
                value="error"
                className="border-b-0 data-[state=open]:mb-4"
              >
                <AccordionTrigger>
                  {validationErrorsCount} validation error
                  {validationErrorsCount > 1 ? "s" : ""}
                </AccordionTrigger>
                <AccordionContent className="w-full">
                  <div className="flex flex-col gap-2">
                    <Accordion type="multiple" className="w-full">
                      {Object.entries(allValidationErrors).map(
                        ([sourcePath, errors], i) => (
                          <AccordionItem
                            key={sourcePath + "#" + i}
                            value={sourcePath + "#" + i}
                          >
                            <AccordionTrigger>
                              <div className="flex items-center justify-between">
                                <span
                                  className="underline cursor-pointer"
                                  onClick={() => {
                                    navigation.navigate(
                                      sourcePath as SourcePath,
                                    );
                                  }}
                                >
                                  {sourcePath}
                                </span>
                                <span className="pl-4">
                                  ({errors?.length || 0})
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="flex flex-col gap-2">
                                {errors?.map((error, j) => (
                                  <div key={j}>
                                    <div>{error.message}</div>
                                    <div className="pl-4 font-thin">
                                      at
                                      <span
                                        className="underline cursor-pointer"
                                        onClick={() => {
                                          navigation.navigate(
                                            sourcePath as SourcePath,
                                          );
                                        }}
                                      >
                                        {sourcePath}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ),
                      )}
                    </Accordion>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </ScrollArea>
        </div>
      )}
      {committedPatchIds.size > 0 && (
        <div className="p-4 border-b border-border-primary">
          <div className="font-bold">
            {committedPatchIds.size}
            {committedPatchIds.size === 1 ? " change" : " changes"}{" "}
            {" deploying"}
          </div>
          <div className="flex items-center gap-2 text-xs">
            {"Deploying new version"}{" "}
            <Loader2 size={12} className="animate-spin" />
          </div>
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
    </div>
  );
}

function DeploymentCard({
  deployment: { deploymentId, deploymentState, updatedAt },
  onDismiss,
}: {
  deployment: Deployment;
  onDismiss?: () => void;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60 * 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);
  const isFailedOrError =
    deploymentState === "error" || deploymentState === "failure";
  return (
    <div
      key={deploymentId}
      className="relative py-4 border-b border-border-primary"
    >
      <button
        className={classNames("absolute top-0 right-0 rounded-full")}
        onClick={onDismiss}
      >
        <X size={16} />
      </button>
      <div className="grid grid-cols-[1fr,auto,auto] gap-2 py-2 pr-2">
        <div className="font-bold">Deployment {deploymentState}</div>
        <div
          className={classNames("rounded-full h-3 w-3 mt-1", {
            "bg-bg-brand-primary animate-pulse":
              deploymentState === "pending" || deploymentState === "created",
            "bg-bg-success-primary": deploymentState === "success",
            "bg-bg-error-solid": isFailedOrError,
          })}
        />
        <div>{relativeLocalDate(now, updatedAt)}</div>
      </div>
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
      path={moduleFilePath
        .split("/")
        .map(prettifyFilename)
        .slice(1)
        .concat(patchMetadata.patchPath)}
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
        path={patchSet.moduleFilePath
          .split("/")
          .map(prettifyFilename)
          .slice(1)
          .concat(patchSet.patchPath)}
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
    path?: string[];
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
      path,
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
          <span
            title={path?.join("/") + "/"}
            className={classNames(
              "inline-block w-[calc(320px-24px-8px-16px-24px-48px)] truncate mr-2 overflow-y-hidden h-6 text-left",
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
