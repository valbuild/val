import {
  FileMetadata,
  ImageMetadata,
  FILE_REF_PROP,
  VAL_EXTENSION,
  ConfigDirectory,
  Internal,
  SourcePath,
  FILE_REF_SUBTYPE_TAG,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { FieldLoading } from "../FieldLoading";
import { FieldNotFound } from "../FieldNotFound";
import { FieldSchemaError } from "../FieldSchemaError";
import { FieldSchemaMismatchError } from "../FieldSchemaMismatchError";
import { FieldSourceError } from "../FieldSourceError";
import { ValidationErrors } from "../ValidationError";
import {
  useValConfig,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
} from "../ValProvider";
import { PreviewLoading, PreviewNull } from "../Preview";
import { File, SquareArrowOutUpRight } from "lucide-react";
import { readFile } from "../../utils/readFile";
import { Button } from "../designSystem/button";

export function createFilePatch(
  path: string[],
  data: string | null,
  filename: string | null,
  sha256: string,
  metadata: FileMetadata | ImageMetadata | undefined,
  subType: "image" | "file",
  directory: ConfigDirectory = "/public/val",
): Patch {
  const newFilePath = Internal.createFilename(data, filename, metadata, sha256);
  if (!newFilePath || !metadata) {
    return [];
  }
  return [
    {
      value: {
        [FILE_REF_PROP]: `${directory}/${newFilePath}`,
        [VAL_EXTENSION]: "file",
        ...(subType !== "file" ? { [FILE_REF_SUBTYPE_TAG]: subType } : {}),
        metadata,
      },
      op: "replace",
      path,
    },
    {
      value: data,
      op: "file",
      path,
      filePath: `${directory}/${newFilePath}`,
    },
  ];
}

export function FileField({ path }: { path: SourcePath }) {
  const type = "file";
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
  return (
    <div>
      <ValidationErrors path={path} />
      <div className="flex items-center gap-4">
        <Button
          asChild
          variant={"ghost"}
          className="cursor-pointer bg-bg-primary hover:bg-bg-secondary_alt"
        >
          <label htmlFor={`img_input:${path}`}>Update</label>
        </Button>
        {source && (
          <a
            className="flex items-center gap-2"
            href={
              Internal.convertFileSource({
                ...source,
                _type: "file",
              }).url
            }
          >
            {" "}
            <span> Open file</span>
            <SquareArrowOutUpRight />
          </a>
        )}
        <input
          disabled={sourceAtPath.status === "loading"}
          hidden
          id={`img_input:${path}`}
          type="file"
          accept={schemaAtPath.data.options?.accept}
          onChange={(ev) => {
            readFile(ev).then((res) => {
              const data = { src: res.src, filename: res.filename };
              let metadata: FileMetadata | undefined;
              if (res.mimeType) {
                metadata = {
                  mimeType: res.mimeType,
                };
              }
              addPatch(
                createFilePatch(
                  patchPath,
                  data.src,
                  data.filename ?? null,
                  res.sha256,
                  metadata,
                  "file",
                  config.files?.directory,
                ),
              );
            });
          }}
        />
      </div>
    </div>
  );
}

export function FilePreview({ path }: { path: SourcePath }) {
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
  return <File size={12} />;
}
