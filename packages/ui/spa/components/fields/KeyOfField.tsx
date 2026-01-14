import { Internal, SourcePath } from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useValPortal,
} from "../ValProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
  SelectTrigger,
} from "../designSystem/select";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useNavigation } from "../../components/ValRouter";
import { Link } from "lucide-react";
import { ValidationErrors } from "../../components/ValidationError";

export function KeyOfField({ path }: { path: SourcePath }) {
  const type = "keyOf";
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const keyOf =
    "data" in schemaAtPath &&
    schemaAtPath.data &&
    schemaAtPath.data.type === "keyOf"
      ? {
          type: schemaAtPath.data.schema?.type,
          path: schemaAtPath.data.path,
        }
      : undefined;

  const referencedSource = useShallowSourceAtPath(
    keyOf?.path,
    keyOf?.type as "record" | "object",
  );
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const portalContainer = useValPortal();
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
  if (referencedSource.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={referencedSource.error}
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
  if (
    keyOf !== undefined &&
    !(keyOf.type === "record" || keyOf.type === "object")
  ) {
    return (
      <FieldSchemaError
        path={keyOf.path}
        error={`Cannot refer to keyOf type: ${keyOf.type}. Must refer to be record or object`}
      />
    );
  }
  if (keyOf !== undefined && referencedSource.status === "not-found") {
    return (
      <FieldSchemaError
        path={keyOf.path}
        error="Referenced source not found"
        type={keyOf.type}
      />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <FieldLoading path={path} type={type} />;
  }
  if (
    "data" in schemaAtPath &&
    schemaAtPath.data &&
    schemaAtPath.data.type !== type
  ) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }
  if (!referencedSource) {
    return (
      <FieldSchemaError
        path={keyOf?.path}
        error="Referenced source not found"
        type={"keyOf"}
      />
    );
  }
  if ("data" in referencedSource && referencedSource.data === null) {
    return (
      <FieldSchemaError
        path={keyOf?.path}
        error="Referenced source is null"
        type={"keyOf"}
      />
    );
  }
  const keys =
    "data" in referencedSource && referencedSource.data
      ? Object.keys(referencedSource.data)
      : undefined;
  const source = sourceAtPath.data;
  return (
    <div id={path}>
      <ValidationErrors path={path} />
      <div className="flex justify-between items-center">
        <Select
          value={source ?? ""}
          onValueChange={(value) => {
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
        >
          <SelectTrigger>
            <SelectValue>{source}</SelectValue>
          </SelectTrigger>
          <SelectContent className="w-32" container={portalContainer}>
            {schemaAtPath.status === "loading" ||
            keyOf == undefined ||
            keys === undefined ? (
              <LoadingSelectContent />
            ) : (
              keys.map((index) => (
                <SelectItem key={index} value={index}>
                  {index}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {source && keyOf?.path && (
          <button
            title="Go to reference"
            className="px-2"
            onClick={() => {
              navigate(
                Internal.createValPathOfItem(keyOf.path, source) as SourcePath,
              );
            }}
          >
            <Link size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function LoadingSelectContent() {
  return <span>Loading...</span>;
}

export function KeyOfPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "keyOf");
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
