import {
  Json,
  SerializedDiscriminatedUnionSchema,
  SerializedObjectSchema,
  SourcePath,
} from "@valbuild/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../designSystem/select";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
} from "../ValFieldProvider";
import { JSONValue } from "@valbuild/core/patch";
import { useValPortal } from "../ValPortalProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { emptyOf } from "@valbuild/shared/internal";
import { AnyField } from "../../components/AnyField";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { useCallback, useEffect, useRef } from "react";
import { Field } from "../../components/Field";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ObjectLikePreview } from "./ObjectFields";
import { isJsonArray } from "../../utils/isJsonArray";
import { fromSelectValue, toSelectValue } from "./selectEmptyValue";

export function DiscriminatedUnionField({
  path,
  readonly,
  compact,
  inline,
  errorDisplay = "default",
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
  inline?: boolean;
  errorDisplay?: "default" | "compact" | "none";
}) {
  const type = "discriminated-union";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={schemaAtPath}
      />
    );
  }
  if (
    sourceAtPath.status == "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type={type} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <FieldLoading path={path} type={type} />;
  }
  if (schemaAtPath.data.type !== type) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }

  const source = sourceAtPath.data;
  // `typeof null === "object"`, so a nullable union holding null used to reach
  // the editor below, where `useDiscriminatedUnion` finds no tag and answers
  // `loading` forever — a spinner that never resolves. It is a real state (an
  // unset optional field), so it previews as null rather than erroring.
  if (source === null) {
    return <PreviewNull path={path} />;
  }
  if (typeof source !== "object") {
    return (
      <FieldSourceError
        path={path}
        error={"Expected source to be an object, but found: " + typeof source}
        schema={schemaAtPath}
      />
    );
  }
  if (Array.isArray(source)) {
    return (
      <FieldSourceError
        path={path}
        error={"Expected source to be an object, but found an array"}
        schema={schemaAtPath}
      />
    );
  }
  return (
    <div id={path}>
      <DiscriminatedUnionFields
        path={path}
        schema={schemaAtPath.data}
        readonly={readonly}
        compact={compact}
        inline={inline}
        errorDisplay={errorDisplay}
      />
    </div>
  );
}

/** What {@link useDiscriminatedUnion} answers. */
export type DiscriminatedUnionState =
  | { status: "loading" }
  | {
      status: "ready";
      /** The variant the value currently takes. */
      selectedSchema: SerializedObjectSchema;
      /** Every tag this union offers, in declaration order. */
      options: string[];
      current: string;
      select: (value: string) => void;
    };

/**
 * The state of a discriminated union at a path: which variant the value takes,
 * what else it could take, and how to switch it.
 *
 * A hook rather than something `DiscriminatedUnionFields` keeps to itself
 * because the union is drawn in two places now — as a field, and as the body
 * of an inline row in `BlockList`, which lays the variant's fields out its own
 * (much denser) way. Switching a tag is the part neither may re-implement: it
 * remembers the source of every tag you leave, so switching away and back
 * gives you what you typed instead of an empty block.
 *
 * It also puts every hook above the loading check. They used to sit on either
 * side of it, which is a rules-of-hooks violation waiting for the first render
 * where the tag has not loaded yet.
 */
export function useDiscriminatedUnion(
  path: SourcePath,
  schema: SerializedDiscriminatedUnionSchema,
): DiscriminatedUnionState {
  const fullSourceAtPath = useSourceAtPath(path);
  const { addPatch, patchPath } = useAddPatch(path);
  const keyPath = sourcePathOfItem(path, schema.key);
  const currentSourceKeyRes = useShallowSourceAtPath(keyPath, "literal");
  const currentKey =
    "data" in currentSourceKeyRes ? currentSourceKeyRes.data : undefined;
  const previouslySelectedSources = useRef<
    Record<SourcePath, Record<string, Json>>
  >({});

  useEffect(() => {
    if (
      fullSourceAtPath !== undefined &&
      typeof currentKey === "string" &&
      fullSourceAtPath.status === "success"
    ) {
      if (!previouslySelectedSources.current[path]) {
        previouslySelectedSources.current[path] = {};
      }
      previouslySelectedSources.current[path][currentKey] =
        fullSourceAtPath.data;
    }
  }, [fullSourceAtPath, currentKey, path]);

  const select = useCallback(
    (value: string) => {
      const selectedSchema = schema.items.find((item) => {
        const subSchema = item.items?.[schema.key];
        if (subSchema.type === "literal") {
          return subSchema.value === value;
        }
        console.error(
          "Expected literal schema in discriminated union",
          subSchema,
        );
        return false;
      });
      if (selectedSchema?.items === undefined) {
        console.error(
          `Selected schema with ${schema.key} = ${value} not found`,
        );
        return;
      }
      /**
       * `Json` is the same shape as `JSONValue` with `readonly` arrays, and a
       * patch op takes the mutable one — the same crossing every `emptyOf(...)
       * as JSONValue` in the Studio makes. This used to be an `any` on the
       * whole value, which took the check off `[schema.key]` too.
       */
      const remembered = previouslySelectedSources.current[path]?.[value] as
        | Record<string, JSONValue>
        | undefined;
      const newValue: JSONValue = {
        ...(remembered ??
          (emptyOf(selectedSchema) as Record<string, JSONValue>)),
        [schema.key]: value,
      };
      addPatch(
        [
          {
            op: "replace",
            path: patchPath,
            value: newValue,
          },
        ],
        schema.type,
      );
    },
    [addPatch, patchPath, path, schema],
  );

  const options = schema.items.flatMap((item) => {
    const subSchema = item.items?.[schema.key];
    if (subSchema.type === "literal") {
      return [subSchema.value];
    }
    console.error("Expected literal schema in discriminated union", subSchema);
    return [];
  });
  const selectedSchema = schema.items.find((item) => {
    const subSchema = item.items?.[schema.key];
    if (subSchema.type === "literal") {
      return subSchema.value === currentKey;
    }
    console.error("Expected literal schema in discriminated union", subSchema);
    return false;
  });
  if (
    typeof currentKey !== "string" ||
    selectedSchema === undefined ||
    selectedSchema.items === undefined
  ) {
    return { status: "loading" };
  }
  return {
    status: "ready",
    selectedSchema,
    options,
    current: currentKey,
    select,
  };
}

