import { SourcePath } from "@valbuild/core";
import { Input } from "../../components/ui/input";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValProvider";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { FieldSourceError } from "../components/FieldSourceError";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../components/Preview";
import { useEffect, useState } from "react";

export function StringField({
  path,
  autoFocus,
}: {
  path: SourcePath;
  autoFocus?: boolean;
}) {
  const type = "string";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const [focus, setFocus] = useState(false);
  const [currentValue, setCurrentValue] = useState<string | null>(null);
  useEffect(() => {
    if (!focus && "data" in sourceAtPath && sourceAtPath.data !== undefined) {
      setCurrentValue(sourceAtPath.data);
    }
  }, [sourceAtPath, focus]);
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type={type} />
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
  return (
    <Input
      autoFocus={autoFocus}
      onFocus={() => {
        setFocus(true);
      }}
      onBlur={() => {
        setFocus(false);
      }}
      value={currentValue || ""}
      onChange={(ev) => {
        setCurrentValue(ev.target.value);
        addPatch([
          {
            op: "replace",
            path: patchPath,
            value: ev.target.value,
          },
        ]);
      }}
    />
  );
}

export function StringPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "string");
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <div className="truncate">{sourceAtPath.data}</div>;
}
