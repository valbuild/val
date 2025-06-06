import {
  ValServerGenericResult,
  ValUIRequestHandler,
} from "@valbuild/shared/internal";
import { getServerMimeType } from "../spa/serverMimeType";
import { VAL_APP_PATH, VAL_CSS_PATH } from "./constants";
import { VERSION } from "./vite-index";

const files: Record<string, string> = JSON.parse(
  `$$BUILD_$$REPLACE_WITH_RECORD$$`,
) as unknown as Record<string, string>;

const decodedFiles: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([key, value]) => [
    key,
    Buffer.from(value, "base64").toString("utf-8"),
  ]),
);

export function createUIRequestHandler(): ValUIRequestHandler {
  if (typeof files !== "object") {
    throw new Error(
      "Val UI files missing (error: is not an object)! This Val version or build is corrupted!",
    );
  }
  const jsFiles = Object.keys(decodedFiles).filter(
    (path) => path.endsWith(".js") || path.endsWith(".jsx"),
  );
  if (jsFiles.length === 0) {
    throw new Error(
      "Val UI files missing (error: no .js files found)! This Val version or build is corrupted!",
    );
  } else if (jsFiles.length > 1) {
    throw new Error(
      `Val UI files missing (error: multiple .js files found: ${jsFiles.join(
        " ,",
      )})! This Val version or build is corrupted!`,
    );
  }
  const MAIN_FILE = jsFiles[0];

  const cssFiles = Object.keys(decodedFiles).filter((path) =>
    path.endsWith(".css"),
  );
  if (cssFiles.length === 0) {
    throw new Error(
      "Val UI files missing (error: no .css files found)! This Val version or build is corrupted!",
    );
  } else if (cssFiles.length > 1) {
    throw new Error(
      `Val UI files missing (error: multiple .css files found: ${jsFiles.join(
        " ,",
      )})! This Val version or build is corrupted!`,
    );
  }
  const MAIN_CSS_FILE = cssFiles[0];
  const htmlPage = decodedFiles["/index.html"];
  if (!htmlPage) {
    throw new Error(
      "Val UI files missing (error: no index.html file found)! This Val version or build is corrupted!",
    );
  }

  return async (path, url): Promise<ValServerGenericResult> => {
    // NOTE: path === VAL_APP_PATH and path === VAL_CSS_PATH should no longer be used.
    // So, why do we keep the redirects? Because we are just doing this, and we are not a 100% we covered everything.
    // In the future, we should be able to remove the redirects.
    if (path === VAL_APP_PATH) {
      return {
        status: 302,
        redirectTo: url.replace(path, MAIN_FILE),
      };
    } else if (path === VAL_CSS_PATH) {
      return {
        status: 302,
        redirectTo: url.replace(path, MAIN_CSS_FILE),
      };
    } else if (path === `${VERSION ? `/${VERSION}` : ""}${VAL_APP_PATH}`) {
      return {
        status: 200,
        headers: {
          "Content-Type": "application/javascript",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
        body: decodedFiles[MAIN_FILE],
      };
    } else if (path === `${VERSION ? `/${VERSION}` : ""}${VAL_CSS_PATH}`) {
      return {
        status: 200,
        headers: {
          "Content-Type": "text/css",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
        body: decodedFiles[MAIN_CSS_FILE],
      };
    } else {
      if (files[path]) {
        return {
          status: 200,
          headers: {
            "Content-Type": getServerMimeType(path) || "",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
          body: decodedFiles[path],
        };
      } else {
        return {
          status: 200,
          headers: {
            "Content-Type": getServerMimeType(path) || "",
            "Cache-Control": "max-age=90", // TODO: change this to something more aggressive
          },
          body: htmlPage,
        };
      }
    }
  };
}
