export function getMainJsAppFile(jsFiles: string[]): string {
  const jsMainFiles = jsFiles.filter((path) =>
    path.startsWith("/assets/index-"),
  );
  if (jsMainFiles.length === 0) {
    throw new Error(
      "Val UI main files missing (error: no .js files found)! This Val version or build is corrupted!",
    );
  } else if (jsMainFiles.length > 1) {
    throw new Error(
      `Val UI multiple main files (error: multiple .js files found: ${jsMainFiles.join(
        " ,",
      )})! This Val version or build is corrupted!`,
    );
  }
  const MAIN_FILE = jsMainFiles[0];
  if (typeof MAIN_FILE !== "string") {
    throw new Error(
      "Val UI main JS file could not be determined! This Val version or build is corrupted!",
    );
  }
  return MAIN_FILE;
}
