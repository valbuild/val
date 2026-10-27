import { Internal, SourcePath } from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValFieldProvider";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ReadonlyGuard } from "./ReadonlyGuard";
import { CHECKERBOARD, ColorFieldPure } from "./ColorFieldPure";

export { ColorFieldPure, type ColorFieldPureProps } from "./ColorFieldPure";

export function ColorField({
  path,
  readonly,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
}) {
  const type = "color";
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

  const schema = schemaAtPath.data;
  const content = (
    <div id={path}>
      <ColorFieldPure
        value={sourceAtPath.data}
        onChange={(next) => {
          addPatch(
            [{ op: "replace", path: patchPath, value: next }],
            schema.type,
          );
        }}
        format={schema.options?.format}
        alpha={schema.options?.alpha}
        readonly={readonly}
      />
    </div>
  );
  if (readonly) {
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

export function ColorPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "color");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  const parsed = Internal.color.parseColor(sourceAtPath.data);
  return (
    <div className="flex items-center gap-2 truncate">
      <span
        className="shrink-0 w-4 h-4 rounded-sm border border-border-primary overflow-hidden"
        style={CHECKERBOARD}
      >
        <span
          className="block w-full h-full"
          style={{
            backgroundColor:
              parsed === null
                ? "transparent"
                : Internal.color.formatColor(parsed, "rgb"),
          }}
        />
      </span>
      <span className="truncate font-mono text-xs">{sourceAtPath.data}</span>
    </div>
  );
}
