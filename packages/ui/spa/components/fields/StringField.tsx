import React from "react";
import { CodeLanguage, SourcePath } from "@valbuild/core";
import { Input } from "../designSystem/input";
import {
  useAddPatch,
  useFieldCreatorId,
  useRenderOverrideAtPath,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValFieldProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useEffect, useState } from "react";
import { AutoGrowingTextarea } from "../AutoGrowingTextarea";
import { CodeEditor } from "../CodeEditor";
import { ReadonlyGuard } from "./ReadonlyGuard";
import { useDebouncedFieldWrite } from "./useDebouncedFieldWrite";

export function StringField({
  path,
  autoFocus,
  readonly,
}: {
  path: SourcePath;
  autoFocus?: boolean;
  readonly?: boolean;
  compact?: boolean;
}) {
  const type = "string";
  const creatorId = useFieldCreatorId();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, "string", creatorId);
  const { patchPath, addPatch } = useAddPatch(path, creatorId);
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
  const renderAtPath = useRenderOverrideAtPath(path);
  const [renderAsTextarea, setRenderAsTextarea] = useState(false);
  const [renderAsCodeLanguage, setRenderAsCodeLanguage] = useState<
    CodeLanguage | false
  >(false);
  useEffect(() => {
    if (renderAtPath && renderAtPath.status === "success") {
      // Only change if render has indeed loaded (if not we will go from input to textarea and back which is bad)
      if (renderAtPath.data.layout === "textarea") {
        setRenderAsTextarea(true);
      } else if (renderAtPath.data.layout === "code") {
        setRenderAsCodeLanguage(renderAtPath.data.language);
      } else {
        setRenderAsTextarea(false);
      }
    }
  }, [renderAtPath]);

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
  let content: React.ReactNode;
  if (renderAsTextarea) {
    content = (
      <div id={path}>
        <AutoGrowingTextarea
          className="pr-6 sm:pr-8 sm:w-[calc(100%-0.5rem)]"
          autoFocus={autoFocus}
          defaultValue={currentValue || ""}
          onChange={(ev) => {
            setCurrentValue(ev.target.value);
            write.push(ev.target.value);
          }}
          onBlur={write.flush}
        />
      </div>
    );
  } else if (renderAsCodeLanguage) {
    content = (
      <div id={path}>
        <CodeEditor
          language={renderAsCodeLanguage}
          value={currentValue || ""}
          autoFocus={autoFocus}
          onChange={(value) => {
            setCurrentValue(value);
            write.push(value);
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
