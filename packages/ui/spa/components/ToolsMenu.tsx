import {
  useAllValidationErrors,
  useAutoPublish,
  useErrors,
  useLoadingStatus,
  usePublishSummary,
  useValMode,
} from "./ValProvider";
import { ScrollArea } from "./designSystem/scroll-area";
import { DraftChanges } from "./DraftChanges";
import classNames from "classnames";
import { Eye, Loader2, PanelRightOpen } from "lucide-react";
import { useLayout } from "./Layout";
import { Button } from "./designSystem/button";
import { urlOf } from "@valbuild/shared/internal";
import {
  AccordionContent,
  AccordionTrigger,
  Accordion,
  AccordionItem,
} from "./designSystem/accordion";
import { Fragment, useMemo, useState } from "react";
import { cn } from "./designSystem/cn";
import { Internal, ModuleFilePath, SourcePath } from "@valbuild/core";
import { prettifyFilename } from "../utils/prettifyFilename";
import { useNavigation } from "./ValRouter";
import { PublishButton } from "./PublishButton";
import { Checkbox } from "./designSystem/checkbox";

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
  return (
    <div
      className="min-h-[100svh] bg-bg-primary"
      style={
        {
          "--menu-width": "320px",
        } as React.CSSProperties
      }
    >
      <div className="h-16 border-b border-border-primary">
        <ToolsMenuButtons />
      </div>
      {isPublishing && (
        <div className="flex gap-2 justify-end items-center p-4 text-right border-t bg-bg-tertiary text-text-primary border-border-primary">
          <span>Publishing changes </span>
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
      <ScrollArea>
        <div className="max-h-[calc(100svh-64px)]">
          {globalErrors &&
            globalErrors.length > 0 &&
            globalErrors.length !== sumValidationErrors && (
              <Accordion type="single" collapsible>
                <AccordionItem value="global-errors">
                  <AccordionTrigger className="p-4 font-normal text-left rounded data-[state=open]:rounded-b-none bg-bg-error-primary text-fg-error-primary">
                    Cannot {mode === "fs" ? "save" : "publish"} now. Found{" "}
                    {globalErrors?.length} errors in all.{" "}
                    {globalErrors.length - sumValidationErrors} were
                    non-validation errors. A developer might need to fix these
                    issues.
                  </AccordionTrigger>
                  <AccordionContent>
                    <ScrollArea>
                      <div className="max-h-[calc(100svh-128px)] max-w-[var(--menu-width)]">
                        {globalErrors?.map((error, i) => {
                          return (
                            <ShortenedErrorMessage key={i} error={error} />
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          {globalErrors?.length === sumValidationErrors &&
            errorModules.length > 0 && (
              <Accordion type="single" collapsible>
                <AccordionItem value="global-errors">
                  <AccordionTrigger className="p-4 font-normal text-left rounded data-[state=open]:rounded-b-none bg-bg-error-primary text-fg-error-primary">
                    <div>
                      <div>
                        Cannot {mode === "fs" ? "save" : "publish"} now.
                      </div>
                      <div>Found errors in modules</div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ScrollArea>
                      <div className="max-h-[calc(100svh-64px)] max-w-[var(--menu-width)]">
                        {errorModules?.map((error, i) => {
                          return <ModuleError key={i} moduleFilePath={error} />;
                        })}
                      </div>
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          {loadingStatus !== "not-asked" && (
            <div className={classNames("", {})}>
              <ScrollArea>
                <div className="max-h-[calc(100svh-64px)] border-b border-border-primary">
                  <DraftChanges loadingStatus={loadingStatus} />
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </ScrollArea>
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
  const { navMenu, toolsMenu } = useLayout();
  const mode = useValMode();
  const { setAutoPublish, autoPublish } = useAutoPublish();
  return (
    <div className="flex flex-col">
      <div className="flex gap-2 justify-between items-center p-4 w-full">
        <button
          className="lg:hidden"
          onClick={() => {
            toolsMenu.setOpen(!toolsMenu.isOpen);
          }}
        >
          <PanelRightOpen
            size={16}
            className={classNames("transform", {
              "rotate-180": !navMenu.isOpen,
            })}
          />
        </button>
        <div className="flex gap-2 justify-end items-center w-full">
          {mode === "fs" && (
            <div className="overflow-hidden flex items-center gap-2 text-[10px] lg:text-xs">
              <span className="truncate text-text-secondary">Auto-save</span>
              <Checkbox
                checked={autoPublish}
                onCheckedChange={setAutoPublish}
              />
            </div>
          )}
          <Button
            className="flex gap-2 items-center"
            variant={"outline"}
            onClick={() => {
              window.location.href = urlOf("/api/val/enable", {
                redirect_to: window.origin,
              });
            }}
          >
            <span>Preview</span>
            <Eye size={16} />
          </Button>
          <PublishButton />
        </div>
      </div>
    </div>
  );
}
