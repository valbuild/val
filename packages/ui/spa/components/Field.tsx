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
import { FieldPatchAuthorsSection } from "./FieldPatchAuthorsSection";
import { ShallowSource } from "./ValFieldProvider";
import { useFieldState } from "./useFieldState";

export function Field({
  label,
  children,
  path,
  transparent,
  type,
  readonly,
  compact,
  foldLevel = "1",
  source: sourceProp,
  schema: schemaProp,
  initialExpanded,
}: {
  label?: string | React.ReactNode;
  children: React.ReactNode;
  path: SourcePath;
  transparent?: boolean;
  type: SerializedSchema["type"];
  readonly?: boolean;
  compact?: boolean;
  foldLevel?: "2" | "1";
  source?: Json | null;
  schema?: SerializedSchema;
  initialExpanded?: boolean;
}) {
  if ((sourceProp !== undefined) !== (schemaProp !== undefined)) {
    throw new Error(
      "Field: source and schema must both be provided or both omitted",
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
  } = useFieldState(path, type, overrides, initialExpanded);
  const effectiveReadonly = readonly || hasOverrides;
  return (
    <div
      className={classNames("border", {
        "px-4 pt-6 pb-4 rounded-lg": !compact,
        "px-3 pt-2 pb-2 rounded-md": compact,
        "bg-bg-tertiary": !transparent && !compact,
        "border-bg-error-secondary":
          !hasOverrides && validationErrors.length > 0,
      })}
    >
      <div
        className={classNames("flex justify-between items-center", {
          "pb-2": !compact,
          "pb-1.5": compact,
        })}
      >
        <div
          className={classNames("flex items-center", {
            "gap-4": !compact,
            "gap-3": compact,
            "pt-2": compact && isBoolean,
          })}
        >
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
              source={
                source as ShallowSource[keyof ShallowSource] | undefined | null
              }
            />
          )}
          {typeof label === "string" && <Label>{label}</Label>}
          {label && typeof label !== "string" && label}
        </div>
        <div
          className={classNames("flex items-center", {
            "gap-2": !compact,
            "gap-1.5": compact,
          })}
        >
          {!hasOverrides && !compact && (
            <FieldPatchAuthorsSection path={path} />
          )}
          {!hasOverrides && source !== null && (
            <div className={classNames({ invisible: effectiveReadonly })}>
              <ArrayAndRecordTools path={path} variant={"field"} />
            </div>
          )}
          {source !== null && !isBoolean && (
            <button
              onClick={() => setIsExpanded((prev) => !prev)}
              className={classNames(
                "transform transition-transform flex items-center justify-center",
                {
                  "size-6 m-[1px]": !compact,
                  "size-5": compact,
                  "rotate-180": isExpanded,
                },
              )}
            >
              {foldLevel === "1" && <ChevronDown size={compact ? 14 : 16} />}
              {foldLevel === "2" && <ChevronsDown size={compact ? 14 : 16} />}
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
        <div className={compact ? "pb-4" : "pb-8"}>
          <FieldValidationError validationErrors={validationErrors} />
        </div>
      )}
    </div>
  );
}
