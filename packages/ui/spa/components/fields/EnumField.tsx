import { SourcePath } from "@valbuild/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../designSystem/select";
import {
  useAddPatch,
  useSchemaAtPath,
  useSourceAtPath,
} from "../ValFieldProvider";
import { useShallowSourceAtPath } from "../ValFieldProvider";
import { useValPortal } from "../ValPortalProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ReadonlyGuard } from "./ReadonlyGuard";

/**
 * One of a fixed set of strings, edited as a dropdown.
 *
 * A leaf — the values are the schema, so there is nothing below this field to
 * navigate into. That is what separates it from `DiscriminatedUnionField`,
 * which renders the fields of whichever variant is selected.
 */
export function EnumField({
  path,
  readonly,
}: {
  path: SourcePath;
  readonly?: boolean;
}) {
  const type = "enum";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
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
  const source = sourceAtPath.data;
  if (typeof source !== "string" && source !== null) {
    return (
      <FieldSourceError
        path={path}
        error={"Expected source to be a string, but found: " + typeof source}
        schema={schemaAtPath}
      />
    );
  }
  const content = (
    <div id={path}>
      <SelectField
        path={path}
        source={source}
        readonly={readonly}
        options={schemaAtPath.data.values}
      />
    </div>
  );
  if (readonly) {
    return <ReadonlyGuard>{content}</ReadonlyGuard>;
  }
  return content;
}

function SelectField({
  path,
  source,
  options,
  readonly,
}: {
  path: SourcePath;
  source: string | null;
  options?: string[];
  readonly?: boolean;
}) {
  const { addPatch, patchPath } = useAddPatch(path);
  const portalContainer = useValPortal();
  return (
    <Select
      disabled={readonly}
      value={source ?? ""}
      onValueChange={(value) => {
        if (readonly) return;
        addPatch(
          [
            {
              op: "replace",
              path: patchPath,
              value: value,
            },
          ],
          "enum",
        );
      }}
    >
      <SelectTrigger>
        <SelectValue>{source}</SelectValue>
      </SelectTrigger>
      <SelectContent className="w-32" container={portalContainer}>
        {options == undefined ? (
          <LoadingSelectContent />
        ) : (
          options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

function LoadingSelectContent() {
  return <div>Loading...</div>;
}

export function EnumPreview({ path }: { path: SourcePath }) {
  const type = "enum";
  const sourceAtPath = useSourceAtPath(path);
  const schemaAtPath = useSchemaAtPath(path);
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={schemaAtPath}
      />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (!("data" in schemaAtPath) || schemaAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
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
  if (typeof sourceAtPath.data !== "string") {
    return (
      <FieldSourceError
        path={path}
        error={
          "Expected source to be a string, but found: " +
          typeof sourceAtPath.data
        }
        schema={schemaAtPath}
      />
    );
  }
  return <div className="truncate">{sourceAtPath.data}</div>;
}
