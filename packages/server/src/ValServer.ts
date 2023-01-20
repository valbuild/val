import express from "express";
import cors from "cors";
import { Operation, JsonPatchError } from "fast-json-patch";
import http from "node:http";
import { Service } from "./Service";

const getFileIdFromParams = (params: { 0: string }) => {
  return `/${params[0]}`;
};

export type ValServerOptions = {
  /**
   * Port for hosting the HTTP server.
   */
  port: number;
  /**
   * CORS settings for the HTTP server.
   */
  cors?: cors.CorsOptions | cors.CorsOptionsDelegate;
};

export function createValServer(
  service: Service,
  opts: ValServerOptions
): Promise<ValServer> {
  return new Promise((resolve) => {
    new ValServer(service, opts, resolve);
  });
}

export class ValServer {
  private httpServer: http.Server;

  readonly service: Service;
  readonly port: number;

  constructor(
    service: Service,
    { port, cors: corsOpts }: ValServerOptions,
    onReady?: (server: ValServer) => void
  ) {
    this.service = service;
    this.port = port;

    const app = express();
    // TODO: configure cors properly
    app.use(cors(corsOpts));

    app.get<{ 0: string }>("/ids/*", this.handleGetIds.bind(this));
    app.patch<{ 0: string }>(
      "/ids/*",
      express.json({
        type: "application/json-patch+json",
      }),
      this.handlePatchIds.bind(this)
    );

    this.httpServer = app.listen(this.port, () => onReady?.(this));
  }

  async handleGetIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    try {
      console.log(req.params);
      const valContent = await this.service.get(
        getFileIdFromParams(req.params)
      );
      console.log(JSON.stringify(valContent, null, 2));
      res.json(valContent);
    } catch (err) {
      console.error(err);
      res.sendStatus(500);
    }
  }

  async handlePatchIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    const patch: Operation[] = req.body;
    const id = getFileIdFromParams(req.params);
    try {
      await this.service.patch(id, patch);
      res.send("OK");
    } catch (err) {
      if (err instanceof JsonPatchError) {
        res.status(400).json({
          error: err.name,
          index: err.index,
        });
      } else {
        console.error(err);
        res
          .status(500)
          .send(err instanceof Error ? err.message : "Unknown error");
      }
    }
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  on(event: "close", callback: () => void) {
    this.httpServer.on(event, callback);
  }

  off(event: "close", callback: () => void) {
    this.httpServer.off(event, callback);
  }
}
