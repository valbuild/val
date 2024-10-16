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
import { CheckedState } from "@radix-ui/react-checkbox";

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
  const source = sourceAtPath.data;
  return (
    <Checkbox
      checked={source === null ? "indeterminate" : source}
      onCheckedChange={(ev: CheckedState) => {
        // TODO: check this logic. We use null to represent indeterminate state, but how should we cycle through the states?
        let nextValue: boolean | null = false;
        if (schemaAtPath.data.opt) {
          if (ev === true) {
            nextValue = null;
          } else {
            nextValue = ev === "indeterminate" ? false : true;
          }
        } else {
          nextValue = ev === "indeterminate" ? false : ev;
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

export function BooleanPreview({ source }: { source: any }) {
  return <div>{source}</div>;
}
