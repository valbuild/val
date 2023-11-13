import type { RequestHandler } from "express";

const files: Record<string, string> = JSON.parse(
  `BUILD_REPLACE_THIS_WITH_RECORD`
) as unknown as Record<string, string>;

export function createRequestHandler(): RequestHandler {
  if (typeof files !== "object") {
    throw new Error("Files is not an object! Your Val build is corrupted!");
  }
  return (req, res, next) => {
    if (!files["/index.html"]) {
      console.error(
        "No index.html found! Your Val build is corrupted!",
        Object.keys(files)
      );
      next();
      return;
    }
    if (req.url.startsWith("/edit")) {
      res
        .header({ "Content-Type": "text/html" })
        .end(Buffer.from(files["/index.html"], "base64").toString("utf-8"));
    } else {
      if (Object.keys(files).includes(req.url)) {
        if (req.url.endsWith(".js")) {
          res
            .header({ "Content-Type": "application/javascript" })
            .end(Buffer.from(files[req.url], "base64").toString("utf-8"));
        } else if (req.url.endsWith(".css")) {
          res
            .header({ "Content-Type": "text/css" })
            .end(Buffer.from(files[req.url], "base64").toString("utf-8"));
        } else {
          res.end(Buffer.from(files[req.url], "base64").toString("utf-8"));
        }
      } else {
        next();
      }
    }
  };
}
