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
  } else if (!files["/index.html"]) {
    const message =
      "Val UI files missing (error: no index.html found). This Val version or build is corrupted!";
    console.error(message, Object.keys(files));
    throw new Error(message);
  }
  return async (path): Promise<ValServerGenericResult> => {
    if (path.startsWith("/edit")) {
      return {
        status: 200,
        headers: {
          "Content-Type": "text/html",
        },
        body: Buffer.from(files["/index.html"], "base64").toString("utf-8"),
      };
    } else {
      if (files[path]) {
        return {
          status: 200,
          headers: {
            "Content-Type": getServerMimeType(path) || "",
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
