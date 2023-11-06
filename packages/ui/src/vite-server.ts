import type { RequestHandler } from "express";

const script = "/**REPLACE:SCRIPT*/";

export function createRequestHandler(): RequestHandler {
  return (req, res, next) => {
    if (req.url.startsWith("/edit")) {
      res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Val</title>
    <script>${Buffer.from(script, "base64").toString("utf-8")}</script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`);
    } else {
      next();
    }
  };
}
