import {
  Internal,
  ListRecordRender as ListRecordRender,
  ModuleFilePath,
  SourcePath,
} from "@valbuild/core";
import { useMemo } from "react";
import {
  useRenderOverrideAtPath,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
} from "../ValFieldProvider";
import {
  RecordRowSkeleton,
  VirtualizedRecordList,
} from "./VirtualizedRecordList";
import { ModuleGallery } from "./ModuleGallery";
import { useAllValidationErrors } from "../ValErrorProvider";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { useNavigation } from "../../components/ValRouter";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { PreviewWithRender } from "../../components/PreviewWithRender";
import { ValidationErrors } from "../../components/ValidationError";
import type { ValidationError } from "@valbuild/core";
import { isParentError } from "../../utils/isParentError";
import { ErrorIndicator } from "../ErrorIndicator";
import classNames from "classnames";
import { PreviewError } from "../PreviewError";
import { Field } from "../../components/Field";
import { AnyField } from "../../components/AnyField";

export function RecordFields({
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
  const type = "record";
  const validationErrors = useAllValidationErrors() || {};
  const schemaAtPath = useSchemaAtPath(path);
  const renderAtPath = useRenderOverrideAtPath(path);
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
  if (schemaAtPath.data.mediaType) {
    return <ModuleGallery path={path} />;
  }
  const source = sourceAtPath.data;
  const schema = schemaAtPath.data;

  if (inline) {
    const sourceEntries = source as Record<string, SourcePath> | null;
    if (sourceEntries === null) {
      return null;
    }
    return (
      <div id={path}>
        <ValidationErrors path={path} />
        <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
          {schema.item.hidden
            ? null
            : Object.entries(sourceEntries).map(([key, itemPath]) => (
                <Field
                  key={itemPath}
                  label={key}
                  path={itemPath}
                  type={schema.item.type}
                  readonly={readonly || schema.item.readonly}
                  compact={compact}
                  errorDisplay={errorDisplay}
                >
                  <AnyField
                    path={itemPath}
                    schema={schema.item}
                    readonly={readonly || schema.item.readonly}
                    compact={compact}
                    inline={inline}
                    errorDisplay={errorDisplay}
                  />
                </Field>
              ))}
        </div>
      </div>
    );
  }

  const renderListAtPathData =
    renderAtPath &&
    "data" in renderAtPath &&
    renderAtPath.data &&
    renderAtPath.data.layout === "list" &&
    renderAtPath.data.parent === "record"
      ? renderAtPath.data
      : undefined;
  return (
    <div id={path}>
      <ValidationErrors path={path} />
      {renderAtPath?.status === "error" && (
        <PreviewError error={renderAtPath.message} path={path} />
      )}
      {renderListAtPathData && (
        <ListRecordRenderComponent
          path={path}
          jsonValues={schema.jsonValues === true}
          {...renderListAtPathData}
        />
      )}
      {!renderListAtPathData && source && (
        <RecordCardList
          path={path}
          keys={Object.keys(source)}
          jsonValues={schema.jsonValues === true}
          validationErrors={validationErrors}
        />
      )}
    </div>
  );
}

/** Row height estimate for the default card layout (`max-h-[170px]` + gap). */
const CARD_ROW_HEIGHT = 186;
/** Row height estimate for a `.render({layout:"list"})` row. */
const RENDER_ROW_HEIGHT = 104;

function RecordCardList({
  path,
  keys,
  jsonValues,
  validationErrors,
}: {
  path: SourcePath;
  keys: string[];
  jsonValues: boolean;
  validationErrors: Record<SourcePath, ValidationError[]>;
}) {
  const { navigate } = useNavigation();
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const unloadedKeys = useUnloadedJsonEntryKeys(moduleFilePath, jsonValues);
  return (
    <VirtualizedRecordList
      moduleFilePath={moduleFilePath}
      keys={keys}
      estimatedRowHeight={CARD_ROW_HEIGHT}
      jsonValues={jsonValues}
      className="grid grid-cols-1"
      renderRow={(key) => (
        <div className="pb-4">
          <div
            onClick={() => navigate(sourcePathOfItem(path, key))}
            className={classNames(
              "bg-primary-foreground cursor-pointer min-w-[320px] max-h-[170px] overflow-hidden rounded-md border border-border-primary p-4",
              "hover:bg-bg-secondary-hover",
            )}
          >
            <div className="flex justify-between items-start">
              <div className="pb-4 font-semibold text-md">{key}</div>
              {isParentError(sourcePathOfItem(path, key), validationErrors) && (
                <ErrorIndicator />
              )}
            </div>
            <div>
              {unloadedKeys.has(key) ? (
                // An un-loaded `.jsonValues()` entry: a preview here would read
                // the opaque marker, which is what made these lists a wall of
                // spinners.
                <RecordRowSkeleton
                  path={sourcePathOfItem(path, key)}
                  height={96}
                />
              ) : (
                <PreviewWithRender path={sourcePathOfItem(path, key)} />
              )}
            </div>
          </div>
        </div>
      )}
    />
  );
}

/**
 * The record keys of a `.jsonValues()` module whose entry content has not been
 * loaded yet — i.e. whose value in the patched source is still a lazy marker.
 *
 * Computed once for the whole list rather than per row: one source subscription
 * instead of one per visible row.
 */
function useUnloadedJsonEntryKeys(
  moduleFilePath: ModuleFilePath,
  jsonValues: boolean,
): ReadonlySet<string> {
  const moduleSource = useSourceAtPath(moduleFilePath);
  const data = "data" in moduleSource ? moduleSource.data : undefined;
  return useMemo(() => {
    const unloaded = new Set<string>();
    if (
      !jsonValues ||
      data === undefined ||
      data === null ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      return unloaded;
    }
    for (const [key, value] of Object.entries(data)) {
      if (Internal.isJson(value)) {
        unloaded.add(key);
      }
    }
    return unloaded;
  }, [jsonValues, data]);
}

function ListRecordRenderComponent({
  path,
  items,
  jsonValues,
}: {
  path: SourcePath;
  items: ListRecordRender["items"];
  jsonValues: boolean;
}) {
  const { navigate } = useNavigation();
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const unloadedKeys = useUnloadedJsonEntryKeys(moduleFilePath, jsonValues);
  const keys = useMemo(() => items.map(([key]) => key), [items]);
  return (
    <VirtualizedRecordList
      moduleFilePath={moduleFilePath}
      keys={keys}
      estimatedRowHeight={RENDER_ROW_HEIGHT}
      jsonValues={jsonValues}
      className="flex flex-col w-full"
      renderRow={(key) => (
        <div className="pb-4">
          <button
            onClick={() => navigate(sourcePathOfItem(path, key))}
            className={classNames(
              "w-full hover:bg-bg-secondary-hover",
              "border rounded-lg cursor-pointer border-border-primary",
            )}
          >
            {unloadedKeys.has(key) ? (
              <RecordRowSkeleton
                path={sourcePathOfItem(path, key)}
                height={72}
              />
            ) : (
              <PreviewWithRender path={sourcePathOfItem(path, key)} />
            )}
          </button>
        </div>
      )}
    />
  );
}

export function RecordPreview({
  path,
  size,
}: {
  path: SourcePath;
  size?: "compact";
}) {
  const sourceAtPath = useShallowSourceAtPath(path, "record");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  const keys = Object.keys(sourceAtPath.data);
  return (
    <div
      className={`text-left ${
        size === "compact" ? "max-h-[60px] overflow-hidden" : ""
      }`}
    >
      <span className="text-fg-brand-primary">{keys.length}</span>
      <span className="mr-1">{` item${keys.length === 1 ? "" : "s"}:`}</span>
      {keys.map((key, index) => (
        <>
          <span key={key} className="text-fg-brand-primary">
            {key}
          </span>
          {index < keys.length - 1 ? ", " : ""}
        </>
      ))}
    </div>
  );
}
