import express from "express";

export interface ValServer {
  authorize(req: express.Request, res: express.Response): Promise<void>;

  callback(req: express.Request, res: express.Response): Promise<void>;

  logout(req: express.Request, res: express.Response): Promise<void>;

  session(req: express.Request, res: express.Response): Promise<void>;

  patchIds(
    req: express.Request<{ 0: string }>,
    res: express.Response
  ): Promise<void>;

  commit(req: express.Request, res: express.Response): Promise<void>;

  enable(req: express.Request, res: express.Response): Promise<void>;
  disable(req: express.Request, res: express.Response): Promise<void>;

  getTree(req: express.Request, res: express.Response): Promise<void>;
}
