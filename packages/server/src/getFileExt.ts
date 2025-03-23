export function getFileExt(filePath: string) {
  // NOTE: We do not import the path module. This code is copied in different projects. We want the same implementation and which means that this might running in browser where path is not available).
  return filePath.split(".").pop() || "";
}
