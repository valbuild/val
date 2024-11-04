import { ImageMetadata, Internal, SourcePath } from "@valbuild/core";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { FieldSourceError } from "../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useValConfig,
} from "../ValProvider";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../components/Preview";
import { readImage } from "../../utils/readImage";
import { createFilePatch } from "./FileField";
import { ValidationErrors } from "../components/ValidationError";

export function ImageField({ path }: { path: SourcePath }) {
  const type = "image";
  const config = useValConfig();
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
  if (config === undefined) {
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
  if (source === undefined) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (source === null) {
    // TODO: what to do here?
    return null;
  }
  return (
    <div>
      <ValidationErrors path={path} />
      <img
        src={
          Internal.convertFileSource({
            ...source,
            _type: "file",
          }).url
        }
        draggable={false}
        className="object-contain w-full max-h-[500px] rounded-t-lg"
        style={{
          cursor: "crosshair",
        }}
      />
      <label
        htmlFor={`img_input:${path}`}
        className="block px-1 py-2 text-sm text-center rounded-b-lg cursor-pointer bg-bg-secondary text-text-secondary"
      >
        Update
      </label>
      <input
        disabled={sourceAtPath.status === "loading"}
        hidden
        id={`img_input:${path}`}
        type="file"
        accept={schemaAtPath.data.options?.accept || "image/*"}
        onChange={(ev) => {
          readImage(ev).then((res) => {
            const data = { src: res.src, filename: res.filename };
            let metadata: ImageMetadata | undefined;
            if (res.width && res.height && res.mimeType) {
              metadata = {
                sha256: res.sha256,
                width: res.width,
                height: res.height,
                mimeType: res.mimeType,
              };
            }
            addPatch(
              createFilePatch(
                patchPath,
                data.src,
                data.filename ?? null,
                metadata,
                config.files?.directory,
              ),
            );
          });
        }}
      />
    </div>
  );
}

export function ImagePreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "image");
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type="image" />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  const source = sourceAtPath.data;
  return (
    <img
      src={
        Internal.convertFileSource({
          ...source,
          _type: "file",
        }).url
      }
      draggable={false}
      className="object-contain max-w-[60px] max-h-[60px] rounded-lg"
      style={{
        cursor: "crosshair",
      }}
    />
  );
}
