import React from "react";
import { SourcePath } from "@valbuild/core";
import { Input } from "../designSystem/input";
import { useShallowSourceAtPath, useValField } from "../ValFieldProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useEffect, useState } from "react";
import { AutoGrowingTextarea } from "../AutoGrowingTextarea";
import { ReadonlyGuard } from "./ReadonlyGuard";
import { useDebouncedFieldWrite } from "./useDebouncedFieldWrite";

export function StringField({
  path,
  autoFocus,
  readonly,
  compact,
}: {
  path: SourcePath;
  autoFocus?: boolean;
  readonly?: boolean;
  compact?: boolean;
}) {
  const type = "string";
  const {
    source: sourceAtPath,
    schema: schemaAtPath,
    patchPath,
    addPatch,
  } = useValField(path, type);
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  /**
   * One patch per PAUSE in typing, not per keystroke.
   *
   * The input is unaffected — `currentValue` is local state and still updates on
   * every keystroke. What waits is the write, because each write is a patch in
   * the chain, a source rebuild, and a wake for every listener on the module. A
   * paragraph typed here used to leave a patch per character behind it.
   * See `useDebouncedFieldWrite`.
   */
  const write = useDebouncedFieldWrite<string>((value) => {
    addPatch([{ op: "replace", path: patchPath, value }], type);
  });
  const maybeSourceData = "data" in sourceAtPath && sourceAtPath.data;
  const maybeClientSideOnly =
    "clientSideOnly" in sourceAtPath && sourceAtPath.clientSideOnly;
  useEffect(() => {
    /**
     * Not while a keystroke is still unwritten.
     *
     * Between a keystroke and its patch the source still holds the PRE-edit
     * value, so taking it would put back the character just typed. The same
     * guard the rich text field needs, for the same window — it is merely wider
     * now that the write is debounced.
     */
    if (write.hasPending()) {
      return;
    }
    if (maybeClientSideOnly === false) {
      setCurrentValue(
        typeof maybeSourceData === "string" ? maybeSourceData : null,
      );
    }
    // `write` is deliberately not a dependency: it is stable, and re-running
    // this when a pending edit changes is exactly what the guard prevents.
  }, [maybeSourceData, maybeClientSideOnly, write]);
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
  /**
   * The layout comes off the SCHEMA, synchronously.
   *
   * `multiline` is static config — no closure, no dependency on source — so it
   * travels in the serialized schema and there is nothing to wait for. That is
   * what removes the old effect-driven dance here, which existed only because
   * the layout used to arrive asynchronously from the host and the field would
   * otherwise flip from input to textarea a tick later. (It also, silently, was
   * the only reason the uncontrolled textarea below ever had a value — see
   * `architecture/quirks.md`.) If it ever stops being static, this read is the
   * thing that has to change. See `core/src/render.ts`.
   */
  /**
   * A read-only value in a dense row is TEXT, not a disabled input.
   *
   * `readonly` fields are wrapped in `ReadonlyGuard`, which sets `inert` - so
   * the input inside cannot be focused, scrolled, or even selected. A single
   * line longer than the box was therefore clipped at the right edge with no
   * way at all to reach the rest of it, which in the compare view (where the
   * box is half of a phone's width) is most of the values worth reading. Text
   * wraps, so the whole value is on screen, and it needs no guard because
   * there is nothing there to type into.
   *
   * `compact` rather than `readonly` alone: a `s.string().readonly()` field in
   * the editor still sits in a row of inputs and should look like one. Compact
   * is the dense read-only presentation - the compare view is its only caller.
   */
  if (readonly && compact) {
    const value = sourceAtPath.data;
    if (value === null) {
      return <PreviewNull path={path} />;
    }
    return (
      <div
        id={path}
        // `whitespace-pre-wrap` keeps the newlines of a multiline value, and
        // `anywhere` breaks the unbroken ones - a URL or a hash has no space
        // in it to wrap at, and would otherwise widen the row instead.
        className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere] opacity-70"
      >
        {value}
      </div>
    );
  }
  const multiline = schemaAtPath.data.multiline;
  let content: React.ReactNode;
  if (multiline) {
    content = (
      <div id={path}>
        <AutoGrowingTextarea
          className="pr-6 sm:pr-8 sm:w-[calc(100%-0.5rem)]"
          autoFocus={autoFocus}
          // Controlled, like the other two branches. `currentValue` is filled
          // by an effect a commit AFTER the source arrives, so at mount it is
          // still `null` — and the auto-grow ghost is seeded from props ONCE, so
          // an uncontrolled `defaultValue` leaves the box sized for an empty
          // string however long the text is. See `architecture/quirks.md`.
          value={currentValue || ""}
          onChange={(ev) => {
            setCurrentValue(ev.target.value);
            write.push(ev.target.value);
          }}
          onBlur={write.flush}
        />
      </div>
    );
  } else {
    content = (
      <div id={path}>
        <Input
          className="pr-6 sm:pr-8 sm:w-[calc(100%-0.5rem)]"
          autoFocus={autoFocus}
          value={currentValue || ""}
          onChange={(ev) => {
            setCurrentValue(ev.target.value);
            write.push(ev.target.value);
          }}
          onBlur={write.flush}
        />
      </div>
    );
  }

  if (readonly) {
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

export function StringPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "string");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <div className="truncate">{sourceAtPath.data}</div>;
}
