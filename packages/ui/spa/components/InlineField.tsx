import { Json, SerializedSchema, SourcePath } from "@valbuild/core";
import { Label } from "./Label";
import classNames from "classnames";
import { ChevronDown, ChevronsDown } from "lucide-react";
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
import { ShallowSource } from "./ValFieldProvider";
import { useFieldState } from "./useFieldState";

export function InlineField({
  label,
  children,
  path,
  type,
  readonly,
  foldLevel = "1",
  source: sourceProp,
  schema: schemaProp,
}: {
  label?: string | React.ReactNode;
  children: React.ReactNode;
  path: SourcePath;
  type: SerializedSchema["type"];
  readonly: boolean;
  foldLevel?: "2" | "1";
  source?: Json | null;
  schema?: SerializedSchema;
}) {
  if ((sourceProp !== undefined) !== (schemaProp !== undefined)) {
    throw new Error(
      "InlineField: source and schema must both be provided or both omitted",
    );
  }
  const overrides =
    sourceProp !== undefined && schemaProp !== undefined
      ? { source: sourceProp, schema: schemaProp }
      : undefined;
  const hasOverrides = overrides !== undefined;
  const {
    loadingStatus,
    validationErrors,
    patchPath,
    addPatch,
    isExpanded,
    setIsExpanded,
    showEmptyFileOrImage,
    setShowEmptyFileOrImage,
    source,
    schema,
    isBoolean,
    isNullable,
  } = useFieldState(path, type, overrides);
  const effectiveReadonly = readonly || hasOverrides;
  return (
    <div
      className={classNames("px-3 pt-4 pb-3 border rounded-md", {
        "border-bg-error-secondary":
          !hasOverrides && validationErrors.length > 0,
      })}
    >
      <div className="flex justify-between items-center pb-1.5">
        <div className="flex gap-3 items-center">
          {!hasOverrides &&
            schema &&
            !isBoolean &&
            (isNullable || source === null) && (
              <Checkbox
                disabled={effectiveReadonly || loadingStatus === "loading"}
                checked={source !== null || showEmptyFileOrImage}
                onCheckedChange={() => {
                  if (effectiveReadonly) return;
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
                              opt: false,
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
              loadingStatus={effectiveReadonly ? "loading" : loadingStatus}
              source={source as ShallowSource[keyof ShallowSource] | undefined | null}
            />
          )}
          {typeof label === "string" && <Label>{label}</Label>}
          {label && typeof label !== "string" && label}
        </div>
        <div className="flex gap-1.5 items-center">
          {!hasOverrides && source !== null && (
            <div className={classNames({ invisible: effectiveReadonly })}>
              <ArrayAndRecordTools path={path} variant={"field"} />
            </div>
          )}
          {source !== null && !isBoolean && (
            <button
              onClick={() => setIsExpanded((prev) => !prev)}
              className={classNames(
                "transform transition-transform size-5 flex items-center justify-center",
                {
                  "rotate-180": isExpanded,
                },
              )}
            >
              {foldLevel === "1" && <ChevronDown size={14} />}
              {foldLevel === "2" && <ChevronsDown size={14} />}
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
            <AccordionContent>{children}</AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
      {!hasOverrides && validationErrors.length > 0 && (
        <div className="pb-4">
          <FieldValidationError validationErrors={validationErrors} />
        </div>
      )}
    </div>
  );
}
