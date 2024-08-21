import {
  JsonObject,
  FileSource,
  ImageMetadata,
  FILE_REF_PROP,
  Internal,
} from "@valbuild/core";
import React, { useState } from "react";
import { createPortal } from "react-dom";

export function ValImagePreview({ source }: { source: JsonObject }) {
  const [isMouseOver, setIsMouseOver] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const hoverElem = useValImagePreviewContext()?.hoverElem;
  const fileSource = source as FileSource<ImageMetadata>;
  if (
    source[FILE_REF_PROP] === undefined ||
    typeof source[FILE_REF_PROP] !== "string"
  ) {
    console.warn("Invalid image source (cannot display preview)", source);
    return null;
  }
  const url = Internal.convertFileSource(fileSource).url;
  if (typeof url !== "string" || !url.startsWith("/")) {
    console.warn("Invalid image url (cannot display preview)", url);
    return null;
  }
  return (
    <span
      onMouseOver={(ev) => {
        setIsMouseOver({
          x: ev.clientX,
          y: ev.clientY,
        });
      }}
      onMouseLeave={() => {
        setIsMouseOver(null);
      }}
      className="relative flex items-center justify-start gap-1"
    >
      <a href={url} className="overflow-hidden underline truncate ">
        {fileSource[FILE_REF_PROP]}
      </a>
      {isMouseOver &&
        hoverElem &&
        createPortal(
          <img
            className="absolute z-[5] max-w-[10vw]"
            style={{
              left: isMouseOver.x + 10,
              top: isMouseOver.y + 10,
            }}
            src={url}
          ></img>,
          hoverElem
        )}
    </span>
  );
}

export const ValImagePreviewContext = React.createContext<{
  hoverElem: HTMLElement | null;
}>({
  hoverElem: null,
});

export const useValImagePreviewContext = ():
  | {
      hoverElem: HTMLElement | null;
    }
  | undefined => {
  return React.useContext(ValImagePreviewContext);
};
