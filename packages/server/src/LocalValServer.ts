import express, { Router } from "express";
import { Service } from "./Service";
import { validatePatch } from "./patch/patch";
import { PatchError } from "./patch/ops";
import * as result from "./fp/result";
import { formatJSONPointer } from "./patch/operation";

export type LocalValServerOptions = {
  service: Service;
};

export class LocalValServer {
  constructor(readonly options: LocalValServerOptions) {}

  createRouter(): Router {
    const router = Router();
    router.get("/session", this.session.bind(this));
    router.get("/authorize", this.noop.bind(this));
    router.get("/callback", this.noop.bind(this));
    router.get("/logout", this.noop.bind(this));
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

  async noop(_req: express.Request, res: express.Response): Promise<void> {
    res.sendStatus(200);
  }

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
      const valContent = await this.options.service.get(
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
    const patch = validatePatch(req.body);
    if (result.isErr(patch)) {
      res
        .status(401)
        .send(
          patch.error
            .map(
              ({ path, message }) => `${formatJSONPointer(path)}: ${message}`
            )
            .join("\n")
        );
      return;
    }
    const id = getFileIdFromParams(req.params);
    try {
      await this.options.service.patch(id, patch.value);
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

function getFileIdFromParams(params: { 0: string }): string {
  return `/${params[0]}`;
}
