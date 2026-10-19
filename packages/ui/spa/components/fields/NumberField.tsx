import { useEffect, useState } from "react";
import { NumberRules, SliderRender, SourcePath } from "@valbuild/core";
import { Input } from "../designSystem/input";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
} from "../ValFieldProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ReadonlyGuard } from "./ReadonlyGuard";
import { NumberFix, NumberSliderPure } from "./NumberSlider";
import { useDebouncedFieldWrite } from "./useDebouncedFieldWrite";

export function NumberField({
  path,
  readonly,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
}) {
  const type = "number";
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
  const rules = schemaAtPath.data.options ?? {};
  const render = schemaAtPath.data.render;
  const write = (value: number) =>
    addPatch([{ op: "replace", path: patchPath, value }], type);
  /**
   * The input comes off the SCHEMA, synchronously — `render` is static config
   * in the serialized schema, like `multiline` on a string. See
   * `core/src/render.ts`.
   */
  const content =
    render?.as === "slider" ? (
      <div id={path}>
        <NumberSliderField
          source={typeof source === "number" ? source : null}
          render={render}
          rules={rules}
          write={write}
          readonly={readonly}
        />
      </div>
    ) : (
      <div id={path}>
        <Input
          inputMode={rules.integer ? "numeric" : "decimal"}
          value={source || 0}
          onChange={(ev) => {
            const nextNumber = Number(ev.target.value);
            if (!Number.isNaN(nextNumber)) {
              write(nextNumber);
            }
          }}
        />
        {typeof source === "number" && !readonly && (
          <NumberFix value={source} rules={rules} onChange={write} />
        )}
      </div>
    );
  if (readonly) {
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

/**
 * The slider, with its value held locally and the patch debounced.
 *
 * A drag fires `onChange` per pixel, and every one of those as a patch is a
 * chain entry, a source rebuild and a wake for every listener on the module —
 * the same reason a text field debounces its keystrokes. The slider itself
 * follows the pointer from local state; the write follows on a pause, and
 * when the pointer is let go. See `useDebouncedFieldWrite`.
 */
function NumberSliderField({
  source,
  render,
  rules,
  write: writeNow,
  readonly,
}: {
  source: number | null;
  render: SliderRender;
  rules: NumberRules;
  write: (value: number) => void;
  readonly?: boolean;
}) {
  const [current, setCurrent] = useState<number | null>(source);
  const write = useDebouncedFieldWrite<number>(writeNow);
  useEffect(() => {
    // Not while a movement is unwritten: the source still holds the value
    // from before it, and taking it would snap the thumb back. As in
    // `StringField`.
    if (write.hasPending()) {
      return;
    }
    setCurrent(source);
  }, [source, write]);
  return (
    <NumberSliderPure
      value={current}
      render={render}
      rules={rules}
      readonly={readonly}
      onChange={(next) => {
        setCurrent(next);
        write.push(next);
      }}
      onCommit={write.flush}
    />
  );
}

export function NumberPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "number");
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
