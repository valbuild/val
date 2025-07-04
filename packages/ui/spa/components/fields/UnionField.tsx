import {
  Json,
  SerializedObjectUnionSchema,
  SerializedStringUnionSchema,
  SerializedUnionSchema,
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
  useValPortal,
} from "../ValProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { emptyOf } from "../../components/fields/emptyOf";
import { AnyField } from "../../components/AnyField";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { useEffect, useRef } from "react";
import { Field } from "../../components/Field";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ObjectLikePreview } from "./ObjectFields";
import { ValidationErrors } from "../../components/ValidationError";
import { isJsonArray } from "../../utils/isJsonArray";

function isStringUnion(
  schema: SerializedUnionSchema,
): schema is SerializedStringUnionSchema {
  if (typeof schema.key === "string") {
    return false;
  }
  return true;
}

export function UnionField({ path }: { path: SourcePath }) {
  const type = "union";
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
  if (isStringUnion(schemaAtPath.data)) {
    if (typeof source !== "string" && source !== null) {
      return (
        <FieldSourceError
          path={path}
          error={"Expected source to be a string, but found: " + typeof source}
          schema={schemaAtPath}
        />
      );
    }
    return (
      <div id={path}>
        <ValidationErrors path={path} />
        <SelectField
          path={path}
          source={source}
          options={schemaAtPath.data.items
            .concat(schemaAtPath.data.key)
            .flatMap((item) => {
              if (item?.type === "literal") {
                return [item.value];
              }
              console.warn("Unexpected item in string union", item);
              return [];
            })}
        />
      </div>
    );
  } else if (!isStringUnion(schemaAtPath.data)) {
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
        <ValidationErrors path={path} />
        <ObjectUnionField path={path} schema={schemaAtPath.data} />
      </div>
    );
  }
}

function ObjectUnionField({
  path,
  schema,
}: {
  path: SourcePath;
  schema: SerializedObjectUnionSchema;
}) {
  const fullSourceAtPath = useSourceAtPath(path);
  const { addPatch, patchPath } = useAddPatch(path);
  const portalContainer = useValPortal();
  const keyPath = sourcePathOfItem(path, schema.key);
  const currentSourceKeyRes = useShallowSourceAtPath(keyPath, "literal");
  if (
    !("data" in currentSourceKeyRes) ||
    currentSourceKeyRes.data === undefined
  ) {
    return <FieldLoading path={path} type="union" />;
  }
  const selectedSchema = schema.items.find((item) => {
    const subSchema = item.items?.[schema.key];
    if (subSchema.type === "literal") {
      return subSchema.value === currentSourceKeyRes.data;
    }
    console.error("Expected literal schema in object union", subSchema);
    return false;
  });
  if (selectedSchema?.items === undefined) {
    return <FieldLoading path={path} type="union" />;
  }

  const options = schema.items.flatMap((item) => {
    const subSchema = item.items?.[schema.key];
    if (subSchema.type === "literal") {
      return [subSchema.value];
    }
    console.error("Expected literal schema in object union", subSchema);
    return [];
  });
  const previouslySelectedSources = useRef<
    Record<SourcePath, Record<string, Json>>
  >({});

  useEffect(() => {
    if (
      fullSourceAtPath !== undefined &&
      currentSourceKeyRes.data !== undefined &&
      typeof currentSourceKeyRes.data === "string" &&
      fullSourceAtPath.status === "success"
    ) {
      if (!previouslySelectedSources.current[path]) {
        previouslySelectedSources.current[path] = {};
      }
      previouslySelectedSources.current[path][currentSourceKeyRes.data] =
        fullSourceAtPath.data;
    }
  }, [fullSourceAtPath, currentSourceKeyRes, path]);
  return (
    <div className="grid gap-4">
      <Select
        value={currentSourceKeyRes.data ?? undefined}
        onValueChange={(value) => {
          const selectedSchema = schema.items.find((item) => {
            const subSchema = item.items?.[schema.key];
            if (subSchema.type === "literal") {
              return subSchema.value === value;
            }
            console.error("Expected literal schema in object union", subSchema);
            return false;
          });
          if (selectedSchema?.items === undefined) {
            console.error(
              `Selected schema with ${schema.key} = ${value} not found`,
            );
            return;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newValue: any =
            previouslySelectedSources.current[path][value] ||
            emptyOf(selectedSchema);
          newValue[schema.key] = value;
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
        }}
      >
        <SelectTrigger>
          <SelectValue>{currentSourceKeyRes.data}</SelectValue>
        </SelectTrigger>
        <SelectContent container={portalContainer} className="w-32">
          {options == undefined ? (
            <LoadingSelectContent />
          ) : (
            options.map((index) => (
              <SelectItem key={index} value={index}>
                {index}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      {Object.keys(selectedSchema?.items)
        .filter((key) => key !== schema?.key)
        .map((key) => {
          const itemPath = sourcePathOfItem(path, key);
          return (
            <Field
              key={itemPath}
              path={itemPath}
              foldLevel="1"
              label={key}
              type={selectedSchema?.items?.[key]?.type}
            >
              <AnyField
                key={key}
                path={itemPath}
                schema={selectedSchema?.items?.[key]}
              />
            </Field>
          );
        })}
    </div>
  );
}

function SelectField({
  path,
  source,
  options,
}: {
  path: SourcePath;
  source: string | null;
  options?: string[];
}) {
  const { addPatch, patchPath } = useAddPatch(path);
  const portalContainer = useValPortal();
  return (
    <Select
      value={source ?? ""}
      onValueChange={(value) => {
        addPatch(
          [
            {
              op: "replace",
              path: patchPath,
              value: value,
            },
          ],
          "union",
        );
      }}
    >
      <SelectTrigger>
        <SelectValue>{source}</SelectValue>
      </SelectTrigger>
      <SelectContent className="w-32" container={portalContainer}>
        {options == undefined ? (
          <LoadingSelectContent />
        ) : (
          options.map((index) => (
            <SelectItem key={index} value={index}>
              {index}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function LoadingSelectContent() {
  return <div>Loading...</div>;
}

export function UnionPreview({ path }: { path: SourcePath }) {
  const type = "union";
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
  if (isStringUnion(schema)) {
    if (typeof sourceAtPath.data !== "string") {
      return (
        <FieldSourceError
          path={path}
          error={
            "Expected source to be a string, but found: " +
            typeof sourceAtPath.data
          }
          schema={schemaAtPath}
        />
      );
    }
    return <div className="truncate">{sourceAtPath.data}</div>;
  } else {
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
            "Expected source to have key " +
            schema.key +
            " but it was not found"
          }
          schema={schemaAtPath}
        />
      );
    }
    return <ObjectLikePreview path={path} schema={actualSchema} />;
  }
}
