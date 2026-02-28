export interface FileMetadata {
  width: number;
  height: number;
  mimeType: string;
  alt?: string;
}

export interface GalleryFile {
  url: string;
  filename: string;
  folder: string;
  metadata: FileMetadata;
  createdAt?: Date;
  validationErrors?: string[];
}

export type ViewMode = "masonry" | "grid" | "list";

export type SortField = "name" | "type";
export type SortDirection = "asc" | "desc";

export interface FileGalleryProps {
  files: GalleryFile[];
  onFileRename?: (index: number, newFilename: string) => void;
  onAltTextChange?: (index: number, newAltText: string) => void;
  className?: string;
  defaultViewMode?: ViewMode;
  showSearch?: boolean;
  imageMode?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onUploadClick?: () => void;
  uploading?: boolean;
}
