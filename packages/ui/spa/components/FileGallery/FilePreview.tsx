import { File, FileAudio, FileText, FileVideo } from "lucide-react";
import { cn } from "../designSystem/cn";
import type { GalleryFile } from "./types";
import { MediaThumbnail } from "../MediaThumbnail";
import { Internal } from "@valbuild/core";

interface FilePreviewProps {
  file: GalleryFile;
  className?: string;
}

function getMimeCategory(mimeType: string): string {
  const [category] = mimeType.split("/");
  return category;
}

export function FilePreview({ file, className }: FilePreviewProps) {
  const category = getMimeCategory(file.metadata.mimeType);

  if (category === "image") {
    return (
      <MediaThumbnail
        url={file.url}
        alt={file.metadata.alt || file.filename}
        hotspot={file.metadata.hotspot}
        className={className}
      />
    );
  }

  if (file.metadata.mimeType === Internal.media.HLS_MIME_TYPE) {
    // A stream's preview is not loaded: a frame of it means hls.js and a
    // segment per row, which a list of thumbnails should not cost.
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-1 bg-bg-secondary",
          className,
        )}
      >
        <FileVideo className="h-8 w-8 text-fg-secondary" />
        <span className="text-[0.625rem] font-medium uppercase tracking-wide text-fg-secondary-alt">
          HLS
        </span>
      </div>
    );
  }

  if (category === "video") {
    return (
      <div className={cn("relative h-full w-full bg-bg-secondary", className)}>
        <video
          src={file.url}
          className="h-full w-full object-cover"
          muted
          preload="metadata"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <FileVideo className="h-8 w-8 text-white" />
        </div>
      </div>
    );
  }

  if (category === "audio") {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-bg-secondary",
          className,
        )}
      >
        <FileAudio className="h-12 w-12 text-fg-secondary" />
      </div>
    );
  }

  if (category === "text" || file.metadata.mimeType === "application/json") {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-bg-secondary",
          className,
        )}
      >
        <FileText className="h-12 w-12 text-fg-secondary" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-bg-secondary",
        className,
      )}
    >
      <File className="h-12 w-12 text-fg-secondary" />
    </div>
  );
}
