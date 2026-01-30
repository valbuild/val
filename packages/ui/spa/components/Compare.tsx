import {
  Json,
  SerializedSchema,
  VAL_EXTENSION,
  FILE_REF_PROP,
  Internal,
} from "@valbuild/core";
import { PatchSetComparison } from "../utils/comparePatchSets";
import { cn } from "./designSystem/cn";

export function Compare({
  comparisons,
  className,
}: {
  comparisons: PatchSetComparison[];
  className?: string;
}) {
  return (
    <div className={cn("space-y-6", className)}>
      {comparisons.map((comparison, index) => (
        <ComparisonItem key={index} comparison={comparison} />
      ))}
    </div>
  );
}

function ComparisonItem({ comparison }: { comparison: PatchSetComparison }) {
  const { before, after, beforeSchema, afterSchema } = comparison;

  return (
    <div className="border border-border-primary rounded-lg overflow-hidden">
      {/* Header with patch metadata */}
      <div className="bg-bg-secondary px-4 py-2 border-b border-border-primary">
        <div className="flex items-center justify-between text-sm">
          <div className="font-medium text-text-primary">
            Path: /{comparison.patchSet.patchPath.join("/")}
          </div>
          <div className="text-text-secondary text-xs">
            {comparison.patchSet.patches.length} patch
            {comparison.patchSet.patches.length !== 1 ? "es" : ""}
          </div>
        </div>
        {comparison.patchSet.lastUpdated && (
          <div className="text-xs text-text-secondary mt-1">
            {new Date(comparison.patchSet.lastUpdated).toLocaleString()}
            {comparison.patchSet.lastUpdatedBy &&
              ` by ${comparison.patchSet.lastUpdatedBy}`}
          </div>
        )}
      </div>

      {/* Comparison grid */}
      <div className="grid grid-cols-2 divide-x divide-border-primary">
        <div className="p-4">
          <div className="text-xs font-medium text-text-secondary mb-2">
            Before
          </div>
          <CompareValue value={before} schema={beforeSchema} />
        </div>
        <div className="p-4">
          <div className="text-xs font-medium text-text-secondary mb-2">
            After
          </div>
          <CompareValue value={after} schema={afterSchema} />
        </div>
      </div>
    </div>
  );
}

function CompareValue({
  value,
  schema,
}: {
  value: Json;
  schema: SerializedSchema | undefined;
}) {
  if (!schema) {
    return <CompareNullField value={value} />;
  }

  switch (schema.type) {
    case "keyOf":
    case "route":
    case "string":
    case "date":
      return <CompareStringField value={value} />;
    case "number":
      return <CompareNumberField value={value} />;
    case "boolean":
      return <CompareBooleanField value={value} />;
    case "object":
      return <CompareObjectField value={value} />;
    case "array":
      return <CompareArrayField value={value} />;
    case "record":
      return <CompareRecordField value={value} />;
    case "union":
      return <CompareUnionField value={value} />;
    case "literal":
      return <CompareLiteralField value={value} />;
    case "richtext":
      return <CompareRichTextField value={value} />;
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
    return <span className="text-text-tertiary italic">undefined</span>;
  }
  return <CompareDefaultField value={value} />;
}

