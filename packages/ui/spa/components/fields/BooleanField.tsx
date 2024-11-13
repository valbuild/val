import { Json, SourcePath } from "@valbuild/core";
import { Checkbox } from "../designSystem/checkbox";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  ShallowSource,
} from "../ValProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { Check } from "lucide-react";
import { ValidationErrors } from "../../components/ValidationError";

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
    <div>
      <ValidationErrors path={path} />
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
    </div>
  );
}

export function EmbeddedBooleanField({
  path,
  source,
  isNullable,
  loadingStatus,
}: {
  path: SourcePath;
  source: ShallowSource[keyof ShallowSource] | undefined | null;
  isNullable: boolean;
  loadingStatus: "not-asked" | "loading" | "success" | "error";
}) {
  const { addPatch, patchPath } = useAddPatch(path);
  if (typeof source !== "boolean" && source !== null) {
    return (
      <FieldSourceError path={path} error={"Expected boolean"} type="boolean" />
    );
  }
  return (
    <Checkbox
      disabled={loadingStatus === "loading"}
      checked={
        source === null
          ? "indeterminate"
          : typeof source === "boolean"
            ? source
            : false
      }
      onCheckedChange={() => {
        if (source === null) {
          addPatch([
            {
              op: "replace",
              path: patchPath,
              value: true,
            },
          ]);
        } else if (source === false && isNullable) {
          addPatch([
            {
              op: "replace",
              path: patchPath,
              value: null,
            },
          ]);
        } else if (source === false) {
          addPatch([
            {
              op: "replace",
              path: patchPath,
              value: true,
            },
          ]);
        } else {
          addPatch([
            {
              op: "replace",
              path: patchPath,
              value: false,
            },
          ]);
        }
      }}
    />
  );
}

export function BooleanPreview({ path }: { path: SourcePath }): JSX.Element {
  const sourceAtPath = useShallowSourceAtPath(path, "boolean");
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type="boolean" />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  } else if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  } else if (sourceAtPath.data === true) {
    return (
      <div className="flex items-center justify-center w-4 h-4 border rounded border-text-primary">
        <Check className="w-3 h-3" />
      </div>
    );
  } else if (sourceAtPath.data === false) {
    return <div className="w-4 h-4 border rounded border-text-primary" />;
  } else {
    console.warn("Unexpected value for boolean field", sourceAtPath.data);
    return <div className="w-4 h-4 rounded border-bg-brand-primary" />;
  }
}
