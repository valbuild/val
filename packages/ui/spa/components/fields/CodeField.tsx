import React, { useEffect, useState } from "react";
import { SourcePath } from "@valbuild/core";
import { useShallowSourceAtPath, useValField } from "../ValFieldProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { CodeEditor } from "../CodeEditor";
import { ReadonlyGuard } from "./ReadonlyGuard";
import { useDebouncedFieldWrite } from "./useDebouncedFieldWrite";

export function CodeField({
  path,
  autoFocus,
  readonly,
}: {
  path: SourcePath;
  autoFocus?: boolean;
  readonly?: boolean;
}) {
  const type = "code";
  const {
    source: sourceAtPath,
    schema: schemaAtPath,
    patchPath,
    addPatch,
  } = useValField(path, type);
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  /**
   * One patch per PAUSE in typing, not per keystroke — the same reason
   * `StringField` debounces, and more of it: code is typed in bursts, and each
   * write is a patch in the chain, a source rebuild and a wake for every
   * listener on the module. See `useDebouncedFieldWrite`.
   */
  const write = useDebouncedFieldWrite<string>((value) => {
    addPatch([{ op: "replace", path: patchPath, value }], type);
  });
  const maybeSourceData = "data" in sourceAtPath && sourceAtPath.data;
  const maybeClientSideOnly =
    "clientSideOnly" in sourceAtPath && sourceAtPath.clientSideOnly;
  useEffect(() => {
    // Not while a keystroke is still unwritten: between a keystroke and its
    // patch the source still holds the PRE-edit value, so taking it would put
    // back the character just typed. Same guard as `StringField`.
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
  // `undefined` is a real state: `s.code()` with no language is a monospaced
  // box with no highlighting, which `CodeEditor` handles.
  const language = schemaAtPath.data.options?.language;
  const content: React.ReactNode = (
    <div id={path}>
      <CodeEditor
        language={language}
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

  if (readonly) {
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

export function CodePreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "code");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  // One line of it, monospaced: a preview row has one line to give, and the
  // newlines a code value is full of would otherwise collapse into a run of
  // spaces that reads as a single sentence.
  return (
    <div className="font-mono text-xs truncate">
      {sourceAtPath.data.split("\n", 1)[0]}
    </div>
  );
}