export function CompareStringField({ value }: { value: Json }) {
  if (typeof value === "string") {
    return (
      <div className="font-mono text-sm p-2 bg-bg-tertiary rounded border border-border-secondary">
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

export function CompareObjectField({ value }: { value: Json }) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return (
        <div className="text-text-tertiary italic text-sm">empty object</div>
      );
    }
    return (
      <div className="space-y-2">
        {entries.map(([key, val]) => (
          <div key={key} className="text-sm">
            <span className="font-medium text-text-secondary">{key}: </span>
            <span className="font-mono">{JSON.stringify(val)}</span>
          </div>
        ))}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareArrayField({ value }: { value: Json }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="text-text-tertiary italic text-sm">empty array</div>
      );
    }
    return (
      <div className="space-y-1">
        {value.map((item, index) => (
          <div
            key={index}
            className="text-sm p-2 bg-bg-tertiary rounded border border-border-secondary"
          >
            <span className="text-text-secondary font-mono">[{index}] </span>
            <span className="font-mono">{JSON.stringify(item)}</span>
          </div>
        ))}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareRecordField({ value }: { value: Json }) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return (
        <div className="text-text-tertiary italic text-sm">empty record</div>
      );
    }
    return (
      <div className="space-y-2">
        {entries.map(([key, val]) => (
          <div
            key={key}
            className="text-sm p-2 bg-bg-tertiary rounded border border-border-secondary"
          >
            <span className="font-medium text-text-secondary">{key}: </span>
            <span className="font-mono">{JSON.stringify(val)}</span>
          </div>
        ))}
      </div>
    );
  }
  return <CompareDefaultField value={value} />;
}

export function CompareUnionField({ value }: { value: Json }) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    // Try to identify the variant
    const entries = Object.entries(value);
    return (
      <div className="p-2 bg-bg-tertiary rounded border border-border-secondary">
        <div className="space-y-2">
          {entries.map(([key, val]) => (
            <div key={key} className="text-sm">
              <span className="font-medium text-text-secondary">{key}: </span>
              <span className="font-mono">{JSON.stringify(val)}</span>
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

export function CompareRichTextField({ value }: { value: Json }) {
  if (!Array.isArray(value)) {
    return <CompareDefaultField value={value} />;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderNode = (node: any, index: number): React.ReactNode => {
    if (typeof node === "string") {
      return node;
    }

    if (typeof node !== "object" || !node.tag) {
      return null;
    }

    const { tag, children, styles, href, src } = node;

    // Render children recursively
    const renderedChildren = children
      ? Array.isArray(children)
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          children.map((child: any, i: number) => renderNode(child, i))
        : renderNode(children, 0)
      : null;

    // Apply styles
    let className = "";
    if (styles && Array.isArray(styles)) {
      if (styles.includes("bold")) className += " font-bold";
      if (styles.includes("italic")) className += " italic";
      if (styles.includes("line-through")) className += " line-through";
    }

    // Render based on tag
    switch (tag) {
      case "h1":
        return (
          <h1 key={index} className="text-2xl font-bold mb-2">
            {renderedChildren}
          </h1>
        );
      case "h2":
        return (
          <h2 key={index} className="text-xl font-bold mb-2">
            {renderedChildren}
          </h2>
        );
      case "h3":
        return (
          <h3 key={index} className="text-lg font-bold mb-2">
            {renderedChildren}
          </h3>
        );
      case "h4":
      case "h5":
      case "h6":
        return (
          <div key={index} className="font-bold mb-1">
            {renderedChildren}
          </div>
        );
      case "p":
        return (
          <p key={index} className="mb-2">
            {renderedChildren}
          </p>
        );
      case "ul":
        return (
          <ul key={index} className="list-disc list-inside mb-2">
            {renderedChildren}
          </ul>
        );
      case "ol":
        return (
          <ol key={index} className="list-decimal list-inside mb-2">
            {renderedChildren}
          </ol>
        );
      case "li":
        return <li key={index}>{renderedChildren}</li>;
      case "a":
        return (
          <a key={index} href={href} className="text-blue-500 underline">
            {renderedChildren}
          </a>
        );
      case "img":
        return (
          <img
            key={index}
            src={
              src && typeof src === "object" && FILE_REF_PROP in src
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (src as any)[FILE_REF_PROP]
                : ""
            }
            alt=""
            className="max-w-full h-auto"
          />
        );
      case "span":
        return (
          <span key={index} className={className}>
            {renderedChildren}
          </span>
        );
      case "br":
        return <br key={index} />;
      default:
        return <span key={index}>{renderedChildren}</span>;
    }
  };

  return (
    <div className="text-sm p-2 bg-bg-tertiary rounded border border-border-secondary prose prose-sm max-w-none">
      {value.map((node, index) => renderNode(node, index))}
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

