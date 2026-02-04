export interface FileMetadata {
  width: number;
  height: number;
  mimeType: string;
}

export interface GalleryFile {
  url: string;
  filename: string;
  folder: string;
  metadata: FileMetadata;
}

export interface FileGalleryProps {
  files: GalleryFile[];
  onFileRename?: (index: number, newFilename: string) => void;
  className?: string;
}
