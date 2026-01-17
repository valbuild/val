import {
  ImageMetadata,
  ImageSource,
  Internal,
  ListRecordRender as ListRecordRender,
  RemoteSource,
  SourcePath,
  VAL_EXTENSION,
} from "@valbuild/core";
import {
  useAllValidationErrors,
  useRenderOverrideAtPath,
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
}: ListRecordRender["items"][number][1]) {
  return (
    <div
      className={classNames(
        "flex w-full items-start justify-between pl-4 flex-grow text-left",
      )}
    >
      <div className="flex flex-col flex-shrink py-4 overflow-x-clip">
        <div className="font-medium">{title}</div>
        {subtitle && (
          <div className="block overflow-hidden flex-shrink max-h-5 text-sm text-gray-500 text-ellipsis">
            {subtitle}
          </div>
        )}
      </div>
      {image && <ImageOrPlaceholder src={image} alt={title} />}
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
      {items.map(([key, { title, subtitle, image }]) => (
        <button
          key={key}
          onClick={() => navigate(sourcePathOfItem(path, key))}
          className={classNames(
            "hover:bg-bg-secondary-hover",
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
  src: ImageSource | RemoteSource<ImageMetadata> | null | undefined;
  alt: string;
}) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (src === null || src === undefined) {
    return (
      <div className="flex-shrink-0 ml-4 w-20 h-20 opacity-25 bg-bg-brand-secondary"></div>
    );
  }

  const imageUrl =
    src[VAL_EXTENSION] === "file"
      ? Internal.convertFileSource(src).url
      : Internal.convertRemoteSource(src).url;

  return (
    <div className="relative flex-shrink-0 ml-4 w-20 h-20">
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
