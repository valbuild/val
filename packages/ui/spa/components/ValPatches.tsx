import {
  ApiPostValidationErrorResponse,
  ApiPostValidationResponse,
  ModuleId,
  PatchId,
  ValApi,
} from "@valbuild/core";
import { ChevronDown, Undo2, X } from "lucide-react";
import { Button } from "./ui/button";
import { result } from "@valbuild/core/fp";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Accordion, AccordionContent } from "./ui/accordion";
import { AccordionItem, AccordionTrigger } from "@radix-ui/react-accordion";
import { Path } from "./Path";
import classNames from "classnames";
import { AlertCircle, XCircle } from "react-feather";
import { Patch } from "@valbuild/core/patch";
import {
  Author,
  History,
  ReviewErrors,
  ReviewModuleError,
  convertPatchErrors,
} from "./convertPatchErrors";

export type ValPatchesProps = {
  api: ValApi;
  isValidating: boolean;
  validationResponse?:
    | {
        globalError: null | { message: string; details?: unknown };
      } & Partial<ApiPostValidationResponse | ApiPostValidationErrorResponse>;
  patches: Record<ModuleId, PatchId[]>;
  onCommit: () => void;
  onCancel?: () => void;
};

const TimeContext = createContext(0);
function useNow() {
  return useContext(TimeContext);
}

export function ValPatchesDialog(props: ValPatchesProps) {
  return (
    <Container>
      <div className="flex justify-end p-2">
        <button onClick={props.onCancel}>
          <X />
        </button>
      </div>
      <h1 className="block mb-6 font-sans text-2xl font-bold">
        Review changes
      </h1>
      <ValPatches {...props} />
    </Container>
  );
}

export function ValPatches({
  api,
  isValidating,
  patches: patchIdsByModule,
  validationResponse,
  onCommit,
  onCancel,
}: ValPatchesProps) {
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onCancel) {
          onCancel();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const [patchesByModule, setPatchesByModule] = useState<
    Record<
      ModuleId,
      {
        patch: Patch;
        patch_id: PatchId;
        created_at: string;
        commit_sha?: string;
        author?: string;
      }[]
    >
  >();
  useEffect(() => {
    let ignore = false;
    api.getPatches(patchIdsByModule).then((res) => {
      if (ignore) {
        return;
      }
      if (result.isErr(res)) {
        console.error(res.error);
        return;
      } else {
        setPatchesByModule(res.value);
      }
    });
    return () => {
      ignore = true;
    };
  }, [patchIdsByModule]);

  return (
    <TimeContext.Provider value={Date.now()}>
      <div className="flex flex-col items-start justify-start h-full p-8 gap-y-5">
        {patchesByModule && validationResponse && (
          <ReviewPanel
            {...convertPatchErrors(patchesByModule, {
              modules: validationResponse.modules,
              validationErrors: validationResponse.validationErrors,
            })}
            onDeletePatch={(patchId) => {
              api
                .deletePatches([patchId])
                .then((res) => {
                  if (result.isErr(res)) {
                    console.error(res.error);
                    return;
                  }
                  setPatchesByModule((patchesByModule) => {
                    const newPatchesByModule = { ...patchesByModule };
                    for (const moduleIdS in newPatchesByModule) {
                      const moduleId = moduleIdS as ModuleId;
                      newPatchesByModule[moduleId] = newPatchesByModule[
                        moduleId
                      ].filter((patch) => patchId !== patch.patch_id);
                    }
                    return newPatchesByModule;
                  });
                })
                .catch(console.error);
            }}
          />
        )}
        <div className="flex gap-x-4">
          <Button variant={"secondary"} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={
              isValidating || loading || !patchesByModule || !validationResponse
            }
            onClick={() => {
              setLoading(true);
              api
                .postCommit({ patches: patchIdsByModule })
                .then((res) => {
                  if (result.isErr(res)) {
                    console.error(res.error);
                    if ("validationErrors" in res.error) {
                      alert(
                        `Cannot commit! Validation errors detected: ${Object.entries(
                          res.error.validationErrors
                        )
                          .map(([moduleId, res]) =>
                            res.errors.fatal
                              ? `Module: ${moduleId}. FATAL errors: ${JSON.stringify(
                                  res.errors.fatal,
                                  null,
                                  2
                                )}`
                              : `Module: ${moduleId}:\n${JSON.stringify(
                                  res.errors.validation,
                                  null,
                                  4
                                )}`
                          )
                          .join("\n")}`
                      );
                    } else {
                      alert(
                        "Could not commit patches: " +
                          res.error.message +
                          (res.error.details
                            ? ". Details:" + JSON.stringify(res.error.details)
                            : ".")
                      );
                    }
                  } else {
                    console.log("Committed patches: ", res.value);
                    onCommit();
                  }
                })
                .finally(() => {
                  setLoading(false);
                });
            }}
          >
            {loading ? "Committing..." : "Commit"}
          </Button>
        </div>
      </div>
    </TimeContext.Provider>
  );
}

