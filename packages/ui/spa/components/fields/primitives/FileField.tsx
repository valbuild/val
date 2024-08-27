import {
  FileMetadata,
  ImageMetadata,
  FILE_REF_PROP,
  VAL_EXTENSION,
  Internal,
  ImageSource,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { getMimeType, mimeTypeToFileExt } from "@valbuild/shared/internal";
import { File } from "lucide-react";
import { ChangeEvent, useState, useEffect } from "react";
import { createFilename } from "../../../utils/readImage";
import { OnSubmit, SubmitStatus } from "../SubmitStatus";
import { FieldContainer } from "../FieldContainer";
import { FileOptions } from "@valbuild/core/src/schema/file";

export function createFilePatch(
  path: string[],
  data: string | null,
  filename: string | null,
  metadata: FileMetadata | ImageMetadata | undefined
): Patch {
  const newFilePath = createFilename(data, filename, metadata);
  if (!newFilePath || !metadata) {
    return [];
  }
  return [
    {
      value: {
        [FILE_REF_PROP]: `/public/${newFilePath}`,
        [VAL_EXTENSION]: "file",
        metadata,
      },
      op: "replace",
      path,
    },
    {
      value: data,
      op: "file",
      path,
      filePath: `/public/${newFilePath}`,
    },
  ];
}

const textEncoder = new TextEncoder();

export function readFile(ev: ChangeEvent<HTMLInputElement>) {
  return new Promise<{
    src: string;
    sha256: string;
    mimeType?: string;
    fileExt?: string;
    filename?: string;
  }>((resolve, reject) => {
    const file = ev.currentTarget.files?.[0];
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string") {
        const sha256 = Internal.getSHA256Hash(textEncoder.encode(result));
        const mimeType = getMimeType(result);
        resolve({
          src: result,
          filename: file?.name,
          sha256,
          mimeType,
          fileExt: mimeType && mimeTypeToFileExt(mimeType),
        });
      } else if (!result) {
        reject({ message: "Empty result" });
      } else {
        reject({ message: "Unexpected file result type", result });
      }
    });
    if (file) {
      reader.readAsDataURL(file);
    }
  });
}

export function FileField({
  path,
  defaultValue,
  onSubmit,
  schemaOptions,
}: {
  path: string;
  onSubmit?: OnSubmit;
  defaultValue?: ImageSource;
  schemaOptions?: FileOptions;
}) {
  const [data, setData] = useState<{ filename?: string; src: string } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const url = defaultValue && Internal.convertFileSource(defaultValue).url;
    setUrl(url);
  }, [defaultValue]);
  return (
    <FieldContainer>
      <div className="w-fit">
        <div
          className="flex flex-col justify-start p-2 border border-b-0 rounded-sm rounded-b-none gap-y-4 bg-background text-foreground border-input"
          key={path}
        >
          {data || url ? (
            <div className="relative flex flex-col justify-center items-center min-h-[100px] min-w-[200px]">
              <div>
                <File />
              </div>
              <div>{data?.filename}</div>
            </div>
          ) : (
            <div>Select file below</div>
          )}
        </div>
        <div className="p-4 border border-t-0 rounded-b-sm bg-background border-input">
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
            accept={schemaOptions?.accept || "*"}
            type="file"
            onChange={(ev) => {
              if (onSubmit) {
                readFile(ev)
                  .then((res) => {
                    const data = { src: res.src, filename: res.filename };
                    setData(data);
                    let metadata: FileMetadata | undefined;
                    if (res.mimeType) {
                      metadata = {
                        sha256: res.sha256,
                        mimeType: res.mimeType,
                      };
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
                    setData(null);
                  });
              }
            }}
          />
        </div>
      </div>
    </FieldContainer>
  );
}
