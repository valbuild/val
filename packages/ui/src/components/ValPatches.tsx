import {
  AnyRichTextOptions,
  ApiPostValidationErrorResponse,
  ApiPostValidationResponse,
  FileMetadata,
  ImageMetadata,
  ModuleId,
  PatchId,
  RichText,
  SourcePath,
  ValApi,
} from "@valbuild/core";
import { ChevronDown, Diff, X } from "lucide-react";
import { Button } from "./ui/button";
import { result } from "@valbuild/core/fp";
import { Fragment, useEffect, useState } from "react";
import { Accordion, AccordionContent } from "./ui/accordion";
import {
  AccordionHeader,
  AccordionItem,
  AccordionTrigger,
} from "@radix-ui/react-accordion";
import { Path } from "./Path";
import classNames from "classnames";
import { AlertCircle, ChevronRight, ChevronUp, XCircle } from "react-feather";

export type ValPatchesProps = {
  api: ValApi;
  isValidating: boolean;
  validationResponse: {
    globalError: null | { message: string; details?: unknown };
    errors?: ApiPostValidationResponse | ApiPostValidationErrorResponse;
  };
  patches: Record<ModuleId, PatchId[]>;
  onCommit: () => void;
  onCancel: () => void;
};
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
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return (
    <Container>
      <div className="flex justify-end p-2">
        <button onClick={onCancel}>
          <X />
        </button>
      </div>
      <div className="flex flex-col items-center justify-center h-full p-8 gap-y-5">
        <ReviewPanel />
        <div className="flex gap-x-4">
          <Button variant={"secondary"} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={isValidating || loading}
            onClick={() => {
              setLoading(true);
              api
                .postCommit({ patches: patchIdsByModule })
                .then((res) => {
                  if (result.isErr(res)) {
                    console.error(res.error);
                    if ("validationErrors" in res.error) {
                      alert("Cannot commit invalid patches");
                    } else {
                      alert("Could not commit patches: " + res.error.message);
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
    </Container>
  );
}

type Author = {
  name: string;
  avatarUrl?: string;
};
type SourceChangeItem = {
  path: SourcePath;
  type: "replace" | "move" | "add" | "remove";
  count: number;
  // TODO: display a notification symbol on the last change on a source path with a validation error
  // notification?: "error" | "warning";
  // TODO: it would be awesome to get a diff, but too much work for now:
  // diff?:
  //   | {
  //       before: string;
  //       after: string;
  //     }
  //   | {
  //       before: RichText<AnyRichTextOptions>;
  //       after: RichText<AnyRichTextOptions>;
  //     };
} & {
  changedAt?: string;
};
type FileChange = {
  ref: string;
  type: "replace" | "add";
};

export type History = {
  author?: Author;
  lastChangedAt: string;
  changeCount: number;
  changes: (
    | {
        moduleId: ModuleId;
        items: SourceChangeItem[];
      }
    | FileChange
  )[];
}[];

export type ReviewErrors = {
  globalError?: string;
  errors: Record<
    ModuleId,
    {
      moduleError?: string;
      path: SourcePath;
      lastChangedBy?: Author;
      lastedChangedAt?: string;
      messages: {
        message: string;
        severity: "error" | "warning";
      }[];
    }[]
  >;
};

export function ReviewPanel({
  history,
  errors,
}: {
  history: History;
  errors: ReviewErrors;
}) {
  return (
    <div>
      <h1 className="block mb-6 font-sans text-xl font-bold">Review changes</h1>
      {history.length > 0 && (
        <ol>
          {history.map((item, index) => (
            <li key={index}>
              <HistoryItem
                index={index}
                last={index === history.length - 1}
                defaultOpen={history.length > 3 ? false : true}
              >
                {item}
              </HistoryItem>
            </li>
          ))}
        </ol>
      )}
      {errors.errors &&
        Object.entries(errors.errors).map(([moduleId, moduleErrors]) => (
          <ValidationModuleErrors
            key={moduleId}
            moduleId={moduleId as ModuleId}
          >
            {moduleErrors}
          </ValidationModuleErrors>
        ))}
    </div>
  );
}

function ValidationModuleErrors({
  moduleId,
  children: moduleErrors,
}: {
  moduleId: ModuleId;
  children: ReviewErrors["errors"][ModuleId];
}) {
  return (
    <div className="mt-6">
      <div>
        <Path>{moduleId}</Path>
      </div>
      <div>
        {moduleErrors.map((error, index) => (
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

function ValidationErrorItem({
  children: error,
}: {
  children: ReviewErrors["errors"][ModuleId][number];
}) {
  return (
    <Accordion type="single" collapsible className="text-sm">
      <AccordionItem value="validation-error">
        <AccordionTrigger className="flex items-center justify-between w-full mt-3">
          <span>
            <span className="min-w-[100px] text-left truncate" dir="rtl">
              <Path>{error.path}</Path>
            </span>
            <span className="ml-2 text-muted">({error.messages.length})</span>
          </span>
          <div className="flex items-center gap-4">
            <span className="truncate">
              last changed
              {error.lastedChangedAt ? ` ${error.lastedChangedAt}` : ""} by{" "}
            </span>
            {error.lastChangedBy && (
              <AuthorComponent author={error.lastChangedBy} />
            )}
          </div>
        </AccordionTrigger>
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
  children: ReviewErrors["errors"][ModuleId][number]["messages"][number];
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
}: {
  index: number;
  last: boolean;
  defaultOpen?: boolean;
  children: History[number];
}) {
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
                {` • ${item.lastChangedAt}`}
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
                <ChangeItem change={change} />
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
}: {
  change: History[number]["changes"][number];
}) {
  if ("ref" in change) {
    return (
      <div>
        {change.type === "add" ? "Added file " : "Updated file "}
        {change.ref}
      </div>
    );
  }
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
                <Path>{item.path}</Path>
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
              {item.changedAt && <div>{item.changedAt}</div>}
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
