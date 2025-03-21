export function getFileExt(filePath: string) {
  // We can't use path (running in browser)
  return filePath.split(".").pop() || "";
}
