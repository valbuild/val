import { Json, SerializedSchema, SourcePath } from "@valbuild/core";
import { Label } from "./Label";
import { fromCamelToTitleCase } from "../utils/prettifyText";
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
import { ShallowSource, useAllSources, useSchemas } from "./ValFieldProvider";
import { useFieldState } from "./useFieldState";
import { useNavigation } from "./ValRouter";
import { getNavPathFromAll } from "./getNavPath";

export function Field({
  label,
  description,
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
  errorDisplay = "default",
}: {
  label?: string | React.ReactNode;
  description?: string;
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
  errorDisplay?: "default" | "compact" | "none";
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
  const { navigate } = useNavigation();
  const schemas = useSchemas();
  const allSources = useAllSources();
  const handleLabelNavigate = () => {
    const schemasData = schemas.status === "success" ? schemas.data : undefined;
    const navPath = getNavPathFromAll(path, allSources, schemasData);
    const target = navPath ?? path;
    navigate(target, {
      scrollToPath: target !== path ? path : undefined,
    });
  };
  const labelClickable = errorDisplay === "compact";
  return (
    <div
      data-val-studio-path={path}
      className={classNames("border", {
        "px-4 pt-6 pb-4 rounded-lg": !compact,
        "px-3 pt-2 pb-2 rounded-md": compact,
        "bg-bg-tertiary": !transparent && !compact,
        "border-bg-warning-secondary":
          !hasOverrides &&
          errorDisplay === "default" &&
          validationErrors.length > 0,
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
          <div className="flex flex-col gap-1">
            {typeof label === "string" &&
              (labelClickable ? (
                <button
                  onClick={handleLabelNavigate}
                  className="font-mono text-sm px-2 py-0.5 rounded bg-bg-secondary text-fg-primary truncate cursor-pointer hover:bg-bg-tertiary transition-colors min-w-0 block"
                >
                  {fromCamelToTitleCase(label)}
                </button>
              ) : (
                <Label>{label}</Label>
              ))}
            {label && typeof label !== "string" && label}
            {description && (
              <div className="text-sm text-fg-tertiary">{description}</div>
            )}
          </div>
        </div>
        <div
          className={classNames("flex items-center", {
            "gap-2 min-h-8": !compact,
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
      {!hasOverrides &&
        errorDisplay === "default" &&
        validationErrors.length > 0 && (
          <div className={compact ? "pb-0" : "pb-2"}>
            <FieldValidationError validationErrors={validationErrors} />
          </div>
        )}
    </div>
  );
}
