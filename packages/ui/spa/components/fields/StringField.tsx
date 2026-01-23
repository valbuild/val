import { CodeLanguage, SourcePath } from "@valbuild/core";
import { Input } from "../designSystem/input";
import {
  useAddPatch,
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
import { ValidationErrors } from "../../components/ValidationError";
import { AutoGrowingTextarea } from "../AutoGrowingTextarea";
import { CodeEditor } from "../CodeEditor";

export function StringField({
  path,
  autoFocus,
}: {
  path: SourcePath;
  autoFocus?: boolean;
}) {
  const type = "string";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, "string");
  const { patchPath, addPatch } = useAddPatch(path);
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  const maybeSourceData = "data" in sourceAtPath && sourceAtPath.data;
  const maybeClientSideOnly =
    "clientSideOnly" in sourceAtPath && sourceAtPath.clientSideOnly;
  useEffect(() => {
    if (maybeClientSideOnly === false) {
      setCurrentValue(
        typeof maybeSourceData === "string" ? maybeSourceData : null,
      );
    }
  }, [maybeSourceData, maybeClientSideOnly]);
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
  if (renderAsTextarea) {
    return (
      <div id={path}>
        <ValidationErrors path={path} />
        <AutoGrowingTextarea
          className="pr-6 sm:pr-8 sm:w-[calc(100%-0.5rem)]"
          autoFocus={autoFocus}
          defaultValue={currentValue || ""}
          onChange={(ev) => {
            setCurrentValue(ev.target.value);
            addPatch(
              [
                {
                  op: "replace",
                  path: patchPath,
                  value: ev.target.value,
                },
              ],
              type,
            );
          }}
        />
      </div>
    );
  }
  if (renderAsCodeLanguage) {
    return (
      <div id={path}>
        <ValidationErrors path={path} />
        <CodeEditor
          language={renderAsCodeLanguage}
          value={currentValue || ""}
          autoFocus={autoFocus}
          onChange={(value) => {
            setCurrentValue(value);
            addPatch(
              [
                {
                  op: "replace",
                  path: patchPath,
                  value: value,
                },
              ],
              type,
            );
          }}
        />
      </div>
    );
  }
  return (
    <div id={path}>
      <ValidationErrors path={path} />
      <Input
        className="pr-6 sm:pr-8 sm:w-[calc(100%-0.5rem)]"
        autoFocus={autoFocus}
        value={currentValue || ""}
        onChange={(ev) => {
          setCurrentValue(ev.target.value);
          addPatch(
            [
              {
                op: "replace",
                path: patchPath,
                value: ev.target.value,
              },
            ],
            type,
          );
        }}
      />
    </div>
  );
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
