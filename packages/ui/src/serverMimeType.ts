export function getServerMimeType(path: string) {
  const parts = path.split(".");
  let ext;
  if (parts.length > 1) {
    ext = parts.pop();
  }
  if (ext === "css") {
    return "text/css";
  } else if (ext === "js" || ext === "jsx" || ext === "ts" || ext === "tsx") {
    return "application/javascript";
  } else if (ext === "json") {
    return "application/json";
  } else if (!ext || ext === "html") {
    return "text/html";
  }
}
