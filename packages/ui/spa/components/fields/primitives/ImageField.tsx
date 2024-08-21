import {
  ImageSource,
  ImageMetadata,
  Internal,
  FileMetadata,
} from "@valbuild/core";
import { useState, useEffect } from "react";
import { readImage } from "../../../utils/readImage";
import { OnSubmit, SubmitStatus } from "../../SubmitStatus";
import { createFilePatch } from "./FileField";
import { Patch } from "@valbuild/core/patch";
import { FieldContainer } from "../FieldContainer";

export function ImageField({
  path,
  defaultValue,
  onSubmit,
}: {
  path: string;
  onSubmit?: OnSubmit;
  defaultValue?: ImageSource;
}) {
  const [data, setData] = useState<string>();
  const [metadata, setMetadata] = useState<ImageMetadata>();
  const [loading, setLoading] = useState(false);
  const [hotspot, setHotspot] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(
      defaultValue &&
        "/api/val/files/public" + Internal.convertFileSource(defaultValue).url
    );
    setHotspot(defaultValue?.metadata?.hotspot);
  }, [defaultValue]);

  return (
    <FieldContainer>
      <div className="pr-6 w-fit">
        <div
          className="flex flex-col justify-start p-2 border border-b-0 rounded-sm rounded-b-none gap-y-4 bg-background text-foreground border-input"
          key={path}
        >
          {data || url ? (
            <div className="relative">
              {hotspot && (
                <div
                  className="rounded-full h-[12px] w-[12px] bg-background mix-blend-difference border-accent border-2 absolute pointer-events-none"
                  style={{
                    top: `${hotspot.y * 100}%`,
                    left: `${hotspot.x * 100}%`,
                  }}
                />
              )}
              <img
                src={data || url}
                draggable={false}
                className="object-contain w-full max-h-[500px]"
                style={{
                  cursor: "crosshair",
                }}
                onClick={(ev) => {
                  // compute hotspot position based on mouse click:
                  const { width, height, left, top } =
                    ev.currentTarget.getBoundingClientRect();
                  const hotspotX = (ev.clientX - 6 - left) / width;
                  const hotspotY = (ev.clientY - 6 - top) / height;
                  setHotspot({
                    x: hotspotX,
                    y: hotspotY,
                    width: 1,
                    height: 1,
                  });
                  if (onSubmit) {
                    setLoading(true);
                    onSubmit(async (path) => {
                      if (metadata) {
                        return createFileMetadataPatch(path, {
                          ...metadata,
                          hotspot: {
                            x: hotspotX,
                            y: hotspotY,
                            width: 1,
                            height: 1,
                          },
                        });
                      } else if (defaultValue) {
                        return createFileMetadataPatch(path, {
                          ...defaultValue.metadata,
                          hotspot: {
                            x: hotspotX,
                            y: hotspotY,
                            width: 1,
                            height: 1,
                          },
                        });
                      } else {
                        throw new Error("No metadata to update");
                      }
                    }).finally(() => {
                      setLoading(false);
                    });
                  }
                }}
              />
            </div>
          ) : (
            <div>Select image below</div>
          )}
        </div>
        <div className="relative p-4 border border-t-0 rounded-b-sm bg-background border-input">
          <label
            htmlFor={`img_input:${path}`}
            className="block px-1 py-2 text-sm text-center rounded-md cursor-pointer bg-primary text-background"
          >
            Update
          </label>
          <div className="absolute top-6 right-6 text-background">
            <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
          </div>
          <input
            hidden
            disabled={loading}
            id={`img_input:${path}`}
            type="file"
            accept="image/*"
            onChange={(ev) => {
              if (onSubmit) {
                readImage(ev)
                  .then((res) => {
                    const data = { src: res.src, filename: res.filename };
                    setData(res.src);
                    setHotspot(undefined);
                    let metadata: ImageMetadata | undefined;
                    if (res.width && res.height && res.mimeType) {
                      metadata = {
                        sha256: res.sha256,
                        width: res.width,
                        height: res.height,
                        mimeType: res.mimeType,
                      };
                      setMetadata(metadata);
                    }
                    setLoading(true);
                    onSubmit((path) =>
                      Promise.resolve(
                        createFilePatch(
                          path,
                          data.src,
                          data.filename ?? null,
                          metadata
                        )
                      )
                    ).finally(() => {
                      setLoading(false);
                    });
                  })
                  .catch((err) => {
                    console.error(err.message);
                  });
              }
            }}
          />
        </div>
      </div>
    </FieldContainer>
  );
}

function createFileMetadataPatch(
  path: string[],
  metadata: Partial<ImageMetadata | FileMetadata>
): Patch {
  const metadataPath = path.concat("metadata");
  return [
    {
      value: metadata,
      op: "replace",
      path: metadataPath,
    },
  ];
}
