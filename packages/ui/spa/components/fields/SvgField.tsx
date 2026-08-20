import {
  isSvgVarRef,
  svgVariableValue,
  GenericSvgNode,
  GenericSvgSource,
  SerializedSvgSchema,
  SourcePath,
  SvgVariable,
  SVG_COLOR_ATTRS,
} from "@valbuild/core";
import {
  parseSvg,
  svgSourceToJson,
  svgToString,
  type SvgColorOverride,
  type SvgUnmatchedColor,
} from "@valbuild/shared/internal";
import React, { useMemo, useRef, useState } from "react";
import { Button } from "../designSystem/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../designSystem/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../designSystem/select";
import { cn } from "../designSystem/cn";
import { FieldLoading } from "../FieldLoading";
import { FieldNotFound } from "../FieldNotFound";
import { FieldSchemaError } from "../FieldSchemaError";
import { FieldSchemaMismatchError } from "../FieldSchemaMismatchError";
import { FieldSourceError } from "../FieldSourceError";
import { PreviewLoading, PreviewNull } from "../Preview";
import { ValidationErrors } from "../ValidationError";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValFieldProvider";

const KEYWORD_OPTIONS = ["currentColor", "none", "transparent"] as const;

type Variables = Record<string, SvgVariable>;

function isSvgSource(source: unknown): source is GenericSvgSource {
  return (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    typeof (source as { viewBox?: unknown }).viewBox === "string"
  );
}

function colorAttrValue(
  value: unknown,
  resolved: Record<string, string>,
): string | null {
  if (isSvgVarRef(value)) {
    // The editor resolves variables eagerly so the preview shows real colors
    // rather than unresolved custom properties.
    return resolved[value.var] ?? `var(--val-svg-${value.var}, currentColor)`;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function buildNode(
  node: GenericSvgNode,
  key: number,
  resolved: Record<string, string>,
): React.ReactElement | null {
  if (!node || typeof node !== "object" || typeof node.tag !== "string") {
    return null;
  }
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if ((SVG_COLOR_ATTRS as readonly string[]).includes(name)) {
      const color = colorAttrValue(value, resolved);
      if (color !== null) {
        props[name] = color;
      }
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      props[name] = value;
    }
  }
  const children = (node.children ?? [])
    .map((child, i) => buildNode(child, i, resolved))
    .filter((child): child is React.ReactElement => child !== null);
  return React.createElement(
    node.tag,
    props,
    children.length > 0 ? children : undefined,
  );
}

/**
 * Renders an svg source.
 *
 * A separate implementation from `ValSvg` in `@valbuild/react`, which the
 * editor cannot depend on - and which resolves variables through css rather
 * than eagerly, as the preview needs to.
 */
export function SvgRender({
  source,
  variables,
  overrides,
  size,
  className,
}: {
  source: GenericSvgSource;
  variables?: Variables;
  /** Per-variable color overrides, e.g. a dark mode preview. */
  overrides?: Record<string, string>;
  size?: number;
  className?: string;
}) {
  const resolved = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [name, variable] of Object.entries(variables ?? {})) {
      map[name] = svgVariableValue(variable);
    }
    return { ...map, ...overrides };
  }, [variables, overrides]);
  if (!isSvgSource(source)) {
    return null;
  }
  const children = (source.children ?? [])
    .map((child, i) => buildNode(child, i, resolved))
    .filter((child): child is React.ReactElement => child !== null);
  return React.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: source.viewBox,
      width: size ?? source.width ?? undefined,
      height: size ?? source.height ?? undefined,
      role: "presentation",
      "aria-hidden": true,
      className,
    },
    children,
  );
}

/**
 * One row per color the import could not place, with the colors it is allowed
 * to become.
 *
 * We never snap a color to the nearest variable on our own: a brand color that
 * is quietly rewritten is worse than one the editor is asked about. A variable
 * can opt in to fuzzy matching with `tolerance`, and then it never reaches
 * here.
 */
