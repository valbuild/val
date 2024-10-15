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

export function StringField({ path }: { path: SourcePath }) {
  const type = "string";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const [patchPath, addPatch] = useAddPatch(path);
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
    <Input
      value={source || ""}
      onChange={(ev) => {
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

export function StringPreview({ source }: { source: any }) {
  return <div className="truncate">{source}</div>;
}
