import {
  ListRecordRender as ListRecordRender,
  SourcePath,
} from "@valbuild/core";
import {
  useRenderOverrideAtPath,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValFieldProvider";
import { useAllValidationErrors } from "../ValErrorProvider";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { useNavigation } from "../../components/ValRouter";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { PreviewWithRender } from "../../components/PreviewWithRender";
import { ValidationErrors } from "../../components/ValidationError";
import { isParentError } from "../../utils/isParentError";
import { ErrorIndicator } from "../ErrorIndicator";
import classNames from "classnames";
import { PreviewError } from "../PreviewError";

export function RecordFields({ path }: { path: SourcePath }) {
  const type = "record";
  const validationErrors = useAllValidationErrors() || {};
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const renderAtPath = useRenderOverrideAtPath(path);
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
  const renderListAtPathData =
    renderAtPath &&
    "data" in renderAtPath &&
    renderAtPath.data &&
    renderAtPath.data.layout === "list" &&
    renderAtPath.data.parent === "record"
      ? renderAtPath.data
      : undefined;
  return (
    <div id={path}>
      <ValidationErrors path={path} />
      {renderAtPath?.status === "error" && (
        <PreviewError error={renderAtPath.message} path={path} />
      )}
      {renderListAtPathData && (
        <ListRecordRenderComponent path={path} {...renderListAtPathData} />
      )}
      {!renderListAtPathData && (
        <div className="grid grid-cols-1 gap-4">
          {source &&
            Object.entries(source).map(([key]) => (
              <div
                key={key}
                onClick={() => navigate(sourcePathOfItem(path, key))}
                className={classNames(
                  "bg-primary-foreground cursor-pointer min-w-[320px] max-h-[170px] overflow-hidden rounded-md border border-border-primary p-4",
                  "hover:bg-bg-secondary-hover",
                )}
              >
                <div className="flex justify-between items-start">
                  <div className="pb-4 font-semibold text-md">{key}</div>
                  {isParentError(
                    sourcePathOfItem(path, key),
                    validationErrors,
                  ) && <ErrorIndicator />}
                </div>
                <div>
                  <PreviewWithRender path={sourcePathOfItem(path, key)} />
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ListRecordRenderComponent({
  path,
  items,
}: {
  path: SourcePath;
  items: ListRecordRender["items"];
}) {
  const { navigate } = useNavigation();
  return (
    <div className="flex flex-col space-y-4 w-full">
      {items.map(([key]) => (
        <button
          key={key}
          onClick={() => navigate(sourcePathOfItem(path, key))}
          className={classNames(
            "hover:bg-bg-secondary-hover",
            "border rounded-lg cursor-pointer border-border-primary",
          )}
        >
          <PreviewWithRender path={sourcePathOfItem(path, key)} />
        </button>
      ))}
    </div>
  );
}

export function RecordPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "record");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
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
