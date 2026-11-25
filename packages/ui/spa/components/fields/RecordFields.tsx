import { LabeledField } from "../LabeledField";
import {
  Internal,
  ModuleFilePath,
  SourcePath,
  isInlineRender,
} from "@valbuild/core";
import { useMemo, useState, type ReactNode } from "react";
import { hasLocaleRouteParam, isLocaleSchema } from "@valbuild/shared/internal";
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
import type { EntryRowStates } from "../../stores/SourceStore";
import { ModuleGallery } from "./ModuleGallery";
import { useAllValidationErrors } from "../ValErrorProvider";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { useLocaleFilterPredicate } from "../LocaleFilterProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { useNavigation } from "../../components/ValRouter";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { RefPreview } from "../../components/RefPreview";
import { CARD_MAX_FIELDS } from "../../components/SortableList";
import type { ValidationError } from "@valbuild/core";
import { isParentError } from "../../utils/isParentError";
import { ErrorIndicator } from "../ErrorIndicator";
import classNames from "classnames";
import { PreviewError } from "../PreviewError";
import { LocaleFiltered } from "../LocaleFilterProvider";
import { FieldNull } from "../../components/FieldNull";
import { ContentViewsBadge } from "../../analytics/ContentViewsBadge";
import { BlockList } from "../../components/BlockList";

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
  const matchesLocale = useLocaleFilterPredicate();
  const schemaAtPath = useSchemaAtPath(path);
  const previewAtPath = usePreviewAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  /**
   * Which list this record draws: preview rows or cards, and the one it drew
   * last while its preview is being recomputed.
   *
   * Read off the preview, which has no data while it is owed again -- and
   * every batch of `.jsonValues()` entries that lands makes it owed. Drawing
   * cards for that moment and preview rows after it is two different lists,
   * so a new scroll viewport each time, back at the top: scrolling a record
   * of 1,000 posts went back to the top every few screens. Held in state, not
   * a ref (`architecture/quirks.md`, "A ref mutated during render").
   */
  const listKind = recordListKind(previewAtPath);
  const [heldListKind, setHeldListKind] = useState<RecordListKind>(
    listKind ?? "cards",
  );
  if (listKind !== null && listKind !== heldListKind) {
    setHeldListKind(listKind);
  }
  const shownListKind = listKind ?? heldListKind;
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
  const schema = schemaAtPath.data;
  // BEFORE the media dispatch below, and that order is the point. A record
  // that has not been created renders nothing on either path — which reads as
  // "this record is empty", a different and writable state. A gallery is the
  // case where that is not merely misleading: `s.imagedir().nullable()` keeps
  // its media options, so a null one reached `ModuleGallery`, looked like an
  // empty gallery, and offered an upload whose `add` patch targeted `null`.
  // See `FieldNull`.
  if (source === null) {
    return <FieldNull path={path} schema={schema} readonly={readonly} />;
  }
  if (schema.mediaType) {
    return <ModuleGallery path={path} />;
  }
  /**
   * The keys the locale filter leaves on screen.
   *
   * A locale-keyed record is the case where a key IS a language, so the filter
   * can answer from the key alone — no entry has to be loaded to know it is
   * Norwegian. Every other record is untouched, because its keys say nothing
   * about language.
   */
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const router =
    schema.router !== undefined ? { schema, moduleFilePath } : undefined;
  const visibleKeys = (keys: string[]): string[] =>
    keys.filter((key) =>
      matchesLocale({
        key,
        keySchema: schema.key,
        router,
        path: sourcePathOfItem(path, key),
      }),
    );

  /**
   * Whether the KEY already answered the filter for every row.
   *
   * For a locale-keyed record it did — `visibleKeys` filtered on it — and
   * asking each entry again is the same question with three subscriptions
   * attached per row. It could not even disagree: a locale-keyed record opens a
   * scope, and a scope may not contain another, so the entry has no locale of
   * its own to find.
   *
   * A router whose routes name their language (`/nb/news/…`) is the same case:
   * the key is the language, and a page of it may not have a locale field too.
   *
   * Every other record's keys say nothing about language, so there the entry is
   * the only thing that can answer and `LocaleFiltered` does the work.
   */
  const keyDecidesLocale =
    (schema.key !== undefined && isLocaleSchema(schema.key)) ||
    hasLocaleRouteParam(schema);

  // The record's own render picks the list, before the `inline` prop — the
  // same order as `ArrayFields`, and for the same reason: an inline record and
  // an inline array are the same block list, so they look the same. The key is
  // the row's label where an array has its index.
  if (isInlineRender(schema)) {
    return (
      <div className="relative w-full">
        {previewAtPath?.status === "error" && (
          <PreviewError error={previewAtPath.message} path={path} />
        )}
        <BlockList path={path} readonly={readonly} />
      </div>
    );
  }
  // Entries rendered in place because the CALLER asked for it (`inline`
  // prop). Records are unordered, so there is nothing to sort; the key is the
  // row's label.
  if (inline) {
    return (
      <div id={path}>
        <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
          {schema.item.hidden
            ? null
            : Object.entries(source)
                .filter(([key, itemPath]) =>
                  matchesLocale({
                    key,
                    keySchema: schema.key,
                    router,
                    path: itemPath,
                  }),
                )
                .map(([key, itemPath]) => (
                  <LocaleFilteredRow
                    key={itemPath}
                    path={itemPath}
                    alreadyFiltered={keyDecidesLocale}
                  >
                    <LabeledField
                      label={key}
                      path={itemPath}
                      schema={schema.item}
                      readonly={readonly || schema.item.readonly}
                      compact={compact}
                      inline={inline}
                      errorDisplay={errorDisplay}
                    />
                  </LocaleFilteredRow>
                ))}
        </div>
      </div>
    );
  }

  return (
    <div id={path}>
      {previewAtPath?.status === "error" && (
        <PreviewError error={previewAtPath.message} path={path} />
      )}
      {shownListKind === "preview" && (
        <RecordPreviewList
          path={path}
          // The KEYS come from the source, not from the preview's `items`: for a
          // `.jsonValues()` record `items` covers only the loaded entries, and a
          // list that rendered just those could never scroll far enough to load
          // the rest. Each row looks its own item up by key (resolveRefPreview),
          // so a key with no item falls back to a skeleton or the default preview.
          keys={visibleKeys(Object.keys(source))}
          jsonValues={schema.jsonValues === true}
          keyDecidesLocale={keyDecidesLocale}
        />
      )}
      {shownListKind === "cards" && (
        <RecordCardList
          path={path}
          keys={visibleKeys(Object.keys(source))}
          jsonValues={schema.jsonValues === true}
          validationErrors={validationErrors}
          keyDecidesLocale={keyDecidesLocale}
        />
      )}
    </div>
  );
}

