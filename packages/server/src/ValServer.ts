import express, { Router, RequestHandler } from "express";
import { Operation, JsonPatchError } from "fast-json-patch";
import { Service } from "./Service";

const getFileIdFromParams = (params: { 0: string }) => {
  return `/${params[0]}`;
};

export function createRequestHandler(service: Service): RequestHandler {
  return new ValServer(service).createRouter();
}

export class ValServer {
  constructor(readonly service: Service) {}

  createRouter(): Router {
    const router = Router();
    router.get<{ 0: string }>("/ids/*", this.getIds.bind(this));
    router.patch<{ 0: string }>(
      "/ids/*",
      express.json({
        type: "application/json-patch+json",
      }),
      this.patchIds.bind(this)
    );
    return router;
  }

  async getIds(
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

  async patchIds(
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
}
