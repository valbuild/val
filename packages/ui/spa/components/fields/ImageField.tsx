import { ImageMetadata, Internal, SourcePath } from "@valbuild/core";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
  useValConfig,
} from "../ValProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { readImage } from "../../utils/readImage";
import { createFilePatch } from "./FileField";
import { ValidationErrors } from "../../components/ValidationError";
import classNames from "classnames";
import { useEffect, useState } from "react";
import { Input } from "../designSystem/input";

export function ImageField({ path }: { path: SourcePath }) {
  const type = "image";
  const config = useValConfig();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addPatch } = useAddPatch(path);
  const [hotspot, setHotspot] = useState<{ y: number; x: number } | undefined>(
    undefined,
  );
  useEffect(() => {
    if ("data" in sourceAtPath && sourceAtPath.data) {
      if (sourceAtPath.data.metadata) {
        const metadata = sourceAtPath.data.metadata;
        if (
          typeof metadata.width !== "number" ||
          typeof metadata.height !== "number"
        ) {
          console.warn(
            `Expected metadata width and height to be numbers but width was: ${typeof metadata.width} and height was: ${typeof metadata.height}`,
          );
          return;
        }
        if ("hotspot" in metadata) {
          if (
            typeof metadata.hotspot === "object" &&
            metadata.hotspot &&
            "x" in metadata.hotspot &&
            "y" in metadata.hotspot
          ) {
            const { x, y } = metadata.hotspot;
            if (typeof x === "number" && typeof y === "number") {
              setHotspot({
                x,
                y,
              });
            } else {
              console.warn(
                `Expected hotspot to have x and y as numbers but x was: ${typeof x} and y: ${typeof y}`,
              );
            }
          }
        } else {
          setHotspot(undefined);
        }
      } else {
        setHotspot(undefined);
      }
    }
  }, ["data" in sourceAtPath && sourceAtPath.data]);
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
      {source && (
        <div className="py-2">
          <span>Alt text</span>
          <Input
            value={
              source.metadata?.alt
                ? typeof source.metadata?.alt === "string"
                  ? source.metadata?.alt
                  : ""
                : ""
            }
            onChange={(ev) => {
              const alt = ev.target.value;
              if (source.metadata && "alt" in source.metadata) {
                addPatch([
                  {
                    op: "replace",
                    value: alt,
                    path: patchPath.concat(["metadata", "alt"]),
                  },
                ]);
              } else if (source.metadata && !("alt" in source.metadata)) {
                addPatch([
                  {
                    op: "add",
                    value: alt,
                    path: patchPath.concat(["metadata", "alt"]),
                  },
                ]);
              } else if (source.metadata === undefined) {
                addPatch([
                  {
                    op: "add",
                    value: {
                      ...(hotspot ? { hotspot } : {}),
                      alt: alt,
                    },
                    path: patchPath.concat(["metadata"]),
                  },
                ]);
              } else {
                console.warn(
                  `Expected source.metadata to be an object but got ${typeof source.metadata}`,
                );
              }
            }}
          />
        </div>
      )}
      {source && (
        <div className="relative">
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
            onClick={(ev) => {
              const { width, height, left, top } =
                ev.currentTarget.getBoundingClientRect();
              const hotspot = {
                x: Math.max((ev.clientX - 6 - left) / width, 0),
                y: Math.max((ev.clientY - 6 - top) / height, 0),
              };
              if (source.metadata && "hotspot" in source.metadata) {
                addPatch([
                  {
                    op: "replace",
                    path: patchPath.concat(["metadata", "hotspot"]),
                    value: hotspot,
                  },
                ]);
              } else if (source.metadata) {
                addPatch([
                  {
                    op: "add",
                    path: patchPath.concat(["metadata", "hotspot"]),
                    value: hotspot,
                  },
                ]);
              } else if (source.metadata === undefined) {
                addPatch([
                  {
                    op: "add",
                    value: {
                      ...(hotspot ? { hotspot } : {}),
                    },
                    path: patchPath.concat(["metadata"]),
                  },
                ]);
              } else {
                console.warn(
                  `Expected source.metadata to be an object but got ${typeof source.metadata}`,
                );
              }
            }}
          />
          {hotspot && (
            <div
              className="rounded-full h-[12px] w-[12px] bg-background mix-blend-difference border-bg-brand-solid border-2 absolute pointer-events-none"
              style={{
                top: `${hotspot.y * 100}%`,
                left: `${hotspot.x * 100}%`,
              }}
            />
          )}
        </div>
      )}
      <div>
        <label
          htmlFor={`img_input:${path}`}
          className={classNames(
            "block px-1 py-2 mt-4 text-sm text-center rounded-lg cursor-pointer bg-bg-primary text-text-secondary",
          )}
        >
          Update
        </label>
      </div>
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
                res.sha256,
                metadata,
                "image",
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
    />
  );
}