type RecordListKind = "preview" | "cards";

/**
 * Preview rows when the record's preview names its rows, cards when it has
 * none -- or null while it is being computed, which says neither.
 */
function recordListKind(
  preview: ReturnType<typeof usePreviewAtPath>,
): RecordListKind | null {
  if (preview?.status === "loading") {
    return null;
  }
  return preview !== undefined &&
    "data" in preview &&
    preview.data &&
    preview.data.rows?.parent === "record"
    ? "preview"
    : "cards";
}

/**
 * What an unwritten row is called.
 *
 * A locale-keyed record holds every declared language, so a row whose entry is
 * `null` is a language nobody has translated into — the state the whole design
 * exists to make countable. The generic `<empty>` said the same thing as a row
 * whose content happens to be blank, which is the one distinction that matters
 * here. Every other record keeps the generic wording: its keys say nothing
 * about language, so there is nothing better to call it.
 */
const UNTRANSLATED_LABEL = (keyDecidesLocale: boolean): string | undefined =>
  keyDecidesLocale ? "Not translated" : undefined;

/**
 * Row height estimate for the default card layout: gap (16) + border (2) +
 * card padding (24) + key header (28) + {@link PREVIEW_ROW_CONTENT_HEIGHT}.
 * A card with no `.preview()` is at most {@link CARD_MAX_FIELDS} lines, so the
 * estimate is never off by more than a line or so.
 */
const CARD_ROW_HEIGHT = 126;
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

/**
 * A record row, filtered by the locale picker unless the KEY already answered.
 *
 * `LocaleFiltered` costs a schema lookup and two source reads per row, so it is
 * worth not asking when the answer is known: see `keyDecidesLocale` in
 * `RecordFields`.
 */
function LocaleFilteredRow({
  path,
  alreadyFiltered,
  children,
}: {
  path: SourcePath;
  alreadyFiltered: boolean;
  children: ReactNode;
}) {
  if (alreadyFiltered) {
    return <>{children}</>;
  }
  return <LocaleFiltered path={path}>{children}</LocaleFiltered>;
}