/**
 * The tag selector of a discriminated union — the one control that decides
 * which variant is being edited. Shared by the field and by the inline row.
 */
export function DiscriminatedUnionTagSelect({
  state,
  readonly,
  className,
}: {
  state: Extract<DiscriminatedUnionState, { status: "ready" }>;
  readonly?: boolean;
  className?: string;
}) {
  const portalContainer = useValPortal();
  return (
    <Select
      disabled={readonly}
      // `s.literal("")` is a legal tag, and `""` is Radix's placeholder value.
      value={toSelectValue(state.current)}
      onValueChange={(value) => {
        if (readonly) return;
        state.select(fromSelectValue(value));
      }}
    >
      <SelectTrigger className={className}>
        <SelectValue>{state.current}</SelectValue>
      </SelectTrigger>
      <SelectContent container={portalContainer} className="w-32">
        {state.options.map((option) => (
          <SelectItem key={option} value={toSelectValue(option)}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DiscriminatedUnionFields({
  path,
  schema,
  readonly,
  compact,
  inline,
  errorDisplay = "default",
}: {
  path: SourcePath;
  schema: SerializedDiscriminatedUnionSchema;
  readonly?: boolean;
  compact?: boolean;
  inline?: boolean;
  errorDisplay?: "default" | "compact" | "none";
}) {
  const state = useDiscriminatedUnion(path, schema);
  if (state.status === "loading") {
    return <FieldLoading path={path} type="discriminated-union" />;
  }
  const { selectedSchema } = state;
  return (
    <div className={`grid ${compact ? "gap-3" : "gap-4"}`}>
      <DiscriminatedUnionTagSelect state={state} readonly={readonly} />
      {Object.keys(selectedSchema.items)
        .filter((key) => key !== schema?.key)
        .map((key) => {
          const itemPath = sourcePathOfItem(path, key);
          return (
            <Field
              key={itemPath}
              path={itemPath}
              foldLevel="1"
              label={key}
              description={selectedSchema?.items?.[key]?.description}
              type={selectedSchema?.items?.[key]?.type}
              readonly={readonly}
              compact={compact}
              errorDisplay={errorDisplay}
            >
              <AnyField
                key={key}
                path={itemPath}
                schema={selectedSchema?.items?.[key]}
                readonly={readonly}
                compact={compact}
                inline={inline}
                errorDisplay={errorDisplay}
              />
            </Field>
          );
        })}
    </div>
  );
}

export function DiscriminatedUnionPreview({ path }: { path: SourcePath }) {
  const type = "discriminated-union";
  const sourceAtPath = useSourceAtPath(path);
  const schemaAtPath = useSchemaAtPath(path);
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={schemaAtPath}
      />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (!("data" in schemaAtPath) || schemaAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  if (schemaAtPath.data.type !== type) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const schema = schemaAtPath.data;
  const source = sourceAtPath.data;
  if (!source) {
    return <PreviewNull path={path} />;
  }
  if (
    typeof source !== "object" &&
    !(typeof source === "object" && schema.key in source)
  ) {
    return (
      <FieldSourceError
        path={path}
        error={"Expected source to be an object, but found: " + typeof source}
        schema={schemaAtPath}
      />
    );
  }
  const actualSchema = schema.items.find((item) => {
    const keySchema = item.items?.[schema.key];
    if (
      keySchema?.type === "literal" &&
      source !== null &&
      typeof source === "object" &&
      schema.key in source &&
      !isJsonArray(source)
    ) {
      return keySchema.value === source[schema.key];
    }
  });
  if (!actualSchema) {
    return (
      <FieldSourceError
        path={path}
        error={
          "Expected source to have key " + schema.key + " but it was not found"
        }
        schema={schemaAtPath}
      />
    );
  }
  return <ObjectLikePreview path={path} schema={actualSchema} />;
}
