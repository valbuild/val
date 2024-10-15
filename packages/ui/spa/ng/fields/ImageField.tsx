import { SourcePath } from "@valbuild/core";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { FieldSourceError } from "../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
} from "../ValProvider";

export function ImageField({ path }: { path: SourcePath }) {
  const type = "image";
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
    <img
      src="https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?q=80&w=4000&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
      draggable={false}
      className="object-contain w-full max-h-[500px] rounded-lg"
      style={{
        cursor: "crosshair",
      }}
    />
  );
}

export function ImagePreview({ source }: { source: any }) {
  return (
    <img
      src="https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?q=80&w=4000&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
      draggable={false}
      className="object-contain w-full max-h-[500px]"
      style={{
        cursor: "crosshair",
      }}
    />
  );
}
