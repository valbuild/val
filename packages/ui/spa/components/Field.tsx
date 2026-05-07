import { SerializedSchema, SourcePath } from "@valbuild/core";
import { Label } from "./Label";
import classNames from "classnames";
import { ChevronDown, ChevronsDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useLoadingStatus,
} from "./ValFieldProvider";
import { useValidationErrors } from "./ValErrorProvider";
import { Checkbox } from "./designSystem/checkbox";
import { JSONValue } from "@valbuild/core/patch";
import { ArrayAndRecordTools } from "./ArrayAndRecordTools";
import { emptyOf } from "./fields/emptyOf";
import { EmbeddedBooleanField } from "./fields/BooleanField";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "./designSystem/accordion";
import { FieldValidationError } from "./FieldValidationError";
import {
  PendingPatch,
  usePendingPatches,
  useProfilesByAuthorId,
} from "./ValProvider";
import { FieldPatchAuthors } from "./FieldPatchAuthors";
import { ErrorBoundary } from "react-error-boundary";

export function Field({
  label,
  children,
  path,
  transparent,
  type,
  foldLevel = "1",
}: {
  label?: string | React.ReactNode;
  children: React.ReactNode;
  path: SourcePath;
  transparent?: boolean;
  type: SerializedSchema["type"];
  foldLevel?: "2" | "1";
}) {
  const loadingStatus = useLoadingStatus();
  const validationErrors = useValidationErrors(path);
  const { patchPath, addPatch } = useAddPatch(path);
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const pendingPatches = usePendingPatches(path);
  const profilesByAuthorIds = useProfilesByAuthorId();
  const patchesByAuthorIds = useMemo((): Record<string, PendingPatch[]> => {
    const byAuthors: Record<string, PendingPatch[]> = {};
    for (const patch of pendingPatches || []) {
      const author = patch.authorId ?? "unknown";
      if (!byAuthors[author]) {
        byAuthors[author] = [];
      }
      byAuthors[author].push(patch);
    }
    return byAuthors;
  }, [pendingPatches]);
  const hasPendingPatches = pendingPatches ? pendingPatches.length > 0 : false;

  const [isExpanded, setIsExpanded] = useState(true);
  const [showEmptyFileOrImage, setShowEmptyFileOrImage] = useState(false);
  useEffect(() => {
    if (
      "data" in sourceAtPath &&
      sourceAtPath.data === null &&
      "data" in schemaAtPath &&
      !schemaAtPath.data.opt &&
      (schemaAtPath.data?.type === "image" ||
        schemaAtPath.data?.type === "file")
    ) {
      setShowEmptyFileOrImage(true);
    }
  }, [sourceAtPath, schemaAtPath]);
  const source = "data" in sourceAtPath ? sourceAtPath.data : undefined;
  const schema = "data" in schemaAtPath ? schemaAtPath.data : undefined;
  const isBoolean = schema?.type === "boolean";
  const isNullable = schema?.opt === true;
  return (
    <div
      className={classNames("px-4 pt-6 pb-4 border rounded-lg", {
        "bg-bg-tertiary": !transparent,
        "border-bg-error-secondary": validationErrors.length > 0,
      })}
    >
      <div className="flex justify-between items-center pb-2">
        <div className="flex gap-4 items-center">
          {schema && !isBoolean && (isNullable || source === null) && (
            <Checkbox
              disabled={loadingStatus === "loading"}
              checked={source !== null || showEmptyFileOrImage}
              onCheckedChange={() => {
                if (
                  (schema.type === "image" || schema.type === "file") &&
                  source === null
                ) {
                  setShowEmptyFileOrImage(true);
                } else {
                  if (source === null) {
                    addPatch(
                      [
                        {
                          op: "replace",
                          path: patchPath,
                          value: emptyOf({
                            ...schema,
                            opt: false, // empty of nullable is null, so we override
                          }) as JSONValue,
                        },
                      ],
                      schema.type,
                    );
                  } else {
                    addPatch(
                      [
                        {
                          op: "replace",
                          path: patchPath,
                          value: null,
                        },
                      ],
                      schema.type,
                    );
                  }
                }
              }}
            />
          )}
          {isBoolean && (
            <EmbeddedBooleanField
              path={path}
              isNullable={isNullable}
              loadingStatus={loadingStatus}
              source={source}
            />
          )}
          {typeof label === "string" && <Label>{label}</Label>}
          {label && typeof label !== "string" && label}
        </div>
        <div className="flex gap-2 items-center">
          {hasPendingPatches && (
            <FieldPatchAuthors
              patchesByAuthorIds={patchesByAuthorIds}
              profilesByAuthorIds={profilesByAuthorIds}
            />
          )}
          {source !== null && (
            <ArrayAndRecordTools path={path} variant={"field"} />
          )}
          {source !== null && !isBoolean && (
            <button
              onClick={() => setIsExpanded((prev) => !prev)}
              className={classNames(
                "transform transition-transform size-6 m-[1px] flex items-center justify-center",
                {
                  "rotate-180": isExpanded,
                },
              )}
            >
              {foldLevel === "1" && <ChevronDown size={16} />}
              {foldLevel === "2" && <ChevronsDown size={16} />}
            </button>
          )}
        </div>
      </div>
      {!isBoolean && (
        <Accordion
          type="single"
          collapsible
          value={
            isExpanded && (source !== null || showEmptyFileOrImage)
              ? "open"
              : "closed"
          }
        >
          <AccordionItem value={"open"} className="w-full border-b-0">
            <AccordionContent>
              <ErrorBoundary fallback={createFieldErrorFallback(path)}>
                {children}
              </ErrorBoundary>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
      {validationErrors.length > 0 && (
        <div className="pb-8">
          <FieldValidationError validationErrors={validationErrors} />
        </div>
      )}
    </div>
  );
}

function createFieldErrorFallback(path: SourcePath) {
  return <FieldErrorFallback path={path} />;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function FieldErrorFallback(_props: { path: SourcePath }) {
  // TODO: get patches for this field and suggest to revert them
  return (
    <div className="text-fg-error-primary text-sm p-4 bg-bg-error-primary rounded-lg">
      An unexpected error occurred
    </div>
  );
}