export function SvgColorMapper({
  unmatched,
  variables,
  value,
  onChange,
  allowLiterals,
}: {
  unmatched: SvgUnmatchedColor[];
  variables: Variables;
  value: Record<string, SvgColorOverride>;
  onChange: (next: Record<string, SvgColorOverride>) => void;
  allowLiterals: boolean;
}) {
  if (unmatched.length === 0) {
    return null;
  }
  const variableNames = Object.keys(variables);
  const remaining = unmatched.filter(
    (color) => value[color.normalized ?? color.raw] === undefined,
  ).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-text-secondary">
        {remaining === 0
          ? "All colors mapped."
          : remaining === 1
            ? "1 color is not in the palette. Pick what it should become:"
            : `${remaining} colors are not in the palette. Pick what they should become:`}
      </div>
      {unmatched.map((color) => {
        const key = color.normalized ?? color.raw;
        const current = value[key];
        const selected =
          current === undefined
            ? ""
            : current.type === "var"
              ? `var:${current.var}`
              : current.type === "keyword"
                ? `keyword:${current.keyword}`
                : "literal";
        return (
          <div key={key} className="flex items-center gap-2">
            <span
              className="w-6 h-6 rounded border border-border-primary shrink-0"
              style={{ background: color.raw }}
              title={color.raw}
            />
            <code className="text-xs w-24 shrink-0">{color.raw}</code>
            <span className="text-xs text-text-secondary w-16 shrink-0">
              {color.count === 1 ? "1 use" : `${color.count} uses`}
            </span>
            <Select
              value={selected}
              onValueChange={(next) => {
                let override: SvgColorOverride;
                if (next.startsWith("var:")) {
                  override = { type: "var", var: next.slice("var:".length) };
                } else if (next.startsWith("keyword:")) {
                  override = {
                    type: "keyword",
                    keyword: next.slice(
                      "keyword:".length,
                    ) as (typeof KEYWORD_OPTIONS)[number],
                  };
                } else {
                  override = { type: "literal" };
                }
                onChange({ ...value, [key]: override });
              }}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Choose a color" />
              </SelectTrigger>
              <SelectContent>
                {variableNames.map((name) => (
                  <SelectItem key={name} value={`var:${name}`}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-sm border border-border-primary"
                        style={{
                          background: svgVariableValue(variables[name]),
                        }}
                      />
                      {name}
                    </span>
                  </SelectItem>
                ))}
                {KEYWORD_OPTIONS.map((keyword) => (
                  <SelectItem key={keyword} value={`keyword:${keyword}`}>
                    {keyword}
                  </SelectItem>
                ))}
                {allowLiterals && (
                  <SelectItem value="literal">Keep {color.raw}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The tile an icon lives in, and the only thing on screen most of the time.
 *
 * Icons are read far more often than they are replaced, so the tile *is* the
 * control: drop an svg on it, paste markup into it, or click it to pick a file.
 * Nothing else is rendered until one of those happens.
 */
export function SvgDropTile({
  source,
  pending,
  variables,
  overrides,
  readonly,
  onMarkup,
  onFile,
}: {
  source: GenericSvgSource | null;
  /** The icon shown is an import in progress, not what is stored. */
  pending?: boolean;
  variables: Variables;
  overrides?: Record<string, string>;
  readonly?: boolean;
  onMarkup: (markup: string) => void;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const interactive = !readonly;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={
        interactive
          ? "Icon. Drop an svg file, paste svg markup, or press enter to choose a file."
          : undefined
      }
      className={cn(
        "relative flex items-center justify-center w-24 h-24 rounded-md border shrink-0 transition-colors",
        overrides ? "bg-black text-white" : "bg-bg-primary",
        dragging
          ? "border-border-brand-primary border-dashed bg-bg-secondary"
          : pending
            ? "border-border-brand-primary border-dashed"
            : "border-border-primary",
        interactive &&
          "cursor-pointer hover:border-border-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      onClick={() => interactive && fileInput.current?.click()}
      onKeyDown={(ev) => {
        if (interactive && (ev.key === "Enter" || ev.key === " ")) {
          ev.preventDefault();
          fileInput.current?.click();
        }
      }}
      onPaste={(ev) => {
        if (!interactive) return;
        const text = ev.clipboardData.getData("text");
        const file = Array.from(ev.clipboardData.files)[0];
        if (file) {
          ev.preventDefault();
          onFile(file);
        } else if (text.trim()) {
          ev.preventDefault();
          onMarkup(text);
        }
      }}
      onDragOver={(ev) => {
        if (!interactive) return;
        ev.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(ev) => {
        if (!interactive) return;
        ev.preventDefault();
        setDragging(false);
        const file = Array.from(ev.dataTransfer.files)[0];
        if (file) {
          onFile(file);
          return;
        }
        const text = ev.dataTransfer.getData("text");
        if (text.trim()) {
          onMarkup(text);
        }
      }}
    >
      {source ? (
        <SvgRender
          source={source}
          variables={variables}
          overrides={overrides}
          size={48}
        />
      ) : (
        <span className="px-2 text-xs text-center text-text-secondary">
          Drop or paste an svg
        </span>
      )}
      {dragging && (
        <span className="absolute inset-0 flex items-center justify-center px-2 text-xs text-center rounded-md bg-bg-primary/80 text-text-primary">
          Drop to replace
        </span>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/svg+xml,.svg"
        className="hidden"
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          if (file) {
            onFile(file);
          }
          ev.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * The presentational half of the svg field: an icon you can drop onto, and the
 * mapping controls that appear only when an import needs a decision.
 *
 * Kept free of Val providers so it can be driven from storybook and tests.
 */
export function SvgEditor({
  schema,
  source,
  onChange,
  readonly,
}: {
  schema: SerializedSvgSchema;
  source: GenericSvgSource | null;
  onChange: (source: GenericSvgSource) => void;
  readonly?: boolean;
}) {
  const variables = (schema.options?.variables ?? {}) as Variables;
  const literals = schema.options?.literals ?? "forbid";
  const [markup, setMarkup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [unmatched, setUnmatched] = useState<SvgUnmatchedColor[]>([]);
  const [overrides, setOverrides] = useState<Record<string, SvgColorOverride>>(
    {},
  );
  const [dark, setDark] = useState(false);

  /**
   * The icon being imported, shown in the tile while its colors are mapped.
   *
   * Unmapped colors are previewed as they came in - an explicit `literal`
   * override keeps a color whatever the schema's `literals` says - so you can
   * see the icon you dropped, and watch it move onto the palette as you pick.
   */
  const pending = useMemo(() => {
    if (markup === null || unmatched.length === 0) {
      return null;
    }
    const asLiterals: Record<string, SvgColorOverride> = {};
    for (const color of unmatched) {
      asLiterals[color.normalized ?? color.raw] = { type: "literal" };
    }
    const result = parseSvg(markup, schema.options ?? {}, {
      overrides: { ...asLiterals, ...overrides },
    });
    return result.status === "success"
      ? (result.source as unknown as GenericSvgSource)
      : null;
  }, [markup, unmatched, overrides, schema.options]);

  const darkOverrides = useMemo(() => {
    if (!dark) {
      return undefined;
    }
    // Stands in for the app's dark mode stylesheet, so it is obvious which
    // parts of the icon are actually themeable.
    const map: Record<string, string> = {};
    for (const name of Object.keys(variables)) {
      map[name] = "#f5f5f5";
    }
    return map;
  }, [dark, variables]);

  const runImport = (
    input: string,
    colorOverrides: Record<string, SvgColorOverride>,
  ) => {
    const result = parseSvg(input, schema.options ?? {}, {
      overrides: colorOverrides,
    });
    if (result.status === "error") {
      setError(result.message);
      setUnmatched([]);
      setNotes([]);
      return;
    }
    setError(null);
    setUnmatched(result.unmatched);
    const nextNotes: string[] = [];
    if (result.droppedTags.length > 0) {
      nextNotes.push(`Removed unsupported: ${result.droppedTags.join(", ")}`);
    }
    if (result.droppedAttrs.length > 0) {
      const attrs = Array.from(new Set(result.droppedAttrs.map((a) => a.attr)));
      nextNotes.push(`Removed attributes: ${attrs.join(", ")}`);
    }
    setNotes(nextNotes);
    // Only commit once every color has somewhere to go: a half mapped icon
    // would silently lose fills.
    if (result.unmatched.length === 0) {
      setMarkup(null);
      onChange(result.source as unknown as GenericSvgSource);
    }
  };

  const onNewMarkup = (input: string) => {
    if (!input.trim()) {
      setError("That does not look like svg markup");
      return;
    }
    setMarkup(input);
    setOverrides({});
    runImport(input, {});
  };

  const onNewFile = (file: File) => {
    // Read as text: an svg field stores the tree in the module, so there is no
    // binary to upload and no file op to create.
    const reader = new FileReader();
    reader.onerror = () => setError(`Could not read ${file.name}`);
    reader.onload = () => onNewMarkup(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const onOverridesChange = (next: Record<string, SvgColorOverride>) => {
    setOverrides(next);
    const allChosen = unmatched.every(
      (color) => next[color.normalized ?? color.raw] !== undefined,
    );
    if (allChosen && markup !== null) {
      runImport(markup, next);
    }
  };

  const hasFeedback =
    error !== null || notes.length > 0 || unmatched.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-4">
        <SvgDropTile
          source={pending ?? source}
          pending={pending !== null}
          variables={variables}
          overrides={darkOverrides}
          readonly={readonly}
          onMarkup={onNewMarkup}
          onFile={onNewFile}
        />
        {source && (
          <div className="flex flex-col gap-2 pt-1 text-xs text-text-secondary">
            <span>
              <code>{source.viewBox}</code>
            </span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(variables).map(([name, variable]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1"
                  title={svgVariableValue(variable)}
                >
                  <span
                    className="w-3 h-3 rounded-sm border border-border-primary"
                    style={{
                      background:
                        darkOverrides?.[name] ?? svgVariableValue(variable),
                    }}
                  />
                  {name}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="self-start underline underline-offset-2"
              onClick={() => setDark((d) => !d)}
            >
              {dark ? "Preview light" : "Preview dark"}
            </button>
          </div>
        )}
      </div>
      {error && <div className="text-sm text-text-error">{error}</div>}
      {notes.map((note) => (
        <div key={note} className="text-xs text-text-secondary">
          {note}
        </div>
      ))}
      <SvgColorMapper
        unmatched={unmatched}
        variables={variables}
        value={overrides}
        onChange={onOverridesChange}
        allowLiterals={literals === "allow" || Array.isArray(literals)}
      />
      {unmatched.length > 0 && (
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setMarkup(null);
              setUnmatched([]);
              setOverrides({});
              setNotes([]);
              setError(null);
            }}
          >
            Cancel import
          </Button>
        </div>
      )}
      {source && !hasFeedback && (
        <Accordion type="single" collapsible>
          <AccordionItem value="markup" className="border-b-0">
            <AccordionTrigger className="py-1 text-xs text-text-secondary">
              Markup
            </AccordionTrigger>
            <AccordionContent>
              <pre className="p-2 overflow-x-auto text-xs rounded bg-bg-secondary">
                {svgToString(source, { variables, pretty: true })}
              </pre>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

export function SvgField({
  path,
  readonly,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const type = "svg";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
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
  return (
    <div id={path} className={cn(readonly && "opacity-70")}>
      <ValidationErrors path={path} />
      <SvgEditor
        schema={schemaAtPath.data}
        source={isSvgSource(source) ? source : null}
        readonly={readonly}
        onChange={(next) => {
          if (readonly) return;
          // The tree is replaced whole on import: a partial patch of a freshly
          // pasted icon would be meaningless.
          addPatch(
            [{ op: "replace", path: patchPath, value: svgSourceToJson(next) }],
            type,
          );
        }}
      />
    </div>
  );
}

export function SvgPreview({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, "svg");
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  const source = sourceAtPath.data;
  if (!isSvgSource(source)) {
    return <PreviewNull path={path} />;
  }
  const variables =
    "data" in schemaAtPath && schemaAtPath.data?.type === "svg"
      ? ((schemaAtPath.data.options?.variables ?? {}) as Variables)
      : {};
  return (
    <SvgRender
      source={source}
      variables={variables}
      size={20}
      className="inline-block"
    />
  );
}
