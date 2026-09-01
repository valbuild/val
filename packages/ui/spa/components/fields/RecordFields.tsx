import {
  Internal,
  ModuleFilePath,
  SourcePath,
  isInlineRender,
} from "@valbuild/core";
import { useMemo } from "react";
import {
  usePreviewAtPath,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
} from "../ValFieldProvider";
import {
  RecordRowError,
  RecordRowSkeleton,
  VirtualizedRecordList,
} from "./VirtualizedRecordList";
import { useValSystem } from "../../stores/react/SystemContext";
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
import { RefPreview } from "../../components/RefPreview";
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
  const previewAtPath = usePreviewAtPath(path);
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

  // Entries are rendered in place either because the caller asked for it
  // (`inline` prop) or because the item schema opted in with
  // `.render({ as: "inline" })` — the record counterpart of the inline rows in
  // `SortableList`. Records are unordered, so there is nothing to sort; the key
  // is the row's label.
  if (inline || isInlineRender(schema.item)) {
    const sourceEntries = source as Record<string, SourcePath> | null;
    if (sourceEntries === null) {
      return null;
    }
    return (
      <div id={path}>
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

  const previewAtPathData =
    previewAtPath &&
    "data" in previewAtPath &&
    previewAtPath.data &&
    previewAtPath.data.parent === "record"
      ? previewAtPath.data
      : undefined;
  return (
    <div id={path}>
      {previewAtPath?.status === "error" && (
        <PreviewError error={previewAtPath.message} path={path} />
      )}
      {previewAtPathData && source && (
        <RecordPreviewList
          path={path}
          // The KEYS come from the source, not from the preview's `items`: for a
          // `.jsonValues()` record `items` covers only the loaded entries, and a
          // list that rendered just those could never scroll far enough to load
          // the rest. Each row looks its own item up by key (resolveRefPreview),
          // so a key with no item falls back to a skeleton or the default preview.
          keys={Object.keys(source)}
          jsonValues={schema.jsonValues === true}
        />
      )}
      {!previewAtPathData && source && (
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

/**
 * Row height estimate for the default card layout: gap (16) + border (2) +
 * card padding (32) + key header (40) + {@link PREVIEW_ROW_CONTENT_HEIGHT}.
 */
const CARD_ROW_HEIGHT = 146;
/**
 * Row height estimate for a `.preview(...)` row: gap (16) + border (2) +
 * {@link PREVIEW_ROW_CONTENT_HEIGHT}.
 */
const PREVIEW_ROW_HEIGHT = 74;
/**
 * What `ListPreviewItem` occupies: its own `p-2` (16) around a 40px thumbnail,
 * which is also the tallest the title + subtitle column gets. The skeleton for
 * an un-loaded entry is fixed to this so the virtualizer's measurements do not
 * jump when the entry arrives and the row becomes a real preview.
 */
const PREVIEW_ROW_CONTENT_HEIGHT = 56;

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
  const val = useValSystem();
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const { unloadedKeys, errorByKey } = useJsonEntryRowStates(
    moduleFilePath,
    jsonValues,
  );
  return (
    <VirtualizedRecordList
      moduleFilePath={moduleFilePath}
      keys={keys}
      estimatedRowHeight={CARD_ROW_HEIGHT}
      jsonValues={jsonValues}
      className="grid grid-cols-1"
      renderRow={(key) => {
        const loadError = errorByKey.get(key);
        if (loadError !== undefined) {
          return (
            <div className="pb-4">
              <RecordRowError
                path={sourcePathOfItem(path, key)}
                label={key}
                message={loadError}
                height={96}
                onRetry={() =>
                  void val?.system.sourceStore.retryEntry(moduleFilePath, key)
                }
              />
            </div>
          );
        }
        return (
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
                {isParentError(
                  sourcePathOfItem(path, key),
                  validationErrors,
                ) && <ErrorIndicator />}
              </div>
              <div>
                {unloadedKeys.has(key) ? (
                  // An un-loaded `.jsonValues()` entry: a preview here would read
                  // the opaque marker, which is what made these lists a wall of
                  // spinners.
                  <RecordRowSkeleton
                    path={sourcePathOfItem(path, key)}
                    height={PREVIEW_ROW_CONTENT_HEIGHT}
                  />
                ) : (
                  <RefPreview path={sourcePathOfItem(path, key)} />
                )}
              </div>
            </div>
          </div>
        );
      }}
    />
  );
}

/**
 * Which rows of a `.jsonValues()` record cannot render a preview yet: the ones
 * whose value in the patched source is still a lazy marker, split by whether the
 * load merely has not happened (`unloadedKeys` → skeleton) or FAILED
 * (`errorByKey` → error + retry). A failure is memoized by the engine, so
 * without the split a failed row pulses as a skeleton forever.
 *
 * Computed once for the whole list rather than per row: one source subscription
 * instead of one per visible row.
 */
function useJsonEntryRowStates(
  moduleFilePath: ModuleFilePath,
  jsonValues: boolean,
): {
  unloadedKeys: ReadonlySet<string>;
  errorByKey: ReadonlyMap<string, string>;
} {
  const val = useValSystem();
  const moduleSource = useSourceAtPath(moduleFilePath);
  const data = "data" in moduleSource ? moduleSource.data : undefined;
  return useMemo(() => {
    const unloadedKeys = new Set<string>();
    const errorByKey = new Map<string, string>();
    if (
      !jsonValues ||
      data === undefined ||
      data === null ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      return { unloadedKeys, errorByKey };
    }
    for (const [key, value] of Object.entries(data)) {
      if (!Internal.isJson(value)) {
        continue;
      }
      const error = val?.system.sourceStore.entryError(moduleFilePath, key);
      if (error !== undefined) {
        errorByKey.set(key, error);
      } else {
        unloadedKeys.add(key);
      }
    }
    return { unloadedKeys, errorByKey };
    // `SourceStore.loadEntry` records the failure before it settles, and a
    // failure leaves the marker in place — so the module source this memo
    // depends on has not changed, and the memo would not re-run on its own.
    // It does not need to: `peek` reports `entry-failed` for a path inside the
    // entry, which is what wakes the row, and this map is read on that render.
  }, [jsonValues, data, val, moduleFilePath]);
}

function RecordPreviewList({
  path,
  keys,
  jsonValues,
}: {
  path: SourcePath;
  /** Every key of the record, in source order — see the call site. */
  keys: string[];
  jsonValues: boolean;
}) {
  const { navigate } = useNavigation();
  const val = useValSystem();
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const { unloadedKeys, errorByKey } = useJsonEntryRowStates(
    moduleFilePath,
    jsonValues,
  );
  return (
    <VirtualizedRecordList
      moduleFilePath={moduleFilePath}
      keys={keys}
      estimatedRowHeight={PREVIEW_ROW_HEIGHT}
      jsonValues={jsonValues}
      className="flex flex-col w-full"
      renderRow={(key) => {
        const loadError = errorByKey.get(key);
        if (loadError !== undefined) {
          return (
            <div className="pb-4">
              <RecordRowError
                path={sourcePathOfItem(path, key)}
                label={key}
                message={loadError}
                height={72}
                onRetry={() =>
                  void val?.system.sourceStore.retryEntry(moduleFilePath, key)
                }
              />
            </div>
          );
        }
        return (
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
                  height={PREVIEW_ROW_CONTENT_HEIGHT}
                />
              ) : (
                <RefPreview path={sourcePathOfItem(path, key)} />
              )}
            </button>
          </div>
        );
      }}
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