export function ReviewPanel({
  history,
  errors,
  onDeletePatch,
}: {
  history: History;
  errors?: ReviewErrors;
  onDeletePatch: (patchId: PatchId) => void;
}) {
  return (
    <div className="w-full">
      <h2 className="mt-10 mb-6 text-xl font-bold">Timeline</h2>
      {history.length > 0 && (
        <ol>
          {history.map((item, index) => (
            <li key={index}>
              <HistoryItem
                index={index}
                last={index === history.length - 1}
                defaultOpen={history.length > 3 ? false : true}
                onDeletePatch={onDeletePatch}
              >
                {item}
              </HistoryItem>
            </li>
          ))}
        </ol>
      )}
      {errors?.errors &&
        Object.values(errors.errors).some(
          (a) => a.fatalErrors || (a.validations && a.validations.length > 0)
        ) && (
          <>
            <h2 className="mt-10 mb-6 text-xl font-bold">
              Validation Notifications
            </h2>
            {Object.entries(errors?.errors || {}).map(
              ([moduleId, moduleErrors]) =>
                ((moduleErrors.fatalErrors &&
                  moduleErrors.fatalErrors.length > 0) ||
                  (moduleErrors.validations &&
                    moduleErrors.validations.length > 0)) && (
                  <ValidationModuleErrors
                    key={moduleId}
                    moduleId={moduleId as ModuleId}
                  >
                    {moduleErrors}
                  </ValidationModuleErrors>
                )
            )}
          </>
        )}
    </div>
  );
}

