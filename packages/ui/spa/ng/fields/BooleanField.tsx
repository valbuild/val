import { SourcePath } from "@valbuild/core";
import { Checkbox } from "../../components/ui/checkbox";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { FieldSourceError } from "../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
} from "../ValProvider";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../components/Preview";
import { Check } from "lucide-react";

export function BooleanField({ path }: { path: SourcePath }) {
  const type = "boolean";
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
  const source = sourceAtPath.data;
  // null is the "indeterminate" state
  const current = source === null ? "indeterminate" : source;
  return (
    <Checkbox
      checked={current}
      onCheckedChange={() => {
        let nextValue: boolean | null = false;
        // If optional/nullable: we cycle like this: true -> indeterminate / null -> false -> true
        if (schemaAtPath.data.opt) {
          if (current === true) {
            nextValue = null;
          } else if (current === null) {
            nextValue = false;
          } else if (current === false) {
            nextValue = true;
          } else {
            console.warn("Unexpected value for boolean field", current);
            nextValue = false;
          }
        } else {
          if (current === true) {
            nextValue = false;
          } else if (current === "indeterminate" || current === false) {
            // Even if not optional: we accept that the current value is indeterminate
            nextValue = true;
          } else {
            console.warn("Unexpected value for boolean field", current);
            nextValue = false;
          }
        }
        addPatch([
          {
            op: "replace",
            path: patchPath,
            value: nextValue,
          },
        ]);
      }}
    />
  );
}

export function BooleanPreview({ path }: { path: SourcePath }): JSX.Element {
  const sourceAtPath = useShallowSourceAtPath(path, "boolean");
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  } else if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  } else if (sourceAtPath.data === true) {
    return <Check className="w-4 h-4" />;
  } else if (sourceAtPath.data === false) {
    return <div className="w-4 h-4 rounded border-bg-brand-primary" />;
  } else {
    console.warn("Unexpected value for boolean field", sourceAtPath.data);
    return <div className="w-4 h-4 rounded border-bg-brand-primary" />;
  }
}
