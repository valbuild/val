import {
  FileMetadata,
  ImageMetadata,
  FILE_REF_PROP,
  VAL_EXTENSION,
  ConfigDirectory,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { createFilename } from "../../utils/readImage";

export function createFilePatch(
  path: string[],
  data: string | null,
  filename: string | null,
  metadata: FileMetadata | ImageMetadata | undefined,
  directory: ConfigDirectory = "/public/val",
): Patch {
  const newFilePath = createFilename(data, filename, metadata);
  if (!newFilePath || !metadata) {
    return [];
  }
  return [
    {
      value: {
        [FILE_REF_PROP]: `${directory}/${newFilePath}`,
        [VAL_EXTENSION]: "file",
        metadata,
      },
      op: "replace",
      path,
    },
    {
      value: data,
      op: "file",
      path,
      filePath: `${directory}/${newFilePath}`,
    },
  ];
}
