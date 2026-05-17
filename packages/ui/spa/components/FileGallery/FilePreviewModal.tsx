import { Dialog, DialogContent, DialogTitle } from "../designSystem/dialog";
import type { GalleryFile } from "./types";

interface FilePreviewModalProps {
  file: GalleryFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getMimeCategory(mimeType: string): string {
  const [category] = mimeType.split("/");
  return category;
}

export function FilePreviewModal({
  file,
  open,
  onOpenChange,
}: FilePreviewModalProps) {
  if (!file) return null;

  const category = getMimeCategory(file.metadata.mimeType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-[90vw] overflow-hidden p-0">
        <DialogTitle className="sr-only">{file.filename}</DialogTitle>
        <div className="relative flex items-center justify-center bg-black">
          {category === "image" && (
            <div className="relative inline-flex">
              <img
                src={file.url}
                alt={file.filename}
                className="max-h-[85vh] max-w-full object-contain"
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
                      width: "20px",
                      height: "20px",
                      borderRadius: "50%",
                      border: "2px solid white",
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
                      width: "4px",
                      height: "4px",
                      borderRadius: "50%",
                      backgroundColor: "white",
                      boxShadow: "0 0 2px rgba(0,0,0,0.5)",
                    }}
                  />
                </div>
              )}
            </div>
          )}
          {category === "video" && (
            <video
              src={file.url}
              controls
              autoPlay
              className="max-h-[85vh] max-w-full"
            >
              <track kind="captions" />
            </video>
          )}
          {category === "audio" && (
            <div className="flex flex-col items-center gap-4 p-8">
              <p className="text-lg font-medium text-white">{file.filename}</p>
              <audio
                src={file.url}
                controls
                autoPlay
                className="w-full max-w-md"
              >
                <track kind="captions" />
              </audio>
            </div>
          )}
          {category !== "image" &&
            category !== "video" &&
            category !== "audio" && (
              <div className="flex flex-col items-center gap-4 p-8">
                <p className="text-lg font-medium text-white">
                  {file.filename}
                </p>
                <p className="text-sm text-gray-400">
                  Preview not available for this file type
                </p>
              </div>
            )}
        </div>
        <div className="border-t border-border-secondary bg-bg-primary p-3">
          <p className="text-sm font-medium text-fg-primary">{file.filename}</p>
          <p className="text-xs text-fg-secondary">
            {file.folder} • {file.metadata.mimeType}
            {file.metadata.width > 0 &&
              ` • ${file.metadata.width}×${file.metadata.height}px`}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
