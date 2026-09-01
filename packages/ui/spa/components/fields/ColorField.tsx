import {
  ColorFormat,
  DEFAULT_COLOR_FORMAT,
  Internal,
  ParsedColor,
  SourcePath,
} from "@valbuild/core";
import { type CSSProperties, useRef, useState } from "react";
import { Input } from "../designSystem/input";
import { cn } from "../designSystem/cn";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValFieldProvider";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ReadonlyGuard } from "./ReadonlyGuard";

/**
 * The transparency checkerboard shown behind a swatch. Inlined rather than put
 * in index.css so that the field is self contained (and works in Storybook).
 */
const CHECKERBOARD: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #b0b0b0 25%, transparent 25%, transparent 75%, #b0b0b0 75%)," +
    "linear-gradient(45deg, #b0b0b0 25%, transparent 25%, transparent 75%, #b0b0b0 75%)",
  backgroundSize: "8px 8px",
  backgroundPosition: "0 0, 4px 4px",
  backgroundColor: "#fff",
};

export type ColorFieldPureProps = {
  /** The stored CSS color string, or `null` for an empty (nullable) field. */
  value: string | null;
  onChange: (value: string) => void;
  /** The format the value is written back in. Defaults to `"hsl"`. */
  format?: ColorFormat;
  /** Show the alpha slider and keep the alpha channel in the written value. */
  alpha?: boolean;
  /** Used for the wrapper element id (matches the schema field path in the bundled variant). */
  id?: string;
  /** Disable all interaction. */
  readonly?: boolean;
};

/**
 * The color field without any Val plumbing: a native `<input type="color">`
 * swatch (so the OS color picker is used), plus a text input for typing or
 * pasting any CSS color.
 *
 * Anything the text input can parse is accepted and converted to `format`, so
 * pasting `#3b82f6` into an `hsl` field stores `hsl(217.22 91.22% 59.8%)`.
 */
