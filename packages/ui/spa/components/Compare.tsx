import {
  Json,
  SerializedSchema,
  VAL_EXTENSION,
  FILE_REF_PROP,
  Internal,
  RichTextSource,
  AllRichTextOptions,
  ReifiedRender,
} from "@valbuild/core";
import {
  PatchSetComparison,
  generateChangeDescription,
  getChangeType,
} from "../utils/comparePatchSets";
import { cn } from "./designSystem/cn";
import { useRichTextEditor } from "./RichTextEditor";
import { ReadOnlyRichTextEditor } from "./ReadOnlyRichTextEditor";
import { richTextToRemirror } from "@valbuild/shared/internal";
import { CodeEditor } from "./CodeEditor";
import { InlineTextDiff } from "./InlineTextDiff";
import { InlineRichTextDiff } from "./InlineRichTextDiff";
import { AuthorAvatarGroup } from "./AuthorAvatar";
import {
  Pencil,
  Plus,
  Minus,
  ArrowRightLeft,
  RefreshCw,
  FileCode2,
  FileInput,
  FileOutput,
} from "lucide-react";
import { useState } from "react";
import { Button } from "./designSystem/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./designSystem/tooltip";

export function Compare({
  comparisons,
  className,
}: {
  comparisons: PatchSetComparison[];
  className?: string;
}) {
  // Track which move operations we've already displayed
  const displayedMoves = new Set<number>();

  return (
    <TooltipProvider>
      <div className={cn("space-y-6", className)}>
        {comparisons.map((comparison, index) => {
          // Skip if this is a destination of a move we've already shown
          if (
            comparison.moveOperation?.type === "destination" &&
            comparison.moveOperation.pairIndex !== undefined &&
            displayedMoves.has(comparison.moveOperation.pairIndex)
          ) {
            return null;
          }

          // If this is a move source, mark both as displayed
          if (comparison.moveOperation?.type === "source") {
            displayedMoves.add(index);
            if (comparison.moveOperation.pairIndex !== undefined) {
              displayedMoves.add(comparison.moveOperation.pairIndex);
            }
            return (
              <MoveComparisonItem
                key={index}
                sourceComparison={comparison}
                destinationComparison={
                  comparison.moveOperation.pairIndex !== undefined
                    ? comparisons[comparison.moveOperation.pairIndex]
                    : undefined
                }
              />
            );
          }

          return <ComparisonItem key={index} comparison={comparison} />;
        })}
      </div>
    </TooltipProvider>
  );
}

function MoveComparisonItem({
  sourceComparison,
  destinationComparison,
}: {
  sourceComparison: PatchSetComparison;
  destinationComparison?: PatchSetComparison;
}) {
  if (!destinationComparison) {
    // Fallback to regular display if destination not found
    return <ComparisonItem comparison={sourceComparison} />;
  }

  const [viewMode, setViewMode] = useState<"diff" | "before" | "after">("diff");
  const sourceKey = sourceComparison.patchSet.patchPath.slice(-1)[0];
  const destinationKey = destinationComparison.patchSet.patchPath.slice(-1)[0];
  const parentPath = sourceComparison.patchSet.patchPath.slice(0, -1);

  const changeDescription = `Renamed from ${sourceKey} to ${destinationKey}`;

  // Collect all unique authors from all patches
  const authors = sourceComparison.patchSet.patches
    .map((p) => p.author)
    .filter((author): author is string => author !== null);

  // Construct source path for clickable link
  const sourcePath = `${sourceComparison.patchSet.moduleFilePath}#${parentPath.join(".")}`;

  return (
    <div className="border border-border-primary border-l-4 border-l-brand-primary rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Header with move operation metadata */}
      <div className="bg-bg-secondary px-4 py-3 border-b border-border-primary">
        <div className="flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0">
              <ArrowRightLeft className="w-5 h-5 text-fg-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <a
                href={sourcePath}
                className="font-medium text-fg-primary text-sm hover:underline cursor-pointer block"
                onClick={(e) => {
                  e.preventDefault();
                  console.log("Navigate to:", sourcePath);
                }}
              >
                {changeDescription}
              </a>
              <div className="text-xs text-fg-secondary mt-0.5">
                /{parentPath.join("/")}
                {sourceComparison.patchSet.lastUpdated && (
                  <span className="ml-2">
                    {new Date(
                      sourceComparison.patchSet.lastUpdated,
                    ).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setViewMode("diff")}
                  variant={viewMode === "diff" ? "default" : "ghost"}
                  size="sm"
                >
                  <FileCode2 size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Show key change</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setViewMode("before")}
                  variant={viewMode === "before" ? "default" : "ghost"}
                  size="sm"
                >
                  <FileInput size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Show with old key</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setViewMode("after")}
                  variant={viewMode === "after" ? "default" : "ghost"}
                  size="sm"
                >
                  <FileOutput size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Show with new key</TooltipContent>
            </Tooltip>
            {authors.length > 0 && <AuthorAvatarGroup authors={authors} />}
          </div>
        </div>
      </div>

      {/* Content */}
      {viewMode === "diff" ? (
        <div className="grid grid-cols-2 divide-x divide-border-primary">
          <div className="p-4 bg-bg-primary">
            <div className="text-xs font-semibold text-fg-secondary mb-3 uppercase tracking-wide">
              Old Key
            </div>
            <code className="px-3 py-2 bg-bg-tertiary text-fg-error-primary rounded border border-error-primary font-mono text-sm block">
              {sourceKey}
            </code>
          </div>
          <div className="p-4 bg-bg-primary">
            <div className="text-xs font-semibold text-fg-secondary mb-3 uppercase tracking-wide">
              New Key
            </div>
            <code className="px-3 py-2 bg-bg-tertiary text-fg-brand-secondary rounded border border-brand-secondary font-mono text-sm block">
              {destinationKey}
            </code>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-bg-primary">
          <div className="text-xs font-semibold text-fg-secondary mb-3 uppercase tracking-wide">
            {viewMode === "before"
              ? `Value at ${sourceKey}`
              : `Value at ${destinationKey}`}
          </div>
          <CompareValue
            value={sourceComparison.before}
            schema={sourceComparison.beforeSchema}
            render={sourceComparison.render}
          />
        </div>
      )}
    </div>
  );
}

