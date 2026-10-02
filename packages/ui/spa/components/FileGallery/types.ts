import type { SourcePath } from "@valbuild/core";
import type { PendingPatch, Profile } from "../ValProvider";

export interface FileMetadata {
  width: number;
  height: number;
  mimeType: string;
  alt?: string;
  hotspot?: { x: number; y: number };
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
  patchesByAuthorIds?: Record<string, PendingPatch[]>;
  profilesByAuthorIds?: Record<string, Profile>;
  sourcePath?: SourcePath;
}

export type ViewMode = "masonry" | "grid" | "list";

export type SortField = "name" | "description" | "type";
export type SortDirection = "asc" | "desc";

/**
 * How a rename went. `newRef` is the file's ref afterwards, which the gallery
 * needs to keep the renamed file open: the old ref no longer exists.
 */
export type FileRenameResult =
  | { status: "ok"; newRef: string }
  /** Renamed, with something left to report — the file is at `newRef`. */
  | { status: "partial"; newRef: string; message: string }
  | { status: "unchanged" }
  | { status: "error"; message: string };

export interface FileGalleryProps {
  files: GalleryFile[];
  parentPath?: string;
  /**
   * `newBase` is the part the editor typed, handed over on its own: the
   * filename is base + locked suffix, and re-splitting it is ambiguous for a
   * file with no extension, whose base can contain a dot.
   */
  onFileRename?: (
    index: number,
    newFilename: string,
    newBase: string,
  ) => void | Promise<FileRenameResult>;
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
  /**
   * The upload control cannot succeed yet, so it is not offered.
   *
   * Distinct from `uploading` (a request is in flight) and from `disabled` (the
   * whole gallery is inert): this is specifically "the preconditions for an
   * upload are not in place", which today means a remote gallery still waiting
   * on `/remote/settings`.
   */
  uploadDisabled?: boolean;
  defaultOpenFileRef?: string;
  isDraggingOver?: boolean;
}
