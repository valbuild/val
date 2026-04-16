import {
  useAutoPublish,
  useErrors,
  useLoadingStatus,
  usePublishSummary,
  useValMode,
  useCurrentPatchIds,
  useCommittedPatches,
} from "./ValProvider";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useSchemas, useShallowSourceAtPath } from "./ValFieldProvider";
import { ScrollArea } from "./designSystem/scroll-area";
import { DraftChanges } from "./DraftChanges";
import { Globe, Loader2, PanelsTopLeft } from "lucide-react";
import { Button } from "./designSystem/button";
import { urlOf } from "@valbuild/shared/internal";
import {
  AccordionContent,
  AccordionTrigger,
  Accordion,
  AccordionItem,
} from "./designSystem/accordion";
import { Fragment, useMemo, useRef, useState } from "react";
import { cn } from "./designSystem/cn";
import { AIChat } from "./AIChat";
import type { AIChatHandle } from "./AIChat";
import { useAI } from "../hooks/useAI";
import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { prettifyFilename } from "../utils/prettifyFilename";
import { useNavigation } from "./ValRouter";
import { PublishButton } from "./PublishButton";
import { Checkbox } from "./designSystem/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./designSystem/tooltip";

export function ToolsMenu() {
  const loadingStatus = useLoadingStatus();
  const { isPublishing } = usePublishSummary();
  const validationErrors = useAllValidationErrors() || {};
  const { globalErrors } = useErrors();
  const mode = useValMode();
  const [errorModules, sumValidationErrors] = useMemo(() => {
    const modulesWithErrors = new Set<ModuleFilePath>();
    let sumValidationErrors = 0;
    for (const sourcePath in validationErrors) {
      const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
        sourcePath as SourcePath,
      );
      modulesWithErrors.add(moduleFilePath);
      sumValidationErrors += 1;
    }
    return [Array.from(modulesWithErrors).sort(), sumValidationErrors];
  }, [validationErrors]);
  const currentPatchIds = useCurrentPatchIds();
  const committedPatchIds = useCommittedPatches();
  const pendingChanges = currentPatchIds.length - committedPatchIds.size;
  const chatRef = useRef<AIChatHandle | null>(null);
  const { sendMessage, isConnected, newSession } = useAI(chatRef);
  return (
    <div
      className="flex flex-col h-[100svh] bg-bg-primary"
      style={
        {
          "--menu-width": "320px",
        } as React.CSSProperties
      }
    >
      <div className="shrink-0 h-16 border-b border-border-primary">
        <ToolsMenuButtons />
      </div>
      {isPublishing && (
        <div className="shrink-0 flex gap-2 justify-end items-center p-4 text-right border-t bg-bg-tertiary text-fg-primary border-border-primary">
          <span>Publishing changes </span>
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
      <div className="shrink-0 overflow-auto">
        <div className="max-h-[50svh]">
          {globalErrors &&
            globalErrors.length > 0 &&
            globalErrors.length !== sumValidationErrors && (
              <div className="p-4 bg-bg-error-primary text-fg-error-primary">
                <div>
                  Cannot {mode === "fs" ? "save" : "publish"} now. Found{" "}
                  {globalErrors?.length} errors in all.{" "}
                  {globalErrors.length - sumValidationErrors} were
                  non-validation errors. A developer might need to fix these
                  issues.
                </div>
                <ScrollArea>
                  <div className="max-h-[calc(50svh-64px)] max-w-[var(--menu-width)]">
                    {globalErrors?.map((error, i) => {
                      return <ShortenedErrorMessage key={i} error={error} />;
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}
          {globalErrors?.length === sumValidationErrors &&
            errorModules.length > 0 && (
              <div className="p-4 bg-bg-error-primary text-fg-error-primary">
                <div>
                  <div>Cannot {mode === "fs" ? "save" : "publish"} now.</div>
                  <div>Found errors in modules</div>
                </div>
                <ScrollArea>
                  <div className="max-h-[calc(50svh-64px)] max-w-[var(--menu-width)]">
                    {errorModules?.map((error, i) => {
                      return <ModuleError key={i} moduleFilePath={error} />;
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}
          {loadingStatus !== "not-asked" && (
            <Accordion type="single" collapsible>
              <AccordionItem value="draft-changes" className="border-b-0">
                <AccordionTrigger className="p-4 font-normal text-left">
                  <div className="flex items-center flex-1 mr-2">
                    <div className="flex gap-2 items-center">
                      <span>
                        {pendingChanges <= 0 ? "No" : pendingChanges} change
                        {pendingChanges === 1 ? "" : "s"}
                      </span>
                      {loadingStatus === "loading" && (
                        <Loader2 size={14} className="animate-spin" />
                      )}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="[&>div]:pt-0 [&>div]:pb-0">
                  <ScrollArea>
                    <div className="max-h-[calc(50svh-128px)] border-b border-border-primary">
                      <DraftChanges />
                    </div>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </div>
      </div>
      {mode === "http" && (
        <div className="flex-1 min-h-0 border-t border-border-primary">
          <AIChat
            ref={chatRef}
            onSendMessage={sendMessage}
            onNewSession={newSession}
            isConnected={isConnected}
          />
        </div>
      )}
    </div>
  );
}

function ModuleError({ moduleFilePath }: { moduleFilePath: ModuleFilePath }) {
  const moduleFilePathParts = Internal.splitModuleFilePath(moduleFilePath);
  const navigation = useNavigation();
  return (
    <div className="px-4 py-2 border-b bg-bg-error-primary text-fg-error-primary border-border-error-primary">
      <button
        className="underline cursor-pointer"
        onClick={() => {
          navigation.navigate(moduleFilePath);
        }}
      >
        {moduleFilePathParts.map((part, i) => (
          <Fragment key={i}>
            <span
              className={cn("text-fg-brand-secondary", {
                "ml-1": i > 0,
              })}
            >
              /
            </span>
            <span>{prettifyFilename(part)}</span>
          </Fragment>
        ))}
      </button>
    </div>
  );
}

function ShortenedErrorMessage({ error }: { error: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={cn(
        "px-1 py-2 bg-bg-error-primary text-fg-error-primary border-b border-border-error-primary",
        {
          truncate: !isExpanded,
          "whitespace-normal": isExpanded,
        },
      )}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      {error}
    </div>
  );
}

export function ToolsMenuButtons() {
  const { currentSourcePath } = useNavigation();
  const schemas = useSchemas();
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(currentSourcePath);
  const maybeRecordSource = useShallowSourceAtPath(moduleFilePath, "record");
  const maybePreviewRoute = useMemo(():
    | {
        status: "success";
        data: null | {
          previewRoute: string;
        };
      }
    | {
        status: "loading";
      }
    | {
        status: "error";
        error: string;
      }
    | {
        status: "not-found";
      } => {
    if (schemas.status !== "success") {
      return schemas;
    }
    if (maybeRecordSource.status !== "success") {
      return maybeRecordSource;
    }
    const schema = schemas.data[moduleFilePath];

    if (schema.type === "record" && schema.router) {
      if (maybeRecordSource.data === null) {
        return {
          status: "success",
          data: null,
        };
      }

      const keys = Object.keys(maybeRecordSource.data);
      const parts = Internal.splitModulePath(modulePath);
      const routePartOfModulePath = parts[0]; // currently we only need to check for the first key of a router since it is always a record where the keys are the full pathname
      for (const key of keys) {
        if (routePartOfModulePath && routePartOfModulePath === key) {
          return {
            status: "success",
            data: { previewRoute: key },
          };
        }
      }
    }
    return {
      status: "success",
      data: null,
    };
  }, [
    "data" in schemas && schemas.data,
    moduleFilePath,
    modulePath,
    maybeRecordSource,
  ]);
  const mode = useValMode();
  const { setAutoPublish, autoPublish } = useAutoPublish();
  return (
    <div className="flex flex-col">
      <div className="flex gap-2 justify-between items-center p-4 w-full">
        <div className="flex gap-2 justify-end items-center w-full">
          {mode === "fs" && (
            <div className="overflow-hidden flex items-center gap-2 text-[10px] lg:text-xs">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="truncate text-fg-secondary">Auto-save</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    When auto-save is enabled Val will save to changes to disk
                    automatically
                  </p>
                  <p>This is a development mode feature</p>
                </TooltipContent>
              </Tooltip>
              <Checkbox
                checked={autoPublish}
                onCheckedChange={setAutoPublish}
              />
            </div>
          )}
          <PreviewButton maybePreviewRoute={maybePreviewRoute} />
          <PublishButton />
        </div>
      </div>
    </div>
  );
}

function PreviewButton({
  maybePreviewRoute,
}: {
  maybePreviewRoute:
    | {
        status: "success";
        data: null | {
          previewRoute: string;
        };
      }
    | {
        status: "loading";
      }
    | {
        status: "error";
        error: string;
      }
    | {
        status: "not-found";
      };
}) {
  const href = useMemo(() => {
    if (
      maybePreviewRoute.status === "success" &&
      maybePreviewRoute.data?.previewRoute
    ) {
      return urlOf("/api/val/enable", {
        redirect_to: window.origin + maybePreviewRoute.data.previewRoute,
      });
    } else {
      return urlOf("/api/val/enable", {
        redirect_to: window.origin,
      });
    }
  }, [maybePreviewRoute]);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className="flex gap-2 items-center"
          variant={"secondary"}
          asChild
        >
          <a href={href}>
            <span>Preview</span>
            {maybePreviewRoute.status === "success" &&
            maybePreviewRoute.data?.previewRoute ? (
              <Globe size={16} />
            ) : (
              <PanelsTopLeft size={16} />
            )}
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {maybePreviewRoute.status === "success" &&
        maybePreviewRoute.data?.previewRoute ? (
          <p>Preview your changes in {maybePreviewRoute.data.previewRoute}</p>
        ) : (
          <p>Preview your changes on the main page</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
