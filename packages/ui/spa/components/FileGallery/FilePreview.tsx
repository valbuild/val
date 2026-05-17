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
      <div className={cn("relative h-full w-full", className)}>
        <img
          src={file.url}
          alt={file.metadata.alt || file.filename}
          className="h-full w-full object-cover"
          style={
            file.metadata.hotspot
              ? {
                  objectPosition: `${file.metadata.hotspot.x * 100}% ${file.metadata.hotspot.y * 100}%`,
                }
              : undefined
          }
        />
        {file.metadata.hotspot && (
          <div
            className="absolute pointer-events-none"
            style={{
              top: `${file.metadata.hotspot.y * 100}%`,
              left: `${file.metadata.hotspot.x * 100}%`,
              transform: "translate(-50%, -50%)",
              zIndex: 10,
            }}
          >
            <div
              style={{
                width: "14px",
                height: "14px",
                borderRadius: "50%",
                border: "1.5px solid white",
                boxShadow:
                  "0 0 0 1px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(0,0,0,0.3)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "3px",
                height: "3px",
                borderRadius: "50%",
                backgroundColor: "white",
                boxShadow: "0 0 2px rgba(0,0,0,0.5)",
              }}
            />
          </div>
        )}
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