function ValidationModuleErrors({
  moduleId,
  children: moduleErrors,
}: {
  moduleId: ModuleId;
  children: ReviewModuleError;
}) {
  return (
    <div className="mt-6">
      <div>
        <span>
          <Path>{moduleId}</Path>
        </span>
        {moduleErrors.fatalErrors && (
          <div className="mt-3">
            {moduleErrors.fatalErrors.map((error, index) => (
              <div className="mt-3" key={index}>
                <XCircle className="inline-block mr-2" />
                <span>{error}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        {moduleErrors.validations.map((error, index) => (
          <ValidationErrorItem key={index}>{error}</ValidationErrorItem>
        ))}
      </div>
    </div>
  );
}

function AuthorComponent({ author }: { author?: Author }) {
  return author?.avatarUrl ? (
    <img
      className="w-8 h-8 border rounded-full border-border"
      src={author.avatarUrl}
    />
  ) : (
    <span className="w-8 h-8 text-sm leading-8 text-center border rounded-full border-border">
      {author?.name && getInitials(author.name)}
    </span>
  );
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
});

function useRelativeDateTime() {
  const now = useNow();
  const relativeDateTime = useCallback(
    (timeStampStr: string) => {
      const diff = now - new Date(Number(timeStampStr)).getTime();
      const seconds = Math.floor(diff / 1000);
      if (seconds < 60) {
        return `just now`;
      }
      const minutes = Math.floor(diff / 1000 / 60);
      if (minutes < 60) {
        return `${minutes} mins ago`;
      }
      const hours = Math.floor(minutes / 60);
      if (hours < 24) {
        return `${hours} hours ago`;
      }
      const days = Math.floor(hours / 24);
      if (days < 3) {
        return `${days} days ago`;
      }
      try {
        return dateTimeFormatter.format(new Date(timeStampStr));
      } catch (err) {
        console.debug("Val: Error formatting date", err);
      }
    },
    [now]
  );
  return relativeDateTime;
}

function ValidationErrorItem({
  children: error,
}: {
  children: ReviewModuleError["validations"][number];
}) {
  const [open, setOpen] = useState(false);
  const relativeDateTime = useRelativeDateTime();
  return (
    <Accordion
      type="single"
      collapsible
      className="text-sm"
      defaultValue={"validation-error"}
      onValueChange={(value) => setOpen(value === "validation-error")}
    >
      <AccordionItem value="validation-error">
        <div className="flex items-center justify-between w-full mt-3">
          <span>
            <span className="min-w-[100px] text-left truncate" dir="rtl">
              <Path>{error.path}</Path>
            </span>
          </span>
          <AccordionTrigger className="flex items-center gap-2">
            <span className="truncate">
              {error.messages.length} messages
              {error.lastChangedAt &&
                ` • ${relativeDateTime(error.lastChangedAt)} `}
            </span>
            {error.lastChangedBy && (
              <AuthorComponent author={error.lastChangedBy} />
            )}
            <ChevronDown
              className={classNames("transition", {
                "-rotate-180": open,
              })}
            />
          </AccordionTrigger>
        </div>
        <AccordionContent>
          {error.messages.map((message, index) => {
            return <ErrorMessage key={index}>{message}</ErrorMessage>;
          })}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
function ErrorMessage({
  children: message,
}: {
  children: ReviewModuleError["validations"][number]["messages"][number];
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((open) => !open);
  return (
    <button
      onClick={toggle}
      className={classNames("flex mt-3 gap-4 max-w-full text-left", {
        truncate: !open,
      })}
    >
      {message.severity === "warning" ? (
        <AlertCircle className="flex-shrink-0 text-warning" />
      ) : (
        <XCircle className="flex-shrink-0 text-error" />
      )}
      {message.message}
    </button>
  );
}

function HistoryItem({
  index,
  defaultOpen,
  last,
  children: item,
  onDeletePatch,
}: {
  index: number;
  last: boolean;
  defaultOpen?: boolean;
  children: History[number];
  onDeletePatch: (patchId: PatchId) => void;
}) {
  const relativeDateTime = useRelativeDateTime();
  const [open, setOpen] = useState(defaultOpen);
  const value = `history-item-${index}`;
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen ? value : undefined}
      onValueChange={(currentValue) => {
        setOpen(currentValue === value);
      }}
    >
      <AccordionItem value={value}>
        <AccordionTrigger className="flex items-start justify-between w-full">
          <AuthorComponent author={item.author} />
          <span className="flex items-center gap-4 text-sm">
            {
              <span>
                {item.changeCount}
                {" changes"}
                {` • ${relativeDateTime(item.lastChangedAt)}`}
              </span>
            }
            <ChevronDown
              className={classNames("transition", {
                "-rotate-180": open,
              })}
            />
          </span>
        </AccordionTrigger>
        <ol className="pl-4 mt-4 mb-4 ml-4 border-l border-border">
          {!open && !last && <div className="h-2"></div>}
          <AccordionContent>
            {item.changes.map((change, index) => (
              <div key={index}>
                <ChangeItem change={change} onDeletePatch={onDeletePatch} />
              </div>
            ))}
          </AccordionContent>
        </ol>
      </AccordionItem>
    </Accordion>
  );
}

function getInitials(name: string) {
  const [first, ...rest] = name.split(" ");
  if (rest.length === 0) return first.slice(0, 2);
  return `${first[0]}${rest.slice(-1)[0]?.[0]}`;
}

function ChangeItem({
  change,
  onDeletePatch: onDelete,
}: {
  change: History[number]["changes"][number];
  onDeletePatch: (patchId: PatchId) => void;
}) {
  const relativeDateTime = useRelativeDateTime();
  return (
    <div>
      <div className="font-bold">
        <Path>{change.moduleId}</Path>
      </div>
      <ol className="ml-2">
        {change.items.map((item, index) => (
          <li key={index}>
            <div className="grid grid-cols-3 py-2">
              <span>
                {item.filePath ? item.filePath : <Path>{item.path}</Path>}
              </span>
              <span>
                {item.type === "replace"
                  ? `updated${
                      item.count
                        ? item.count > 1
                          ? ` ${item.count} times`
                          : ""
                        : ""
                    }`
                  : item.type === "add"
                  ? "added "
                  : item.type === "move"
                  ? "moved "
                  : "removed "}
              </span>
              {item.changedAt && <div>{relativeDateTime(item.changedAt)}</div>}
              {/* show patch ids in accordion */}
              <Accordion type="single" collapsible>
                <AccordionItem value="patch-ids">
                  <AccordionTrigger>Show Patch IDs</AccordionTrigger>
                  <AccordionContent>
                    {item.patchIds?.map((patchId) => (
                      <div key={patchId} className="mr-2">
                        <span>{patchId}</span>
                        <button
                          onClick={() => {
                            onDelete(patchId);
                          }}
                        >
                          <Undo2 />
                        </button>
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Container({
  children,
}: {
  children: React.ReactNode | React.ReactNode[];
}) {
  return (
    <div className="h-full w-full rounded-lg bg-gradient-to-br from-background/90 from-40% to-background backdrop-blur-lg text-primary drop-shadow-2xl">
      {children}
    </div>
  );
}
