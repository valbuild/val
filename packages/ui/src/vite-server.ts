import {
  ValServerGenericResult,
  ValUIRequestHandler,
} from "@valbuild/shared/internal";
import { getServerMimeType } from "./serverMimeType";

const files: Record<string, string> = JSON.parse(
  `BUILD_REPLACE_THIS_WITH_RECORD`
) as unknown as Record<string, string>;

export function createUIRequestHandler(): ValUIRequestHandler {
  if (typeof files !== "object") {
    throw new Error(
      "Val UI files missing (error: is not an object)! This Val version or build is corrupted!"
    );
  }
  const jsFiles = Object.keys(files).filter(
    (path) => path.endsWith(".js") || path.endsWith(".jsx")
  );
  if (jsFiles.length === 0) {
    throw new Error(
      "Val UI files missing (error: no .js files found)! This Val version or build is corrupted!"
    );
  } else if (jsFiles.length > 1) {
    throw new Error(
      `Val UI files missing (error: multiple .js files found: ${jsFiles.join(
        " ,"
      )})! This Val version or build is corrupted!`
    );
  }

  const MAIN_FILE = jsFiles[0];
  return async (path, url): Promise<ValServerGenericResult> => {
    if (path === "/app") {
      return {
        status: 302,
        headers: {
          "Content-Type": "application/javascript",
        },
        redirectTo: url.replace(path, MAIN_FILE),
      };
    } else {
      if (files[path]) {
        return {
          status: 200,
          headers: {
            "Content-Type": getServerMimeType(path) || "",
            "Cache-Control": "max-age=10", // TODO: change this to something more aggressive
          },
          body: Buffer.from(files[path], "base64").toString("utf-8"),
        };
      } else {
        return {
          status: 404,
          json: {
            message: `Val UI file not found: ${path}`,
            details: {
              files: Object.keys(files),
            },
          },
        };
      }
    }
  };
}
