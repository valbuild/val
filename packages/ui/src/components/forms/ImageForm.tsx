import { useEffect, useState } from "react";
import { UploadCloud } from "react-feather";
import { ErrorText } from "../ErrorText";

type Error = "invalid-file" | "file-too-large";
export type ImageData =
  | {
      src: string;
      metadata?: { width: number; height: number; sha256: string };
    }
  | {
      url: string;
      metadata?: { width: number; height: number; sha256: string };
    }
  | null;
export type ImageInputProps = {
  name: string;
  data: ImageData;
  maxSize?: number;
  error: Error | null;
  onChange: (
    result: { error: null; value: ImageData } | { error: Error; value: null }
  ) => void;
};

export function ImageForm({
  name,
  data: data,
  maxSize,
  error,
  onChange,
}: ImageInputProps) {
  const [currentData, setCurrentData] = useState<ImageData>(null);
  useEffect(() => {
    setCurrentData(data);
  }, [data]);
  const [currentError, setCurrentError] = useState<Error | null>(null);
  useEffect(() => {
    setCurrentError(error);
  }, [data]);

  // TODO: we should update the Input type - we should never have a url here?
  const src =
    (currentData &&
      (("src" in currentData && currentData.src) ||
        ("url" in currentData && currentData.url))) ||
    undefined;

  return (
    <div className="w-full py-2 max-w-[90vw] object-contain">
      <label htmlFor={name}>
        <div className="flex items-center justify-center w-full h-full min-h-[200px] cursor-pointer">
          {currentData !== null && (
            <img className="object-contain max-h-[300px]" src={src} />
          )}
          {!src && <UploadCloud size={24} className="text-primary" />}
        </div>
        <input
          hidden
          type="file"
          id={name}
          name={name}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              if (maxSize && file.size > maxSize) {
                onChange({ error: "file-too-large", value: null });
                return;
              }
              const reader = new FileReader();
              reader.addEventListener("load", () => {
                const result = reader.result;
                if (typeof result === "string") {
                  const image = new Image();
                  image.src = result;
                  const nextSource = {
                    src: result,
                    metadata: {
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    },
                  };
                  setCurrentData(nextSource);
                  setCurrentError(null);
                  onChange({
                    error: null,
                    value: nextSource,
                  });
                } else {
                  onChange({ error: "invalid-file", value: null });
                }
              });
              reader.readAsDataURL(file);
            }
          }}
        />
      </label>
      {currentData?.metadata && (
        <div className="ml-auto text-primary">
          Dimensions: {currentData.metadata.width}x{currentData.metadata.height}
        </div>
      )}
      {currentError && <ImageError error={currentError} />}
    </div>
  );
}

function ImageError({ error }: { error: Error }): React.ReactElement | null {
  if (error === "invalid-file") {
    return <ErrorText>Invalid file</ErrorText>;
  } else if (error === "file-too-large") {
    return <ErrorText>File is too large</ErrorText>;
  }
  return null;
}