function ComparisonItem({ comparison }: { comparison: PatchSetComparison }) {
  const { before, after, beforeSchema, afterSchema, render } = comparison;
  const changeType = getChangeType(comparison);

  // Default view mode based on change type
  const getDefaultViewMode = (): "diff" | "before" | "after" => {
    if (changeType === "add") return "after";
    if (changeType === "remove") return "before";
    return "diff";
  };

  const [viewMode, setViewMode] = useState<"diff" | "before" | "after">(
    getDefaultViewMode(),
  );
  const changeDescription = generateChangeDescription(comparison);

  // Collect all unique authors from all patches
  const authors = comparison.patchSet.patches
    .map((p) => p.author)
    .filter((author): author is string => author !== null);

  // Construct source path for clickable link
  const patchPath = comparison.patchSet.patchPath;
  const sourcePath = `${comparison.patchSet.moduleFilePath}#${patchPath.join(".")}`;

  const IconComponent = {
    add: Plus,
    remove: Minus,
    edit: Pencil,
    move: ArrowRightLeft,
    multiple: RefreshCw,
  }[changeType];

  const borderColor = {
    add: "border-l-4 border-l-fg-secondary",
    remove: "border-l-4 border-l-fg-error-primary",
    edit: "border-l-4 border-l-fg-primary",
    move: "border-l-4 border-l-fg-primary",
    multiple: "border-l-4 border-l-fg-secondary",
  }[changeType];

  return (
    <div
      className={cn(
        "border border-border-primary rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow",
        borderColor,
      )}
    >
      {/* Header with change metadata */}
      <div className="bg-bg-secondary px-4 py-3 border-b border-border-primary">
        <div className="flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0">
              <IconComponent className="w-5 h-5 text-fg-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <a
                href={sourcePath}
                className="font-medium text-fg-primary text-sm hover:underline cursor-pointer block"
                onClick={(e) => {
                  e.preventDefault();
                  console.log("Navigate to:", sourcePath);
                }}
              >
                {changeDescription}
              </a>
              <div className="text-xs text-fg-secondary mt-0.5">
                {comparison.patchSet.patches.length} change
                {comparison.patchSet.patches.length !== 1 ? "s" : ""}
                {comparison.patchSet.lastUpdated && (
                  <span className="ml-2">
                    {new Date(comparison.patchSet.lastUpdated).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => setViewMode("diff")}
                  variant={viewMode === "diff" ? "default" : "ghost"}
                  size="sm"
                >
                  <FileCode2 size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Show diff</TooltipContent>
            </Tooltip>
            {changeType !== "add" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setViewMode("before")}
                    variant={viewMode === "before" ? "default" : "ghost"}
                    size="sm"
                  >
                    <FileInput size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Show previous</TooltipContent>
              </Tooltip>
            )}
            {changeType !== "remove" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setViewMode("after")}
                    variant={viewMode === "after" ? "default" : "ghost"}
                    size="sm"
                  >
                    <FileOutput size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Show current</TooltipContent>
              </Tooltip>
            )}
            {authors.length > 0 && <AuthorAvatarGroup authors={authors} />}
          </div>
        </div>
      </div>

      {/* Comparison grid */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-primary"
        key={viewMode}
      >
        {viewMode === "diff" ? (
          <>
            {/* Show inline diff for string changes */}
            {changeType === "edit" &&
            typeof before === "string" &&
            typeof after === "string" &&
            before !== after ? (
              <div className="p-4 bg-bg-primary col-span-1 md:col-span-2">
                <div className="text-xs font-semibold text-fg-secondary mb-3 uppercase tracking-wide">
                  Changes
                </div>
                <InlineTextDiff before={before} after={after} />
              </div>
            ) : changeType === "edit" &&
              Array.isArray(before) &&
              Array.isArray(after) &&
              beforeSchema?.type === "richtext" &&
              afterSchema?.type === "richtext" ? (
              <div className="p-4 bg-bg-primary col-span-1 md:col-span-2">
                <div className="text-xs font-semibold text-fg-secondary mb-3 uppercase tracking-wide">
                  Changes
                </div>
                <InlineRichTextDiff
                  before={before as RichTextSource<AllRichTextOptions>}
                  after={after as RichTextSource<AllRichTextOptions>}
                  options={beforeSchema.options}
                />
              </div>
            ) : (
              <>
                <div className="p-4 bg-bg-primary">
                  <div className="text-xs font-semibold text-fg-secondary mb-3 uppercase tracking-wide">
                    Previous
                  </div>
                  <CompareValue
                    value={before}
                    schema={beforeSchema}
                    render={render}
                  />
                </div>
                <div className="p-4 bg-bg-primary">
                  <div className="text-xs font-semibold text-fg-secondary mb-3 uppercase tracking-wide">
                    Current
                  </div>
                  <CompareValue
                    value={after}
                    schema={afterSchema}
                    render={render}
                  />
                </div>
              </>
            )}
          </>
        ) : viewMode === "before" && changeType !== "add" ? (
          <div className="p-4 bg-bg-primary col-span-1 md:col-span-2">
            <div className="text-xs font-semibold text-fg-secondary mb-3 uppercase tracking-wide">
              Previous
            </div>
            <CompareValue
              value={before}
              schema={beforeSchema}
              render={render}
            />
          </div>
        ) : viewMode === "after" && changeType !== "remove" ? (
          <div className="p-4 bg-bg-primary col-span-1 md:col-span-2">
            <div className="text-xs font-semibold text-fg-secondary mb-3 uppercase tracking-wide">
              Current
            </div>
            <CompareValue value={after} schema={afterSchema} render={render} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompareValue({
  value,
  schema,
  render,
}: {
  value: Json;
  schema: SerializedSchema | undefined;
  render?: ReifiedRender;
}) {
  if (!schema) {
    return <CompareNullField value={value} />;
  }

  switch (schema.type) {
    case "keyOf":
    case "route":
    case "string":
    case "date":
      return <CompareStringField value={value} render={render} />;
    case "number":
      return <CompareNumberField value={value} />;
    case "boolean":
      return <CompareBooleanField value={value} />;
    case "object":
      return <CompareObjectField value={value} schema={schema} />;
    case "array":
      return <CompareArrayField value={value} schema={schema} />;
    case "record":
      return <CompareRecordField value={value} schema={schema} />;
    case "union":
      return <CompareUnionField value={value} schema={schema} />;
    case "literal":
      return <CompareLiteralField value={value} />;
    case "richtext":
      return <CompareRichTextField value={value} schema={schema} />;
    case "image":
      return <CompareImageField value={value} />;
    case "file":
      return <CompareFileField value={value} />;
    default: {
      // Exhaustive check
      const _exhaustiveCheck: never = schema;
      console.warn("Unhandled schema type in CompareValue:", _exhaustiveCheck);
      return <CompareDefaultField value={value} />;
    }
  }
}

function CompareNullField({ value }: { value: Json }) {
  if (value === null || value === undefined) {
    return (
      <div className="text-fg-tertiary italic text-sm p-2 bg-bg-tertiary rounded border border-dashed border-border-secondary">
        (empty)
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareStringField({
  value,
  render,
}: {
  value: Json;
  render?: ReifiedRender;
}) {
  if (typeof value === "string") {
    // Check if render specifies code layout
    const renderData = render && Object.values(render)[0];
    const isCodeLayout =
      renderData?.status === "success" && renderData.data.layout === "code";

    if (isCodeLayout && renderData.status === "success") {
      const language =
        "language" in renderData.data ? renderData.data.language : "typescript";
      return (
        <div className="[&_.cm-editor]:bg-bg-tertiary [&_.cm-editor]:rounded [&_.cm-editor]:border [&_.cm-editor]:border-border-secondary">
          <CodeEditor
            language={language}
            value={value}
            onChange={() => {}} // Read-only
            options={{
              lineNumbers: true,
              foldGutter: true,
            }}
          />
        </div>
      );
    }

    return (
      <div className="font-mono text-sm p-2 bg-bg-tertiary rounded border border-border-secondary whitespace-pre-wrap">
        {value || <span className="text-text-tertiary italic">empty</span>}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareNumberField({ value }: { value: Json }) {
  if (typeof value === "number") {
    return (
      <div className="font-mono text-sm p-2 bg-bg-tertiary rounded border border-border-secondary">
        {value}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareBooleanField({ value }: { value: Json }) {
  if (typeof value === "boolean") {
    return (
      <div className="font-mono text-sm p-2 bg-bg-tertiary rounded border border-border-secondary">
        {value ? "true" : "false"}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareObjectField({
  value,
  schema,
}: {
  value: Json;
  schema?: SerializedSchema;
}) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return (
        <div className="text-fg-tertiary italic text-sm">empty object</div>
      );
    }
    const objectSchema = schema?.type === "object" ? schema : undefined;
    return (
      <div className="space-y-3 p-3 bg-bg-tertiary rounded-lg border border-border-secondary">
        {entries.map(([key, val]) => (
          <div key={key} className="space-y-1">
            <div className="font-semibold text-fg-secondary text-xs uppercase tracking-wide">
              {key}
            </div>
            <CompareValue value={val} schema={objectSchema?.items?.[key]} />
          </div>
        ))}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareArrayField({
  value,
  schema,
}: {
  value: Json;
  schema?: SerializedSchema;
}) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <div className="text-fg-tertiary italic text-sm">empty array</div>;
    }
    const arraySchema = schema?.type === "array" ? schema : undefined;
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div
            key={index}
            className="p-3 bg-bg-tertiary rounded-lg border border-border-secondary"
          >
            <div className="text-xs text-fg-secondary font-semibold mb-2">
              [{index}]
            </div>
            <CompareValue value={item} schema={arraySchema?.item} />
          </div>
        ))}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareRecordField({
  value,
  schema,
}: {
  value: Json;
  schema?: SerializedSchema;
}) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return (
        <div className="text-fg-tertiary italic text-sm">empty record</div>
      );
    }
    const recordSchema = schema?.type === "record" ? schema : undefined;
    return (
      <div className="space-y-2">
        {entries.map(([key, val]) => (
          <div
            key={key}
            className="p-3 bg-bg-tertiary rounded-lg border border-border-secondary"
          >
            <div className="text-xs font-semibold text-fg-secondary mb-2">
              {key}
            </div>
            <CompareValue value={val} schema={recordSchema?.item} />
          </div>
        ))}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareUnionField({
  value,
  schema,
}: {
  value: Json;
  schema?: SerializedSchema;
}) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const unionSchema = schema?.type === "union" ? schema : undefined;

    // Try to find the matching variant based on discriminator
    let variantSchema: SerializedSchema | undefined;
    if (
      unionSchema &&
      "items" in unionSchema &&
      Array.isArray(unionSchema.items) &&
      unionSchema.items.every(
        (item) => typeof item === "object" && item.type === "object",
      )
    ) {
      // This is a SerializedObjectUnionSchema
      const objectUnionSchema = unionSchema as {
        type: "union";
        key: string;
        items: SerializedSchema[];
      };
      const discriminatorKey = objectUnionSchema.key;
      const valueAsRecord = value as Record<string, Json>;
      if (
        typeof discriminatorKey === "string" &&
        typeof valueAsRecord[discriminatorKey] === "string"
      ) {
        const discriminatorValue = valueAsRecord[discriminatorKey];
        variantSchema = objectUnionSchema.items.find(
          (v) =>
            v.type === "object" &&
            v.items[discriminatorKey]?.type === "literal" &&
            v.items[discriminatorKey].value === discriminatorValue,
        );
      }
    }

    const entries = Object.entries(value);
    return (
      <div className="p-3 bg-bg-tertiary rounded-lg border border-border-secondary">
        <div className="space-y-3">
          {entries.map(([key, val]) => (
            <div key={key} className="space-y-1">
              <div className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">
                {key}
              </div>
              <CompareValue
                value={val}
                schema={
                  variantSchema?.type === "object"
                    ? variantSchema.items?.[key]
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (typeof value === "string") {
    return (
      <div className="font-mono text-sm p-2 bg-bg-tertiary rounded border border-border-secondary">
        {value}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareLiteralField({ value }: { value: Json }) {
  return (
    <div className="font-mono text-sm p-2 bg-bg-tertiary rounded border border-border-secondary">
      {JSON.stringify(value)}
    </div>
  );
}

function CompareDefaultField({ value }: { value: Json }) {
  return (
    <div className="font-mono text-xs p-2 bg-bg-tertiary rounded border border-border-secondary overflow-auto max-h-40">
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export function CompareRichTextField({
  value,
  schema,
}: {
  value: Json;
  schema?: SerializedSchema;
}) {
  if (!Array.isArray(value)) {
    return <CompareDefaultField value={value} />;
  }

  const richTextValue = value as RichTextSource<AllRichTextOptions>;
  const remirrorContent = richTextToRemirror(richTextValue);
  const { manager } = useRichTextEditor(remirrorContent);

  const options =
    schema && schema.type === "richtext" ? schema.options : undefined;

  return (
    <div className="text-sm rounded border border-border-secondary overflow-hidden">
      <ReadOnlyRichTextEditor
        manager={manager}
        initialContent={manager.createState({ content: remirrorContent })}
        options={options}
      />
    </div>
  );
}

export function CompareImageField({ value }: { value: Json }) {
  if (typeof value !== "object" || value === null) {
    return <CompareDefaultField value={value} />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imageValue = value as any;

  // Check if it's a file reference
  if (FILE_REF_PROP in imageValue) {
    const ref = imageValue[FILE_REF_PROP];
    const metadata = imageValue.metadata;
    const isRemote = imageValue[VAL_EXTENSION] === "remote";

    let url: string | null = null;
    if (isRemote) {
      url = Internal.convertRemoteSource({
        ...imageValue,
        [VAL_EXTENSION]: "remote",
      }).url;
    } else {
      url = Internal.convertFileSource({
        ...imageValue,
        [VAL_EXTENSION]: "file",
      }).url;
    }

    return (
      <div className="space-y-2">
        <div className="relative border border-border-secondary rounded overflow-hidden bg-bg-tertiary">
          {url ? (
            <img src={url} alt="" className="max-w-full h-auto" />
          ) : (
            <div className="p-4 text-text-tertiary italic text-sm">
              Image: {ref}
            </div>
          )}
        </div>
        {metadata && (
          <div className="text-xs text-text-secondary space-y-1">
            {metadata.width && metadata.height && (
              <div>
                {metadata.width} × {metadata.height}
              </div>
            )}
            {metadata.mimeType && <div>{metadata.mimeType}</div>}
          </div>
        )}
      </div>
    );
  }

  return <CompareDefaultField value={value} />;
}

export function CompareFileField({ value }: { value: Json }) {
  if (typeof value !== "object" || value === null) {
    return <CompareDefaultField value={value} />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileValue = value as any;

  // Check if it's a file reference
  if (FILE_REF_PROP in fileValue) {
    const ref = fileValue[FILE_REF_PROP];
    const metadata = fileValue.metadata;
    const isRemote = fileValue[VAL_EXTENSION] === "remote";

    let url: string | null = null;
    if (isRemote) {
      url = Internal.convertRemoteSource({
        ...fileValue,
        [VAL_EXTENSION]: "remote",
      }).url;
    } else {
      url = Internal.convertFileSource({
        ...fileValue,
        [VAL_EXTENSION]: "file",
      }).url;
    }

    const fileName = ref.split("/").pop() || ref;

    return (
      <div className="space-y-2">
        <div className="p-3 bg-bg-tertiary rounded border border-border-secondary">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-text-secondary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm truncate">{fileName}</div>
              {metadata?.mimeType && (
                <div className="text-xs text-text-secondary">
                  {metadata.mimeType}
                </div>
              )}
            </div>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-600"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <CompareDefaultField value={value} />;
}
