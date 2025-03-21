import path from "path";

export function getPersonalAccessTokenPath(root: string) {
  return path.join(path.resolve(root), ".val", "pat.json");
}

export function parsePersonalAccessTokenFile(content: string | undefined):
  | {
      success: true;
      data: { pat: string };
    }
  | {
      success: false;
      error: string;
    } {
  if (!content) {
    return { success: false, error: "Invalid content: undefined" };
  }
  let patFileContent: unknown;
  try {
    patFileContent = JSON.parse(content);
  } catch {
    return {
      success: false,
      error: `Invalid content: file is not a valid JSON file`,
    };
  }
  if (typeof patFileContent !== "object") {
    return { success: false, error: "Invalid content: not an object" };
  }
  if (!patFileContent) {
    return { success: false, error: "Invalid content: null" };
  }
  if (!("pat" in patFileContent)) {
    return { success: false, error: "Invalid content: key 'pat' is missing" };
  }
  const patField = patFileContent.pat;
  if (typeof patField === "string") {
    return { success: true, data: { pat: patField } };
  } else {
    return { success: false, error: "Invalid content: pat is not a string" };
  }
}
