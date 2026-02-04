import * as React from "react";
import { FolderOpen } from "lucide-react";
import { cn } from "../designSystem/cn";
import { FileGalleryItem } from "./FileGalleryItem";
import { FileProperties } from "./FileProperties";
import { FilePreviewModal } from "./FilePreviewModal";
import type { FileGalleryProps, GalleryFile } from "./types";

export function FileGallery({
  files,
  onFileRename,
  className,
}: FileGalleryProps) {
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const [previewFile, setPreviewFile] = React.useState<GalleryFile | null>(
    null,
  );

  const selectedFile =
    selectedIndex !== null ? (files[selectedIndex] ?? null) : null;

  const handleItemClick = (index: number) => {
    setSelectedIndex(selectedIndex === index ? null : index);
  };

  const handleItemDoubleClick = (file: GalleryFile) => {
    setPreviewFile(file);
  };

  if (files.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border-secondary bg-bg-secondary p-12",
          className,
        )}
      >
        <FolderOpen className="h-16 w-16 text-fg-secondary" />
        <div className="text-center">
          <p className="text-lg font-medium text-fg-primary">No files</p>
          <p className="text-sm text-fg-secondary">
            There are no files to display
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-4", className)}>
      <div className="flex-1">
        <div className="columns-3 gap-2 sm:columns-4 md:columns-5 lg:columns-6 xl:columns-8">
          {files.map((file, index) => (
            <FileGalleryItem
              key={`${file.folder}/${file.filename}`}
              file={file}
              isSelected={selectedIndex === index}
              onClick={() => handleItemClick(index)}
              onDoubleClick={() => handleItemDoubleClick(file)}
            />
          ))}
        </div>
      </div>

      {selectedFile && (
        <div className="w-64 shrink-0">
          <FileProperties
            file={selectedFile}
            fileIndex={selectedIndex!}
            onFileRename={onFileRename}
          />
        </div>
      )}

      <FilePreviewModal
        file={previewFile}
        open={previewFile !== null}
        onOpenChange={(open) => !open && setPreviewFile(null)}
      />
    </div>
  );
}
