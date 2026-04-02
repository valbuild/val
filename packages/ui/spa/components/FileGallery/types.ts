export interface FileMetadata {
  width: number;
  height: number;
  mimeType: string;
  alt?: string;
}

export interface GalleryFile {
  ref: string;
  url: string;
  filename: string;
  folder: string;
  metadata: FileMetadata;
  createdAt?: Date;
  validationErrors?: string[];
  fieldSpecificErrors?: {
    alt?: string[];
  };
}

export type ViewMode = "masonry" | "grid" | "list";

export type SortField = "name" | "description" | "type";
export type SortDirection = "asc" | "desc";

export interface FileGalleryProps {
  files: GalleryFile[];
  parentPath?: string;
  onFileRename?: (index: number, newFilename: string) => void;
  onAltTextChange?: (index: number, newAltText: string) => void;
  onFileDelete?: (index: number) => void;
  className?: string;
  defaultViewMode?: ViewMode;
  showSearch?: boolean;
  imageMode?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onUploadClick?: () => void;
  uploading?: boolean;
  defaultOpenFileRef?: string;
}
