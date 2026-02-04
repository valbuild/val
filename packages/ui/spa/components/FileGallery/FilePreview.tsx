import { File, FileAudio, FileText, FileVideo } from "lucide-react";
import { cn } from "../designSystem/cn";
import type { GalleryFile } from "./types";

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
      <img
        src={file.url}
        alt={file.filename}
        className={cn("h-full w-full object-cover", className)}
      />
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
