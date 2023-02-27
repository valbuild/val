import express from "express";
import { createServer } from "vite";
import server from "@valbuild/server";
const { createRequestListener } = server;

async function serve() {
  const app = express();
  app.use(
    "/api/val",
    createRequestListener("", {
      valConfigPath: "./src/val.config.js",
    })
  );

  const vite = await createServer({
    server: { middlewareMode: true },
  });

  app.use(vite.middlewares);

  app.listen(5173);
}

void serve();
