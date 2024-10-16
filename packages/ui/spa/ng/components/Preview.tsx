import { SourcePath } from "@valbuild/core";
import { StringPreview } from "../fields/StringField";
import { useSchemaAtPath } from "../ValProvider";
import { ArrayPreview } from "../fields/ArrayFields";
import { BooleanPreview } from "../fields/BooleanField";
import { NumberPreview } from "../fields/NumberField";
import { UnionPreview } from "../fields/UnionField";
import { ObjectPreview } from "../fields/ObjectFields";

export function Preview({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  if (!("data" in schemaAtPath) || schemaAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  const type = schemaAtPath.data.type;

  if (type === "string") {
    return <StringPreview path={path} />;
  } else if (type === "array") {
    return <ArrayPreview path={path} />;
  } else if (type === "boolean") {
    return <BooleanPreview path={path} />;
  } else if (type === "number") {
    return <NumberPreview path={path} />;
  } else if (type === "union") {
    return <UnionPreview path={path} />;
  } else if (type === "object") {
    return <ObjectPreview path={path} />;
  } else {
    return <div>TODO: preview of {type}</div>;
  }
}

export function PreviewLoading({ path }: { path: SourcePath }) {
  return <div key={path + "-loading"}>Loading...</div>;
}

export function PreviewNull({ path }: { path: SourcePath }) {
  return (
    <div key={path + "-null"} className="text-bg-brand-primary">
      null
    </div>
  );
}
