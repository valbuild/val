import {
  type SerializedComponentRender,
  type SerializedDiscriminatedUnionSchema,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
} from "./ValFieldProvider";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";
import { cn } from "./designSystem/cn";

/**
 * Route in the host app that renders the value at one source path with its
 * component.
 *
 * TODO: make configurable (val.config) - hard-coded while we figure out what
 * the right setup story is.
 */
const VAL_PREVIEW_ROUTE = "/val-preview";
const VAL_PREVIEW_REFRESH_MESSAGE = "val-preview-refresh";

/**
 * Window event that forces a full reload of every component preview.
 *
 * Component code is rewritten outside of Val, so Val cannot know when that
 * happened: whatever performs the rewrite dispatches this when it is done.
 *
 * @example
 * window.dispatchEvent(new CustomEvent("val-component-preview-reload"));
 */
export const VAL_COMPONENT_PREVIEW_RELOAD_EVENT =
  "val-component-preview-reload";

/**
 * How long to wait after the last edit before telling the preview to refresh.
 *
 * The preview is rendered by the host app's server, so it only sees a change
 * once the patch has been synced. Debouncing also keeps us from refreshing on
 * every keystroke.
 */
const REFRESH_DEBOUNCE_MS = 800;

type PreviewSource =
  /** The content being edited, at this path. */
  | { type: "content" }
  /** The `example` of the render: a fixture that is not on the site. */
  | { type: "example" }
  /** Values typed in by hand, written nowhere. */
  | { type: "values" };

/**
 * EXPERIMENTAL: a live preview of the value at `path`, rendered with the
 * component its schema declares - `s.object(...).render({ as: "component" })`,
 * or the variant of a discriminated union the value takes.
 *
 * Renders nothing when there is no such component.
 *
 * The component itself is rendered by the host app (in an iframe), not here:
 * the serialized schema only says THAT there is one, and that way it gets the
 * app's own React, CSS, fonts and providers, and server components work. Val
 * UI only decides which content to render it with.
 */
export function ComponentPreview({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status !== "success") {
    return null;
  }
  const schema = schemaAtPath.data;
  if (schema.type === "discriminated-union") {
    return <UnionComponentPreview path={path} schema={schema} />;
  }
  const render = componentRenderOf(schema);
  if (!render) {
    return null;
  }
  return <ComponentPreviewFrame path={path} render={render} />;
}

/**
 * A union has no render of its own: the variant the value takes does, and
 * which one that is can change while the editor is looking at it.
 */
function UnionComponentPreview({
  path,
  schema,
}: {
  path: SourcePath;
  schema: SerializedDiscriminatedUnionSchema;
}) {
  const tagRes = useShallowSourceAtPath(
    sourcePathOfItem(path, schema.key),
    "literal",
  );
  const tag = "data" in tagRes ? tagRes.data : undefined;
  const variant = schema.items.find((item) => {
    const tagSchema = item.items[schema.key];
    return tagSchema?.type === "literal" && tagSchema.value === tag;
  });
  const render = variant ? componentRenderOf(variant) : null;
  if (!render) {
    return null;
  }
  // Keyed by the tag: another variant is another component, and its picker
  // state (an example it may not have) must not carry over.
  return (
    <ComponentPreviewFrame key={String(tag)} path={path} render={render} />
  );
}

function componentRenderOf(
  schema: SerializedSchema,
): SerializedComponentRender | null {
  if (schema.type !== "object") {
    return null;
  }
  return schema.render?.as === "component" ? schema.render : null;
}

