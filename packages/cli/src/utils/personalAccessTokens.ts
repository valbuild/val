import path from "path";

export function getPersonalAccessTokenPath(root: string) {
  return path.join(path.resolve(root), ".val", "pat.json");
}