export function ColorFieldPure({
  value,
  onChange,
  format,
  alpha,
  id,
  readonly,
}: ColorFieldPureProps) {
  const targetFormat = format ?? DEFAULT_COLOR_FORMAT;
  const [text, setText] = useState(value ?? "");
  // Adopt `value` only when it changes for a reason OTHER than our own commit.
  //
  // This field commits on every parseable keystroke, so `value` comes straight
  // back reformatted into the target format. Syncing `text` from it
  // unconditionally rewrote the input mid-word - typing `#fff` into an `hsl`
  // field became `hsl(0 0% 100%)` after the third character, moving the caret
  // and making the rest of the value impossible to type. `onBlur` already snaps
  // the text to the canonical form once the user is done, so nothing is lost by
  // leaving it alone while they type.
  // The last value committed BY TYPING, so its echo can be recognised.
  const lastCommitted = useRef<string | null>(value);
  const [adoptedValue, setAdoptedValue] = useState(value);
  if (value !== adoptedValue) {
    setAdoptedValue(value);
    if (value !== lastCommitted.current) {
      setText(value ?? "");
    }
  }

  // What is in the text input wins over the stored value, so that the swatch
  // follows along while typing.
  const parsedText = Internal.color.parseColor(text);
  const parsedValue = value === null ? null : Internal.color.parseColor(value);
  const current = parsedText ?? parsedValue;
  const isInvalid = text.trim() !== "" && parsedText === null;

  /**
   * `keepText` is for commits made WHILE TYPING: the value echoes straight back
   * reformatted, and adopting it would rewrite the input under the caret. Every
   * other source (the OS picker, the alpha slider) should refresh the text,
   * since the user is not editing it.
   */
  const commit = (color: ParsedColor, keepText?: boolean) => {
    const next = Internal.color.formatColor(
      alpha ? color : { ...color, a: 1 },
      targetFormat,
    );
    if (keepText) {
      lastCommitted.current = next;
    }
    onChange(next);
  };

  const swatchColor = current ?? { r: 255, g: 255, b: 255, a: 1 };
  const swatchCss = Internal.color.formatColor(swatchColor, "rgb");

  return (
    <div id={id} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "relative shrink-0 w-10 h-10 rounded-md overflow-hidden border border-border-primary",
            "focus-within:ring-2 focus-within:ring-border-focus",
            readonly && "opacity-50",
          )}
          style={CHECKERBOARD}
        >
          <div
            className="absolute inset-0"
            style={{ backgroundColor: swatchCss }}
          />
          {/* The native input is laid over the swatch at zero opacity: it keeps
              the OS color picker and the keyboard behaviour, while the visible
              swatch can be styled (and can show alpha). */}
          <input
            type="color"
            aria-label="Color picker"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            disabled={readonly}
            value={Internal.color.colorToHex(swatchColor)}
            onChange={(ev) => {
              const picked = Internal.color.parseColor(ev.target.value);
              if (picked === null) {
                return;
              }
              // The native picker has no alpha, so keep the alpha we had.
              commit({ ...picked, a: current?.a ?? 1 });
            }}
          />
        </div>
        <div className="relative flex-1 min-w-0">
          <Input
            aria-label="Color value"
            aria-invalid={isInvalid}
            spellCheck={false}
            autoComplete="off"
            disabled={readonly}
            className={cn(
              "font-mono pr-16",
              isInvalid && "border-border-error-primary",
            )}
            placeholder={targetFormat}
            value={text}
            onChange={(ev) => {
              setText(ev.target.value);
              const parsed = Internal.color.parseColor(ev.target.value);
              if (parsed !== null) {
                commit(parsed, true);
              }
            }}
            onBlur={() => {
              // Snap the text back to the canonical form of the target format
              // once the user is done typing.
              if (parsedText !== null) {
                setText(
                  Internal.color.formatColor(
                    alpha ? parsedText : { ...parsedText, a: 1 },
                    targetFormat,
                  ),
                );
              } else if (text.trim() === "") {
                setText(value ?? "");
              }
            }}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-fg-tertiary pointer-events-none">
            {targetFormat}
          </span>
        </div>
      </div>
      {alpha && (
        <label className="flex items-center gap-2 text-xs text-fg-tertiary">
          <span className="w-10 shrink-0">Alpha</span>
          <input
            type="range"
            className="flex-1 accent-fg-brand-primary rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            min={0}
            max={100}
            step={1}
            disabled={readonly}
            value={Math.round((current?.a ?? 1) * 100)}
            onChange={(ev) => {
              const nextAlpha = Number(ev.target.value) / 100;
              onChange(
                Internal.color.formatColor(
                  { ...swatchColor, a: nextAlpha },
                  targetFormat,
                ),
              );
            }}
          />
          <span className="w-10 text-right tabular-nums">
            {Math.round((current?.a ?? 1) * 100)}%
          </span>
        </label>
      )}
      {isInvalid && (
        <div className="text-xs text-fg-error-secondary">
          Not a color we can parse. Try a hex value, rgb(), hsl() or oklch().
        </div>
      )}
    </div>
  );
}

export function ColorField({
  path,
  readonly,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
}) {
  const type = "color";
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

  const schema = schemaAtPath.data;
  const content = (
    <div id={path}>
      <ColorFieldPure
        value={sourceAtPath.data}
        onChange={(next) => {
          addPatch(
            [{ op: "replace", path: patchPath, value: next }],
            schema.type,
          );
        }}
        format={schema.options?.format}
        alpha={schema.options?.alpha}
        readonly={readonly}
      />
    </div>
  );
  if (readonly) {
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

export function ColorPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "color");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  const parsed = Internal.color.parseColor(sourceAtPath.data);
  return (
    <div className="flex items-center gap-2 truncate">
      <span
        className="shrink-0 w-4 h-4 rounded-sm border border-border-primary overflow-hidden"
        style={CHECKERBOARD}
      >
        <span
          className="block w-full h-full"
          style={{
            backgroundColor:
              parsed === null
                ? "transparent"
                : Internal.color.formatColor(parsed, "rgb"),
          }}
        />
      </span>
      <span className="truncate font-mono text-xs">{sourceAtPath.data}</span>
    </div>
  );
}
