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
  overrides: Record<string, string>,
): string | null {
  if (isSvgVarRef(value)) {
    // In the editor we resolve variables eagerly, so the preview can show the
    // example colors - and a dark mode override - without a stylesheet.
    return overrides[value.var] ?? `var(--val-svg-${value.var}, currentColor)`;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function buildNode(
  node: GenericSvgNode,
  key: number,
  overrides: Record<string, string>,
): React.ReactElement | null {
  if (!node || typeof node !== "object" || typeof node.tag !== "string") {
    return null;
  }
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if ((SVG_COLOR_ATTRS as readonly string[]).includes(name)) {
      const color = colorAttrValue(value, overrides);
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
    .map((child, i) => buildNode(child, i, overrides))
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
 * Deliberately a separate implementation from `ValSvg` in `@valbuild/react`:
 * the editor cannot depend on that package, and it needs to resolve variables
 * eagerly so the preview shows real colors rather than unresolved custom
 * properties.
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
 * One row per literal color the import could not place, with the set of
 * variables it may be assigned to.
 *
 * We never snap a color to the nearest variable on our own: a brand color that
 * is quietly rewritten is worse than one the editor asks about. A variable can
 * opt in to fuzzy matching with `tolerance`, and then it never reaches here.
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
  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-text-secondary">
        {unmatched.length === 1
          ? "1 color is not in the palette. Pick where it should go:"
          : `${unmatched.length} colors are not in the palette. Pick where they should go:`}
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
                <SelectValue placeholder="Choose a variable" />
              </SelectTrigger>
              <SelectContent>
                {variableNames.map((name) => (
                  <SelectItem key={name} value={`var:${name}`}>
                    {name}
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
 * The presentational half of the svg field: paste markup in, get a source out.
 *
 * Kept free of Val providers so it can be driven directly from storybook and
 * from tests.
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
  const [markup, setMarkup] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [unmatched, setUnmatched] = useState<SvgUnmatchedColor[]>([]);
  const [overrides, setOverrides] = useState<Record<string, SvgColorOverride>>(
    {},
  );
  const [dark, setDark] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const darkOverrides = useMemo(() => {
    if (!dark) {
      return undefined;
    }
    // A stand-in for the app's dark mode stylesheet: invert the example colors
    // so it is obvious which parts of the icon are actually themeable.
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
    if (!input.trim()) {
      setError("Paste some svg markup first");
      return;
    }
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
    if (result.unmatched.length === 0) {
      onChange(result.source as unknown as GenericSvgSource);
    }
  };

  const onOverridesChange = (next: Record<string, SvgColorOverride>) => {
    setOverrides(next);
    const allChosen = unmatched.every(
      (color) => next[color.normalized ?? color.raw] !== undefined,
    );
    if (allChosen) {
      runImport(markup, next);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {source && (
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex items-center justify-center w-24 h-24 rounded border border-border-primary shrink-0",
              dark ? "bg-black text-white" : "bg-bg-primary",
            )}
          >
            <SvgRender
              source={source}
              variables={variables}
              overrides={darkOverrides}
              size={48}
            />
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <div className="text-text-secondary">
              viewBox <code>{source.viewBox}</code>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(variables).map(([name, variable]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 text-xs"
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
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setDark((d) => !d)}
            >
              {dark ? "Preview light" : "Preview dark"}
            </Button>
          </div>
        </div>
      )}
      {!readonly && (
        <>
          <textarea
            className="w-full min-h-24 rounded-md border border-border-primary bg-bg-primary px-3 py-2 text-sm font-mono"
            placeholder="Paste svg markup here"
            value={markup}
            spellCheck={false}
            onChange={(ev) => setMarkup(ev.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setOverrides({});
                runImport(markup, {});
              }}
            >
              Import svg
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => fileInput.current?.click()}
            >
              Upload .svg
            </Button>
            {source && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setMarkup(svgToString(source, { variables, pretty: true }));
                }}
              >
                Copy current as svg
              </Button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/svg+xml,.svg"
              className="hidden"
              onChange={(ev) => {
                const file = ev.target.files?.[0];
                if (!file) {
                  return;
                }
                // Read as text: an svg field stores the tree in the module, so
                // there is no binary to upload and no file op to create.
                const reader = new FileReader();
                reader.onload = () => {
                  const text = String(reader.result ?? "");
                  setMarkup(text);
                  setOverrides({});
                  runImport(text, {});
                };
                reader.readAsText(file);
                ev.target.value = "";
              }}
            />
          </div>
        </>
      )}
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
    <div id={path} className={cn(readonly && "pointer-events-none opacity-70")}>
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
