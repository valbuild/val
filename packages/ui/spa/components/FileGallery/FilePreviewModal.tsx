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
            <img
              src={file.url}
              alt={file.filename}
              className="max-h-[85vh] max-w-full object-contain"
            />
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
