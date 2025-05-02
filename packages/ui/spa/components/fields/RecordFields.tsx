import {
  ImageSource,
  Internal,
  ListRecordPreview as ListRecordPreview,
  SourcePath,
} from "@valbuild/core";
import {
  useAllValidationErrors,
  usePreviewOverrideAtPath,
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
import { useState } from "react";
import classNames from "classnames";
import { PreviewError } from "../PreviewError";

export function RecordFields({ path }: { path: SourcePath }) {
  const type = "record";
  const validationErrors = useAllValidationErrors() || {};
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const previewAtPath = usePreviewOverrideAtPath(path);
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
  const previewListAtPathData =
    previewAtPath &&
    "data" in previewAtPath &&
    previewAtPath.data &&
    previewAtPath.data.layout === "list" &&
    previewAtPath.data.parent === "record"
      ? previewAtPath.data
      : undefined;
  return (
    <div id={path}>
      <ValidationErrors path={path} />
      {previewAtPath?.status === "error" && (
        <PreviewError error={previewAtPath.message} path={path} />
      )}
      {previewListAtPathData && (
        <ListRecordPreview path={path} {...previewListAtPathData} />
      )}
      {!previewListAtPathData && (
        <div className="grid grid-cols-1 gap-4">
          {source &&
            Object.entries(source).map(([key]) => (
              <div
                key={key}
                onClick={() => navigate(sourcePathOfItem(path, key))}
                className={classNames(
                  "bg-primary-foreground cursor-pointer min-w-[320px] max-h-[170px] overflow-hidden rounded-md border border-border-primary p-4",
                  "hover:bg-bg-secondary_subtle",
                )}
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
      )}
    </div>
  );
}

function ListPreviewItem({
  title,
  image,
  subtitle,
}: ListRecordPreview["items"][number][1]) {
  return (
    <div
      className={classNames(
        "flex w-full items-start justify-between pl-4 flex-grow text-left",
      )}
    >
      <div className="flex flex-col flex-shrink py-4 overflow-x-clip">
        <div className="text-lg font-medium">{title}</div>
        {subtitle && (
          <div className="flex-shrink block overflow-hidden text-sm text-gray-500 text-ellipsis max-h-5">
            {subtitle}
          </div>
        )}
      </div>
      {image && <ImageOrPlaceholder src={image} alt={title} />}
    </div>
  );
}

function ListRecordPreview({
  path,
  items,
}: {
  path: SourcePath;
  items: ListRecordPreview["items"];
}) {
  const { navigate } = useNavigation();
  return (
    <div className="flex flex-col w-full space-y-4">
      {items.map(([key, { title, subtitle, image }]) => (
        <button
          key={key}
          onClick={() => navigate(sourcePathOfItem(path, key))}
          className={classNames(
            "hover:bg-bg-secondary_subtle",
            "border rounded-lg cursor-pointer border-border-primary",
          )}
        >
          <ListPreviewItem title={title} subtitle={subtitle} image={image} />
        </button>
      ))}
    </div>
  );
}

function ImageOrPlaceholder({
  src,
  alt,
}: {
  src: ImageSource | null | undefined;
  alt: string;
}) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (src === null || src === undefined) {
    return (
      <div className="flex-shrink-0 w-20 h-20 ml-4 opacity-25 bg-bg-brand-secondary"></div>
    );
  }

  const imageUrl = Internal.convertFileSource(src).url;

  return (
    <div className="relative flex-shrink-0 w-20 h-20 ml-4">
      {!isLoaded && (
        <div className="absolute inset-0 opacity-25 bg-bg-brand-secondary animate-in"></div>
      )}
      <img
        src={imageUrl}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(false)}
        className={`absolute inset-0 object-cover w-full h-full rounded-r-lg ${isLoaded ? "opacity-100" : "opacity-0"}`}
        style={{
          objectPosition: src.metadata?.hotspot
            ? `${src.metadata.hotspot.x}% ${src.metadata.hotspot.y}%`
            : "",
          transition: "opacity 0.2s ease-in-out",
        }}
      />
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
