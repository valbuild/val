import express from "express";
import { Service } from "./Service";
import { PatchJSON } from "./patch/validation";
import { result } from "@valbuild/lib/fp";
import { parsePatch, PatchError } from "@valbuild/lib/patch";
import { getFileIdFromParams } from "./expressHelpers";
import { ValServer } from "./ValServer";

export type LocalValServerOptions = {
  service: Service;
};

export class LocalValServer implements ValServer {
  constructor(readonly options: LocalValServerOptions) {}

  async session(_req: express.Request, res: express.Response): Promise<void> {
    res.json({
      mode: "local",
    });
  }

  async getIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void> {
    try {
      console.log(req.params);
      const valModule = await this.options.service.get(
        getFileIdFromParams(req.params)
      );
      res.json(valModule);
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
      const valModule = await this.options.service.patch(id, patch.value);
      res.json(valModule);
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
  private async badRequest(
    req: express.Request,
    res: express.Response
  ): Promise<void> {
    console.debug("Local server does handle this request", req.url);
    res.sendStatus(400);
  }

  authorize(req: express.Request, res: express.Response): Promise<void> {
    return this.badRequest(req, res);
  }

  callback(req: express.Request, res: express.Response): Promise<void> {
    return this.badRequest(req, res);
  }

  logout(req: express.Request, res: express.Response): Promise<void> {
    return this.badRequest(req, res);
  }
}
