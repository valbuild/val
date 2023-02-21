import express, { Router, RequestHandler } from "express";
import { Service } from "./Service";
import { PatchJSON, parsePatch } from "./patch/patch";
import { PatchError } from "./patch/ops";
import * as result from "./fp/result";

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
    // First validate that the body has the right structure
    const patchJSON = PatchJSON.safeParse(req.body);
    if (!patchJSON.success) {
      res.status(401).json(patchJSON.error.issues);
      return;
    }
    // Then parse/validate
    const patch = parsePatch(patchJSON.data);
    if (result.isErr(patch)) {
      res.status(401).json(patch.error);
      return;
    }
    const id = getFileIdFromParams(req.params);
    try {
      await this.service.patch(id, patch.value);
      res.send("OK");
    } catch (err) {
      if (err instanceof PatchError) {
        res.status(401).send(err.message);
      } else {
        console.error(err);
        res
          .status(500)
          .send(err instanceof Error ? err.message : "Unknown error");
      }
    }
  }
}
