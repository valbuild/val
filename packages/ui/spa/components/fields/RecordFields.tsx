import { SourcePath } from "@valbuild/core";
import {
  useErrors,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValProvider";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { useNavigation } from "../../components/ValRouter";
import { Preview, PreviewLoading, PreviewNull } from "../../components/Preview";
import { ValidationErrors } from "../../components/ValidationError";
import { isParentError } from "../../utils/isParentError";
import { ErrorIndicator } from "../ErrorIndicator";

export function RecordFields({ path }: { path: SourcePath }) {
  const type = "record";
  const { validationErrors } = useErrors();
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
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
  return (
    <div>
      <ValidationErrors path={path} />
      <div className="grid grid-cols-1 gap-4">
        {source &&
          Object.entries(source).map(([key]) => (
            <div
              key={key}
              onClick={() => navigate(sourcePathOfItem(path, key))}
              className="bg-primary-foreground cursor-pointer hover:bg-primary-foreground/50 min-w-[320px] max-h-[170px] overflow-hidden rounded-md border border-border-primary p-4"
            >
              <div className="flex items-start justify-between">
                <div className="pb-4 font-semibold text-md">{key}</div>
                {isParentError(
                  sourcePathOfItem(path, key),
                  validationErrors,
                ) && <ErrorIndicator />}
              </div>
              <div>
                <Preview path={sourcePathOfItem(path, key)} />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

export function RecordPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "record");
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type="record" />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  const keys = Object.keys(sourceAtPath.data);
  return (
    <div className="text-left">
      <span className="text-fg-brand-primary">{keys.length}</span>
      <span className="mr-1">{` item${keys.length === 1 ? "" : "s"}:`}</span>
      {keys.map((key, index) => (
        <>
          <span key={key} className="text-fg-brand-primary">
            {key}
          </span>
          {index < keys.length - 1 ? ", " : ""}
        </>
      ))}
    </div>
  );
}
