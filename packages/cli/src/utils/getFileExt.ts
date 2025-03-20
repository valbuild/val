import path from "path";

export function getFileExt(filePath: string) {
  return path.extname(filePath).slice(1);
}