function ComponentPreviewFrame({
  path,
  render,
}: {
  path: SourcePath;
  render: SerializedComponentRender;
}) {
  const sourceAtPath = useSourceAtPath(path);
  const source =
    sourceAtPath.status === "success" ? sourceAtPath.data : undefined;

  const [previewSource, setPreviewSource] = useState<PreviewSource>({
    type: "content",
  });
  // Reset when navigating to another value
  useEffect(() => {
    setPreviewSource({ type: "content" });
  }, [path]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isFirstSourceRef = useRef(true);
  // Bumped to throw the iframe away and mount a new one. Needed when the
  // component code changed (as opposed to its content), since that means the
  // host app has to re-evaluate the module, not just re-render it.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setReloadKey((prev) => prev + 1);
  }, []);

  // Content changed in Val: ask the preview to re-render with the new content.
  useEffect(() => {
    if (isFirstSourceRef.current) {
      // The iframe is loading the current content anyway
      isFirstSourceRef.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: VAL_PREVIEW_REFRESH_MESSAGE },
        window.location.origin,
      );
    }, REFRESH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [source]);

  // Component code changed outside of Val: reload from scratch.
  useEffect(() => {
    window.addEventListener(VAL_COMPONENT_PREVIEW_RELOAD_EVENT, reload);
    return () => {
      window.removeEventListener(VAL_COMPONENT_PREVIEW_RELOAD_EVENT, reload);
    };
  }, [reload]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 justify-between items-center">
        <PreviewSourcePicker
          hasExample={render.example === true}
          selected={previewSource}
          onSelect={setPreviewSource}
        />
        <button
          type="button"
          className="flex gap-1 items-center text-xs shrink-0 text-fg-tertiary hover:text-fg-primary"
          onClick={reload}
          title="Reload the preview (after the component code changed)"
        >
          <RotateCw size={12} />
          Reload
        </button>
      </div>
      {previewSource.type === "values" ? (
        <ValuesPreview path={path} initialValue={source} />
      ) : (
        <iframe
          key={reloadKey}
          ref={iframeRef}
          title={`Preview of ${path}`}
          src={previewUrl({
            path,
            example: previewSource.type === "example",
          })}
          className="w-full h-[420px] rounded-lg border border-border-primary bg-bg-primary"
        />
      )}
    </div>
  );
}

function PreviewSourcePicker({
  hasExample,
  selected,
  onSelect,
}: {
  hasExample: boolean;
  selected: PreviewSource;
  onSelect: (source: PreviewSource) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 items-center text-xs">
      <PickerButton
        selected={selected.type === "content"}
        onClick={() => onSelect({ type: "content" })}
        title="The content you are editing"
      >
        Content
      </PickerButton>
      {hasExample && (
        <PickerButton
          selected={selected.type === "example"}
          onClick={() => onSelect({ type: "example" })}
          title="The example the schema declares - a fixture, not content that exists on the site"
        >
          Example
        </PickerButton>
      )}
      <PickerButton
        selected={selected.type === "values"}
        onClick={() => onSelect({ type: "values" })}
        title="Render this component with values you type in, without changing any content"
      >
        Values&hellip;
      </PickerButton>
    </div>
  );
}

function PickerButton({
  selected,
  onClick,
  title,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn("px-2 py-1 rounded border border-border-primary", {
        "bg-bg-secondary text-fg-primary": selected,
        "text-fg-tertiary hover:text-fg-primary": !selected,
      })}
    >
      {children}
    </button>
  );
}

/**
 * Render the component with values typed in by hand.
 *
 * The values are sent as JSON in the preview URL, so they are never written
 * anywhere: the preview is still rendered by the host app's server, which keeps
 * server components working.
 */
function ValuesPreview({
  path,
  initialValue,
}: {
  path: SourcePath;
  initialValue: unknown;
}) {
  const [text, setText] = useState(() =>
    JSON.stringify(initialValue ?? {}, null, 2),
  );
  const [committed, setCommitted] = useState(text);
  useEffect(() => {
    const timeout = setTimeout(() => setCommitted(text), 500);
    return () => clearTimeout(timeout);
  }, [text]);
  const parseError = useMemo(() => {
    try {
      JSON.parse(committed);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Invalid JSON";
    }
  }, [committed]);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        className="w-full h-40 p-2 font-mono text-xs rounded-lg border border-border-primary bg-bg-primary text-fg-primary"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {parseError ? (
        <div className="text-xs text-fg-error-primary">{parseError}</div>
      ) : (
        <iframe
          title={`Preview of ${path} with typed values`}
          src={previewUrl({ path, props: committed })}
          className="w-full h-[420px] rounded-lg border border-border-primary bg-bg-primary"
        />
      )}
    </div>
  );
}

function previewUrl({
  path,
  example,
  props,
}: {
  path: SourcePath;
  example?: boolean;
  props?: string;
}): string {
  const params = new URLSearchParams({ p: path });
  if (example) {
    params.set("example", "1");
  }
  if (props !== undefined) {
    params.set("props", props);
  }
  return `${VAL_PREVIEW_ROUTE}?${params.toString()}`;
}