function RecordCardList({
  path,
  keys,
  jsonValues,
  validationErrors,
  keyDecidesLocale,
}: {
  path: SourcePath;
  keys: string[];
  jsonValues: boolean;
  validationErrors: Record<SourcePath, ValidationError[]>;
  /** `keys` is already locale-filtered — see `keyDecidesLocale` in `RecordFields`. */
  keyDecidesLocale: boolean;
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
          <LocaleFilteredRow
            path={sourcePathOfItem(path, key)}
            alreadyFiltered={keyDecidesLocale}
          >
            <div className="pb-4">
              <div
                onClick={() => navigate(sourcePathOfItem(path, key))}
                className={classNames(
                  // `min-w-0`, and no fixed minimum: a minimum wider than a
                  // narrow pane is the card sticking out of it.
                  "bg-bg-primary cursor-pointer min-w-0 max-h-[170px] overflow-hidden rounded-md border border-border-primary p-3",
                  "hover:bg-bg-secondary-hover",
                )}
              >
                <div className="flex justify-between items-start gap-2">
                  <div
                    className="min-w-0 pb-2 font-semibold truncate text-md"
                    title={key}
                  >
                    {key}
                  </div>
                  <ContentViewsBadge
                    path={sourcePathOfItem(path, key)}
                    className="ml-auto"
                  />
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
                    <RefPreview
                      path={sourcePathOfItem(path, key)}
                      nullLabel={UNTRANSLATED_LABEL(keyDecidesLocale)}
                      // The card is padded already; the preview's own `p-2`
                      // indented the fields against the key above them.
                      className="p-0"
                      maxFields={CARD_MAX_FIELDS}
                    />
                  )}
                </div>
              </div>
            </div>
          </LocaleFilteredRow>
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
): EntryRowStates {
  const val = useValSystem();
  // What wakes this: the module's source moving. The answer itself is the
  // store's, worked out once per view (`SourceStore.rowStates`): deriving it
  // here asked `entryError` for every key of the record on every render.
  const moduleSource = useSourceAtPath(moduleFilePath);
  const data = "data" in moduleSource ? moduleSource.data : undefined;
  return useMemo(() => {
    if (!jsonValues || val === null) {
      return NO_ROW_STATES;
    }
    return val.system.sourceStore.rowStates(moduleFilePath);
    // `SourceStore.loadEntry` records the failure before it settles, and a
    // failure leaves the marker in place — so the module source this memo
    // depends on has not changed, and the memo would not re-run on its own.
    // It does not need to: `peek` reports `entry-failed` for a path inside the
    // entry, which is what wakes the row, and this map is read on that render.
  }, [jsonValues, data, val, moduleFilePath]);
}

const NO_ROW_STATES: EntryRowStates = {
  unloadedKeys: new Set(),
  errorByKey: new Map(),
};

function RecordPreviewList({
  path,
  keys,
  jsonValues,
  keyDecidesLocale,
}: {
  path: SourcePath;
  /** Every key of the record, in source order — see the call site. */
  keys: string[];
  jsonValues: boolean;
  /** `keys` is already locale-filtered — see `keyDecidesLocale` in `RecordFields`. */
  keyDecidesLocale: boolean;
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
          <LocaleFilteredRow
            path={sourcePathOfItem(path, key)}
            alreadyFiltered={keyDecidesLocale}
          >
            <div className="pb-4">
              <button
                onClick={() => navigate(sourcePathOfItem(path, key))}
                className={classNames(
                  "w-full hover:bg-bg-secondary-hover",
                  "border rounded-lg cursor-pointer border-border-primary",
                )}
              >
                <div className="flex items-start gap-1">
                  <div className="flex-1 min-w-0">
                    {unloadedKeys.has(key) ? (
                      <RecordRowSkeleton
                        path={sourcePathOfItem(path, key)}
                        height={PREVIEW_ROW_CONTENT_HEIGHT}
                      />
                    ) : (
                      <RefPreview
                        path={sourcePathOfItem(path, key)}
                        nullLabel={UNTRANSLATED_LABEL(keyDecidesLocale)}
                      />
                    )}
                  </div>
                  <ContentViewsBadge
                    path={sourcePathOfItem(path, key)}
                    className="mt-2 mr-2"
                  />
                </div>
              </button>
            </div>
          </LocaleFilteredRow>
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
