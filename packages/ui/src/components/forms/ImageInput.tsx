import { useEffect, useState } from "react";
import { UploadCloud } from "react-feather";
import { ErrorText } from "../ErrorText";

type Error = "invalid-file" | "file-too-large";
type ImageSource = {
  src: string;
  metadata?: { width: number; height: number };
} | null;
export type ImageInputProps = {
  name: string;
  source: ImageSource;
  maxSize?: number;
  error: Error | null;
  onChange: (
    result: { error: null; value: ImageSource } | { error: Error; value: null }
  ) => void;
};

export function ImageInput({
  name,
  source,
  maxSize,
  error,
  onChange,
}: ImageInputProps) {
  const [currentSource, setCurrentSource] = useState<ImageSource>(null);
  useEffect(() => {
    setCurrentSource(source);
  }, [source]);
  const [currentError, setCurrentError] = useState<Error | null>(null);
  useEffect(() => {
    setCurrentError(error);
  }, [source]);

  return (
    <div className="w-full py-2 max-w-[90vw] object-contain">
      <label htmlFor={name}>
        <div className="flex items-center justify-center w-full h-full min-h-[200px] cursor-pointer">
          {currentSource !== null && (
            <img
              className="object-contain max-h-[300px]"
              src={currentSource.src}
            />
          )}
          {!currentSource?.src && (
            <UploadCloud size={24} className="text-primary" />
          )}
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
                  setCurrentSource(nextSource);
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
      {currentSource?.metadata && (
        <div className="ml-auto text-primary">
          Dimensions: {currentSource.metadata.width}x
          {currentSource.metadata.height}
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
